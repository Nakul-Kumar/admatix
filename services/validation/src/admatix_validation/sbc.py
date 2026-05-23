"""Simulation-Based Calibration harness (SIMULATION-VERIFICATION §3.1).

Implements Talts et al. 2018 (arXiv:1804.06788) against the PyMC reference
Bayesian CATE estimator declared in `reference_models/pymc_cate.py`. The
SBC loop, per the spec:

  for i in 1..n_simulations:
    1. Draw γ_i ~ Normal(0, 0.05)  from the reference model's prior
    2. Simulate a model-consistent world with true γ = γ_i
    3. Fit the PyMC reference model on the world
    4. Record the rank of γ_i within the posterior draws of γ

Under correct inference, ranks are uniform across [0, n_draws]. The pass
criterion (§3.1) is χ² goodness-of-fit p > 0.05 *and* no systematic ∪/∩
shape.
"""

from __future__ import annotations

import json
import warnings
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Literal

import numpy as np

from .grids import write_json, write_jsonl
from .reference_models import (
    REFERENCE_MODEL_NAME,
    build_pymc_cate_model,
    sample_prior_gamma,
    simulate_world_from_prior,
)
from .types import ValidationConfig


_DEFAULT_N_BINS = 20
_DEFAULT_PYMC_DRAWS = 300
_DEFAULT_PYMC_TUNE = 200
_DEFAULT_N_USERS = 400
_SHAPE_FRAC_THRESHOLD = 0.65


ShapeDiagnostic = Literal["uniform", "u_shaped", "n_shaped", "skewed"]


@dataclass(frozen=True)
class SbcResult:
    n_simulations: int
    rank_histogram: list[int]
    n_bins: int
    chi2_statistic: float
    chi2_p_value: float
    shape_diagnostic: ShapeDiagnostic
    passes_uniformity: bool
    rank_plot_path: Path
    metrics_path: Path
    reference_model: str
    draws_path: Path = field(default_factory=lambda: Path())

    def to_dict(self) -> dict:
        payload = asdict(self)
        payload["rank_plot_path"] = str(self.rank_plot_path)
        payload["metrics_path"] = str(self.metrics_path)
        payload["draws_path"] = str(self.draws_path)
        return payload


def _shape_diagnostic(counts: np.ndarray) -> ShapeDiagnostic:
    """Classify the rank-histogram shape per the §3.1 ∪/∩ heuristic.

    The simplest robust check: split the bins into 3 thirds and compare the
    middle third's mean count to the outer thirds.
      - ∪-shape (overdispersion / posterior too narrow) — middle third
        notably lower than outer thirds
      - ∩-shape (underdispersion / posterior too wide) — middle third
        notably higher than outer thirds
      - skewed — one outer third much heavier than the other
      - uniform — none of the above
    """
    n = len(counts)
    if n < 3:
        return "uniform"
    third = n // 3
    left = float(np.mean(counts[:third]))
    middle = float(np.mean(counts[third : n - third]))
    right = float(np.mean(counts[n - third :]))
    expected = float(np.mean(counts))
    if expected == 0:
        return "uniform"

    # Skew: one outer third dominates the other by ≥ 35%.
    if max(left, right) > _SHAPE_FRAC_THRESHOLD * (left + right + 1e-9) and min(left, right) > 0:
        if (left + right) > 0 and abs(left - right) / (left + right) > 0.35:
            return "skewed"

    # ∪ / ∩ shape: middle third differs from outer-third mean by ≥ 35%.
    outer_mean = (left + right) / 2.0
    if outer_mean == 0:
        return "uniform"
    if middle < (1 - 0.35) * outer_mean:
        return "u_shaped"
    if middle > (1 + 0.35) * outer_mean:
        return "n_shaped"
    return "uniform"


def _chi2_uniform(counts: np.ndarray) -> tuple[float, float]:
    """χ² goodness-of-fit against a uniform discrete distribution."""
    from scipy import stats

    total = float(np.sum(counts))
    n = len(counts)
    if total == 0 or n == 0:
        return 0.0, 1.0
    expected = total / n
    chi2 = float(np.sum((counts - expected) ** 2 / expected))
    p = float(stats.chi2.sf(chi2, df=n - 1))
    return chi2, p


