"""Empirical CI-coverage harness (SIMULATION-VERIFICATION §3.2).

For each (world_grid × seed) cell:
  1. Materialise the world via `admatix_simulator.generate_world`.
  2. Build a `VerifyRequest` with `hint.design` set per world type so the
     selector picks the documented method per §2.6.
  3. Call the verifier method DIRECTLY (Python import, not HTTP).
  4. Record whether `ci_low ≤ ground_truth.ate ≤ ci_high`.

Pass criterion (§3.2): empirical 95% CI coverage ∈ [0.93, 0.97] on
≥ 1000 simulated worlds. `passes_nominal` is True iff the band holds on
every per-method breakdown that has ≥ 200 worlds.
"""

from __future__ import annotations

import warnings
from collections import defaultdict
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Any

import numpy as np
import pandas as pd

from admatix_verifier.loaders import load_events
from admatix_verifier.methods import bsts, cate, geo, ope
from admatix_verifier.select import select_method

from .grids import (
    build_verify_request,
    cell_hash,
    design_hint_for,
    enumerate_cells,
    materialise,
    round_float,
    write_json,
    write_jsonl,
)
from .types import ValidationConfig, WorldRun


_PER_METHOD_GATE_MIN_N = 200


@dataclass(frozen=True)
class CoverageResult:
    n_worlds: int
    ci_level: float
    empirical_coverage: float
    lower_band: float
    upper_band: float
    passes_nominal: bool
    flagged_for_review: bool
    per_method: dict[str, dict[str, float]]
    runs_path: Path
    metrics_path: Path
    coverage_curve_path: Path = field(default_factory=lambda: Path())

    def to_dict(self) -> dict:
        payload = asdict(self)
        payload["runs_path"] = str(self.runs_path)
        payload["metrics_path"] = str(self.metrics_path)
        payload["coverage_curve_path"] = str(self.coverage_curve_path)
        return payload


def _dispatch_method(method: str, req, events: pd.DataFrame):
    """Direct import dispatch — same routing the FastAPI service uses."""
    if method == "ope_ips_snips_dr":
        return ope.run(req, events)
    if method == "geo_synthetic_control":
        return geo.run(req, events)
    if method == "cate_meta_learner":
        return cate.run(req, events)
    if method == "bsts_synthetic_control":
        return bsts.run(req, events)
    # guardrail_only — return a stub MethodResult with no quantitative estimate.
    from admatix_verifier.models import MethodResult

    return MethodResult(
        method="guardrail_only",
        estimate=None,
        ci_low=None,
        ci_high=None,
        verdict="inconclusive",
        causal_status="inconclusive",
        confounders=[],
        diagnostics={"reason": "no_quantitative_method_available"},
    )


def _pick_method(verifier_method: str, req, events: pd.DataFrame) -> str:
    if verifier_method == "auto":
        return select_method(req, events)
    return verifier_method


def _ci_width(low: float | None, high: float | None) -> float | None:
    if low is None or high is None:
        return None
    return float(high - low)


def _plot_coverage_curve(
    runs: list[WorldRun],
    out_path: Path,
    ci_level: float,
    lower_band: float,
    upper_band: float,
) -> None:
    """Plot empirical coverage vs. the world-grid axis that varies most.

    Picks the cell kwarg with the highest number of distinct values across
    the run; if none varies, just plots a single point (the overall
    coverage).
    """
    import matplotlib

    matplotlib.use("Agg")
    import matplotlib.pyplot as plt

    if not runs:
        fig, ax = plt.subplots(figsize=(5, 3))
        ax.set_title("coverage curve — no runs")
        out_path.parent.mkdir(parents=True, exist_ok=True)
        fig.savefig(out_path, dpi=120)
        plt.close(fig)
        return

    # Group by world_type since that's the meaningful axis in every default
    # config; report coverage per world_type as the bars on the chart.
    by_type: dict[str, list[bool]] = defaultdict(list)
    for r in runs:
        if r.ci_low is None or r.ci_high is None:
            by_type[r.world_type].append(False)
        else:
            by_type[r.world_type].append(r.ci_low <= r.ground_truth_ate <= r.ci_high)

    labels = sorted(by_type.keys())
    coverages = [float(np.mean(by_type[k])) if by_type[k] else 0.0 for k in labels]
    counts = [len(by_type[k]) for k in labels]

    fig, ax = plt.subplots(figsize=(7, 4))
    xs = np.arange(len(labels))
    ax.bar(xs, coverages, width=0.6, color="#4c78a8", edgecolor="black")
    for x, n in zip(xs, counts):
        ax.text(x, 0.02, f"n={n}", ha="center", va="bottom", fontsize=8)
    ax.axhline(ci_level, color="black", linestyle="--", linewidth=1, label=f"nominal {ci_level:.2f}")
    ax.axhline(lower_band, color="red", linestyle=":", linewidth=1, label=f"lower band {lower_band:.2f}")
    ax.axhline(upper_band, color="green", linestyle=":", linewidth=1, label=f"upper band {upper_band:.2f}")
    ax.set_xticks(xs)
    ax.set_xticklabels(labels, rotation=15, ha="right")
    ax.set_ylim(0, 1.05)
    ax.set_ylabel("empirical CI coverage")
    ax.set_title("CI coverage by world_type")
    ax.legend(loc="lower right", fontsize=8)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    fig.tight_layout()
    fig.savefig(out_path, dpi=120)
    plt.close(fig)


