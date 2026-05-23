"""Analytic ground-truth Monte-Carlo for the bespoke BSTS estimator.

We construct a daily treated/control rate pair where the data-generating
process is a known linear-Gaussian state-space model — exactly the family
`statsmodels.UnobservedComponents` is built to fit — and where a known
constant step `δ` is injected into the post-period treated series.

Generative model (per period t = 0, ..., T-1):

    c_t = control_rate_t = baseline + drift · t + ω_t              (ω ~ N)
    y_t = control_rate_t + β · u_t + γ · 1[t ≥ T/2] + ε_t          (ε ~ N)

`γ` is the recorded ground truth (the population-mean post-period gap).
Pre-period rates are co-integrated through `u_t`, a small common shock the
BSTS sees as the "control covariate". The verifier's BSTS fits on the
pre-period and forecasts the post-period — the gap `mean(y_post - ŷ_post)`
should recover `γ` and the emitted CI should bracket it at nominal rate.

Three controlled scenarios:

  * `no_seasonal_small_effect`
      γ = 0.005, baseline ≈ 0.03, σ_ε = 0.003, drift = 0, no seasonal.

  * `no_seasonal_medium_effect`
      γ = 0.02, σ_ε = 0.003 — well above noise.

  * `seasonal_medium_effect`
      γ = 0.02, σ_ε = 0.003, adds a deterministic weekly cycle to BOTH
      series (the BSTS's `seasonal=7` component should soak it up).

Each scenario runs `n_seeds` independent worlds, records the bespoke BSTS
estimate + 95% CI, and reports bias / RMSE / coverage at 95% and 90%.
"""

from __future__ import annotations

import json
import warnings
from typing import Any

import numpy as np
import pandas as pd

from admatix_verifier.methods import bsts
from admatix_verifier.models import H0PacketSubset, VerifyRequest

from ._common import RunRecord, summarise_runs


_REQUEST = VerifyRequest(
    packet=H0PacketSubset(
        packet_id="pkt_validate_bsts",
        tenant_id="tenant_validate",
        account_ref="validation:bsts",
        goal="pre_post_lift",
        hypothesis="bespoke BSTS recovers known step effect",
        causal_status="experimental",
        guardrails={},
        evidence_refs=[],
    ),
    data_uri="file:///dev/null",
    action_log_uri=None,
    hint=None,
)


def _build_world(
    scenario: str,
    n_periods: int,
    true_delta: float,
    seed: int,
) -> tuple[pd.DataFrame, float, dict[str, Any]]:
    rng = np.random.default_rng(seed)
    baseline = 0.03
    drift = 0.0
    sigma_eps = 0.003
    sigma_omega = 0.002
    sigma_u = 0.004
    beta = 0.5

    t = np.arange(n_periods, dtype=float)
    u_t = rng.normal(0.0, sigma_u, size=n_periods)
    omega = rng.normal(0.0, sigma_omega, size=n_periods)
    eps = rng.normal(0.0, sigma_eps, size=n_periods)

    control_rate = baseline + drift * t + omega
    treated_rate = control_rate + beta * u_t + eps

    seasonal = (scenario == "seasonal_medium_effect")
    if seasonal:
        # Deterministic weekly cycle on BOTH series — the BSTS's stochastic
        # weekly seasonal component should absorb it; failure to do so would
        # spill into the gap and bias `δ̂`.
        amplitude = 0.004
        cycle = amplitude * np.sin(2 * np.pi * t / 7.0)
        control_rate = control_rate + cycle
        treated_rate = treated_rate + cycle

    pre_end = n_periods // 2
    post_mask = (np.arange(n_periods) >= pre_end).astype(float)
    treated_rate = treated_rate + true_delta * post_mask

    # Clip into [eps, 1-eps] before recording so downstream `(0,1)` checks
    # don't choke on a stray negative tail.
    control_rate = np.clip(control_rate, 1e-4, 1 - 1e-4)
    treated_rate = np.clip(treated_rate, 1e-4, 1 - 1e-4)

    # Two rows per period — one treated, one control — with `outcome` set to
    # the period's observed rate. `_daily_series`'s sum/count aggregation
    # recovers the rate exactly.
    rows = []
    for p in range(n_periods):
        rows.append({"period": int(p), "treatment": 1, "outcome": float(treated_rate[p])})
        rows.append({"period": int(p), "treatment": 0, "outcome": float(control_rate[p])})
    events = pd.DataFrame(rows)

    config = {
        "scenario": scenario,
        "n_periods": n_periods,
        "true_delta": true_delta,
        "seed": seed,
        "sigma_eps": sigma_eps,
        "sigma_omega": sigma_omega,
        "sigma_u": sigma_u,
        "beta": beta,
        "seasonal": seasonal,
    }
    return events, float(true_delta), config


def _scenarios() -> list[dict[str, Any]]:
    return [
        {"scenario": "no_seasonal_small_effect", "n_periods": 60, "true_delta": 0.005},
        {"scenario": "no_seasonal_medium_effect", "n_periods": 60, "true_delta": 0.02},
        {"scenario": "seasonal_medium_effect", "n_periods": 60, "true_delta": 0.02},
    ]


def run_bsts_validation(n_seeds: int = 100) -> dict[str, Any]:
    """Run all BSTS scenarios and return a structured results dict."""

    out: dict[str, Any] = {
        "config": {"n_seeds": n_seeds},
        "scenarios": {},
    }
    for cfg in _scenarios():
        scenario = cfg["scenario"]
        n_periods = cfg["n_periods"]
        true_delta = cfg["true_delta"]
        runs: list[RunRecord] = []
        diag_acc: dict[str, float] = {"mean_se": 0.0}
        with warnings.catch_warnings():
            warnings.simplefilter("ignore")
            for k in range(n_seeds):
                seed = 2000 + k
                events, truth, _config = _build_world(scenario, n_periods, true_delta, seed)
                result = bsts.run(_REQUEST, events)
                runs.append(
                    RunRecord(
                        seed=seed,
                        truth=truth,
                        estimate=result.estimate,
                        ci_low=result.ci_low,
                        ci_high=result.ci_high,
                        extras={"posterior_se": float(result.diagnostics.get("posterior_se", 0.0))},
                    )
                )
                diag_acc["mean_se"] += float(result.diagnostics.get("posterior_se", 0.0))
        summary = summarise_runs(runs)
        summary["mean_posterior_se"] = diag_acc["mean_se"] / max(n_seeds, 1)
        summary["true_delta"] = true_delta
        summary["n_periods"] = n_periods
        out["scenarios"][scenario] = summary
    return out


if __name__ == "__main__":
    summary = run_bsts_validation()
    print(json.dumps(summary, indent=2, default=float))