def _rank_in_posterior(true_gamma: float, posterior_gamma: np.ndarray, n_bins: int) -> int:
    """Map the rank of `true_gamma` within `posterior_gamma` to a bin in [0, n_bins).

    The rank is the count of posterior draws strictly less than the truth
    (Talts §2.1). We bin into `n_bins` equal-width bins over [0, len(posterior)].
    """
    rank = int(np.sum(posterior_gamma < true_gamma))
    n_posterior = len(posterior_gamma)
    if n_posterior == 0:
        return 0
    bin_idx = int(rank * n_bins // (n_posterior + 1))
    return min(max(bin_idx, 0), n_bins - 1)


def _plot_rank_histogram(counts: np.ndarray, n_simulations: int, out_path: Path) -> None:
    """Write a rank histogram PNG. Uses arviz when available, matplotlib otherwise.

    arviz's `plot_rank` takes posterior InferenceData not raw counts, so we
    build the histogram ourselves and let matplotlib render the bars with
    the uniform-band overlay arviz uses. Same content, simpler dependency
    surface.
    """
    import matplotlib

    matplotlib.use("Agg")  # headless safe
    import matplotlib.pyplot as plt

    n_bins = len(counts)
    expected = n_simulations / n_bins if n_bins else 0.0
    band = float(np.sqrt(expected)) if expected > 0 else 0.0

    fig, ax = plt.subplots(figsize=(6, 3.5))
    xs = np.arange(n_bins)
    ax.bar(xs, counts, width=1.0, edgecolor="black", color="#4c78a8")
    ax.axhline(expected, color="black", linestyle="--", linewidth=1, label="expected (uniform)")
    if band > 0:
        ax.fill_between(
            xs,
            np.full_like(xs, expected - band, dtype=float),
            np.full_like(xs, expected + band, dtype=float),
            color="grey",
            alpha=0.2,
            label="±1·sqrt(expected)",
        )
    ax.set_xlabel("rank bin")
    ax.set_ylabel("count")
    ax.set_title(f"SBC rank histogram (n={n_simulations}, bins={n_bins})")
    ax.legend(loc="upper right", fontsize=8)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    fig.tight_layout()
    fig.savefig(out_path, dpi=120)
    plt.close(fig)


def run_sbc(
    config: ValidationConfig,
    *,
    reference_model: Literal["pymc_bayesian_cate"] = "pymc_bayesian_cate",
) -> SbcResult:
    """Run the SBC loop; return the result dataclass.

    Side effects (deterministic under config.seeds):
      - writes output_dir/sbc/rank_histogram.png
      - writes output_dir/sbc/metrics.json
      - writes output_dir/sbc/draws.jsonl (one row per simulation)
    """
    if reference_model != "pymc_bayesian_cate":
        raise ValueError(f"unsupported reference_model: {reference_model!r}")

    # SBC ranges over n_simulations × the explicit seed grid; we use
    # the first n_simulations seeds (rounded by min) for the loop. The
    # spec phrases the grid as `for i in 1..n_simulations`; the seeds list
    # is the explicit RNG ladder behind it.
    seeds = list(config.seeds)
    n_sims = min(config.n_simulations, len(seeds))
    if n_sims < config.n_simulations:
        # Stretch the seed list to cover the requested n_simulations by
        # deterministic incrementing — preserves reproducibility.
        seeds = list(seeds) + [seeds[-1] + 1 + i for i in range(config.n_simulations - len(seeds))]
        n_sims = config.n_simulations
    seeds = seeds[:n_sims]

    # World-grid kwargs control n_users for the SBC reference simulator.
    # Default to a small n_users for speed; honour the first cell if present.
    first_cell = dict(config.world_grid[0]) if config.world_grid else {}
    n_users = int(first_cell.get("n_users", _DEFAULT_N_USERS))
    n_draws = int(first_cell.get("pymc_draws", _DEFAULT_PYMC_DRAWS))
    n_tune = int(first_cell.get("pymc_tune", _DEFAULT_PYMC_TUNE))
    n_bins = int(first_cell.get("n_bins", _DEFAULT_N_BINS))

    sbc_dir = config.output_dir / "sbc"
    sbc_dir.mkdir(parents=True, exist_ok=True)

    draws_rows: list[dict] = []
    counts = np.zeros(n_bins, dtype=int)

    for seed in seeds:
        gamma_truth = sample_prior_gamma(int(seed))
        events, gt = simulate_world_from_prior(
            gamma_truth,
            seed=int(seed),
            n_users=n_users,
            output_dir=sbc_dir / "worlds",
        )
        with warnings.catch_warnings():
            warnings.simplefilter("ignore")
            idata = build_pymc_cate_model(
                events,
                n_draws=n_draws,
                n_tune=n_tune,
                random_seed=int(seed),
            )

        posterior_gamma = np.asarray(idata.posterior["gamma"].values).reshape(-1)
        rank_bin = _rank_in_posterior(gamma_truth, posterior_gamma, n_bins)
        counts[rank_bin] += 1

        posterior_mean = float(np.mean(posterior_gamma))
        draws_rows.append({
            "seed": int(seed),
            "prior_draw": round(float(gamma_truth), 10),
            "rank_bin": int(rank_bin),
            "posterior_mean": round(posterior_mean, 10),
            "n_posterior_draws": int(len(posterior_gamma)),
        })

    chi2_stat, chi2_p = _chi2_uniform(counts)
    shape = _shape_diagnostic(counts)
    passes_uniformity = (chi2_p > 0.05) and (shape == "uniform")

    rank_plot_path = sbc_dir / "rank_histogram.png"
    _plot_rank_histogram(counts, n_sims, rank_plot_path)

    metrics_path = sbc_dir / "metrics.json"
    draws_path = sbc_dir / "draws.jsonl"
    write_jsonl(draws_path, draws_rows)

    metrics = {
        "n_simulations": int(n_sims),
        "rank_histogram": [int(c) for c in counts],
        "n_bins": int(n_bins),
        "chi2_statistic": round(float(chi2_stat), 10),
        "chi2_p_value": round(float(chi2_p), 10),
        "shape_diagnostic": shape,
        "passes_uniformity": bool(passes_uniformity),
        "rank_plot_path": str(rank_plot_path),
        "metrics_path": str(metrics_path),
        "draws_path": str(draws_path),
        "reference_model": REFERENCE_MODEL_NAME,
        "pymc_n_draws": int(n_draws),
        "pymc_n_tune": int(n_tune),
        "n_users_per_world": int(n_users),
        "config_hash": config.hash(),
    }
    write_json(metrics_path, metrics)

    return SbcResult(
        n_simulations=int(n_sims),
        rank_histogram=[int(c) for c in counts],
        n_bins=int(n_bins),
        chi2_statistic=float(chi2_stat),
        chi2_p_value=float(chi2_p),
        shape_diagnostic=shape,
        passes_uniformity=bool(passes_uniformity),
        rank_plot_path=rank_plot_path,
        metrics_path=metrics_path,
        reference_model=REFERENCE_MODEL_NAME,
        draws_path=draws_path,
    )


__all__ = ["SbcResult", "run_sbc"]