def run_coverage(config: ValidationConfig) -> CoverageResult:
    """Run the coverage loop; return the dataclass."""
    cov_dir = config.output_dir / "coverage"
    cov_dir.mkdir(parents=True, exist_ok=True)
    sim_root = cov_dir / "worlds"

    ci_level = float(config.ci_level)
    lower_band = round(0.97 - 0.04, 4)   # 0.93 — locked from §3.2
    upper_band = round(0.97, 4)          # 0.97 — locked from §3.2

    runs: list[WorldRun] = []

    for cell in enumerate_cells(config.world_grid, config.seeds):
        world_type = cell.cell_kwargs.get("world_type", "clean_ab")
        world = materialise(cell, sim_root)
        events = load_events(world.data_uri)

        req = build_verify_request(
            world,
            hint_design=design_hint_for(world_type),
            plausible_lift=float(cell.cell_kwargs.get("true_lift", 0.0) or 0.0) or None,
        )

        method = _pick_method(config.verifier_method, req, events)
        with warnings.catch_warnings():
            warnings.simplefilter("ignore")
            result = _dispatch_method(method, req, events)

        truth = float(world.ground_truth.get("ate", 0.0))
        runs.append(
            WorldRun(
                config_hash=cell.config_hash,
                seed=int(cell.seed),
                world_id=world.world_id,
                world_type=str(world_type),
                ground_truth_ate=round(truth, 10),
                estimate=round_float(result.estimate),
                ci_low=round_float(result.ci_low),
                ci_high=round_float(result.ci_high),
                method=str(result.method),
                verdict=str(result.verdict),
                diagnostics={"ci_width": round_float(_ci_width(result.ci_low, result.ci_high))},
            )
        )

    n_worlds = len(runs)
    contained = [
        (r.ci_low is not None and r.ci_high is not None and r.ci_low <= r.ground_truth_ate <= r.ci_high)
        for r in runs
    ]
    empirical = float(np.mean(contained)) if contained else 0.0

    per_method: dict[str, dict[str, float]] = {}
    for method in sorted({r.method for r in runs}):
        subset = [r for r in runs if r.method == method]
        n = len(subset)
        cov = float(np.mean([
            r.ci_low is not None and r.ci_high is not None and r.ci_low <= r.ground_truth_ate <= r.ci_high
            for r in subset
        ])) if subset else 0.0
        widths = [_ci_width(r.ci_low, r.ci_high) for r in subset]
        widths = [w for w in widths if w is not None]
        mean_width = float(np.mean(widths)) if widths else float("nan")
        per_method[method] = {
            "n": int(n),
            "coverage": round(cov, 6),
            "mean_width": round(mean_width, 10) if np.isfinite(mean_width) else None,
        }

    # Per-method gate (§3.2): only methods with ≥ 200 worlds gate, others
    # report-only. The overall band gates always.
    passes_overall = lower_band <= empirical <= upper_band
    passes_per_method = all(
        lower_band <= m["coverage"] <= upper_band
        for m in per_method.values()
        if m["n"] >= _PER_METHOD_GATE_MIN_N
    )
    passes_nominal = passes_overall and passes_per_method
    flagged_for_review = empirical > 0.98

    runs_sorted = sorted(runs, key=lambda r: (r.config_hash, r.seed))
    runs_path = cov_dir / "runs.jsonl"
    write_jsonl(runs_path, [r.to_dict() for r in runs_sorted])

    coverage_curve_path = cov_dir / "coverage_curve.png"
    _plot_coverage_curve(runs_sorted, coverage_curve_path, ci_level, lower_band, upper_band)

    metrics_path = cov_dir / "metrics.json"
    metrics: dict[str, Any] = {
        "n_worlds": int(n_worlds),
        "ci_level": float(ci_level),
        "empirical_coverage": round(empirical, 6),
        "lower_band": lower_band,
        "upper_band": upper_band,
        "passes_nominal": bool(passes_nominal),
        "flagged_for_review": bool(flagged_for_review),
        "per_method": per_method,
        "runs_path": str(runs_path),
        "metrics_path": str(metrics_path),
        "coverage_curve_path": str(coverage_curve_path),
        "config_hash": config.hash(),
    }
    write_json(metrics_path, metrics)

    return CoverageResult(
        n_worlds=int(n_worlds),
        ci_level=float(ci_level),
        empirical_coverage=float(round(empirical, 6)),
        lower_band=lower_band,
        upper_band=upper_band,
        passes_nominal=bool(passes_nominal),
        flagged_for_review=bool(flagged_for_review),
        per_method=per_method,
        runs_path=runs_path,
        metrics_path=metrics_path,
        coverage_curve_path=coverage_curve_path,
    )


__all__ = ["CoverageResult", "run_coverage"]
