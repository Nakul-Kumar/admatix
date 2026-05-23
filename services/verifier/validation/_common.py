"""Shared helpers for the method-validation harness.

Bias / RMSE / coverage are computed from a list of per-seed estimates and
the corresponding CI endpoints — see `summarise_runs`. Coverage is reported
at both the *emitted* 95% level (the level the verifier returns) and at a
rescaled 90% level (`coverage_90`), which is the level the validation tests
encode as the permanent regression guard (`[0.85, 0.95]`).
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

import numpy as np
from scipy import stats


Z95 = float(stats.norm.ppf(0.975))
Z90 = float(stats.norm.ppf(0.95))


@dataclass
class RunRecord:
    """One Monte-Carlo run's per-estimator output."""

    seed: int
    truth: float
    estimate: float | None
    ci_low: float | None
    ci_high: float | None
    extras: dict[str, Any] = field(default_factory=dict)


def _ci90_from_ci95(estimate: float, ci_low: float, ci_high: float) -> tuple[float, float]:
    """Rescale a verifier-emitted 95% CI to a 90% CI via the Gaussian SE."""

    se = (ci_high - ci_low) / (2.0 * Z95)
    return estimate - Z90 * se, estimate + Z90 * se


def summarise_runs(runs: list[RunRecord]) -> dict[str, Any]:
    """Compute bias, RMSE, and coverage (at 95% and 90%) over Monte-Carlo runs.

    Returns counts of `n_runs` (all seeds, including failures), `n_valid`
    (estimate was produced), and `n_inconclusive` (estimate was None). The
    metrics are computed over the valid runs only. A run is "covered" when
    `ci_low <= truth <= ci_high`.
    """

    valid = [r for r in runs if r.estimate is not None and r.ci_low is not None and r.ci_high is not None]
    n_runs = len(runs)
    n_valid = len(valid)
    n_inconclusive = n_runs - n_valid
    if n_valid == 0:
        return {
            "n_runs": n_runs,
            "n_valid": 0,
            "n_inconclusive": n_inconclusive,
            "bias": None,
            "rmse": None,
            "coverage_95": None,
            "coverage_90": None,
            "mean_estimate": None,
            "mean_ci_width_95": None,
        }
    truth = np.array([r.truth for r in valid], dtype=float)
    est = np.array([r.estimate for r in valid], dtype=float)
    lo = np.array([r.ci_low for r in valid], dtype=float)
    hi = np.array([r.ci_high for r in valid], dtype=float)
    err = est - truth
    bias = float(np.mean(err))
    rmse = float(np.sqrt(np.mean(err**2)))
    cov95 = float(np.mean((lo <= truth) & (truth <= hi)))
    lo90 = est - Z90 * (hi - lo) / (2.0 * Z95)
    hi90 = est + Z90 * (hi - lo) / (2.0 * Z95)
    cov90 = float(np.mean((lo90 <= truth) & (truth <= hi90)))
    return {
        "n_runs": int(n_runs),
        "n_valid": int(n_valid),
        "n_inconclusive": int(n_inconclusive),
        "bias": bias,
        "rmse": rmse,
        "coverage_95": cov95,
        "coverage_90": cov90,
        "mean_estimate": float(np.mean(est)),
        "mean_ci_width_95": float(np.mean(hi - lo)),
    }


__all__ = ["RunRecord", "summarise_runs", "Z90", "Z95", "_ci90_from_ci95"]
