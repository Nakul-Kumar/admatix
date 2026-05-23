"""Analytic ground-truth Monte-Carlo for the bespoke OPE estimators.

Three controlled scenarios where the true policy value V(π) is closed-form:

  * `const_prop_always_treat`
      Logging propensity p = 0.5 (constant). Logged action ~ Bern(p).
      Reward | A=1 ~ Bern(p_treat); Reward | A=0 ~ Bern(p_control).
      Target policy: π(x) = 1 always. True V(π) = p_treat.

  * `const_prop_split_policy`
      Same logging model. Target policy: π(x) = 1 on the first half of
      rows by index, 0 on the second half. Deterministic, heterogeneous.
      True V(π) = 0.5 · p_treat + 0.5 · p_control.

  * `varying_prop_always_treat`
      Logging propensity p_i ~ Beta(2, 2). Logged action ~ Bern(p_i).
      Reward | A=1 ~ Bern(p_treat); Reward | A=0 ~ Bern(p_control).
      Target policy: π(x) = 1 always. True V(π) = p_treat.

Each scenario runs `n_seeds` independent worlds at the same `n_users`,
records the bespoke IPS / SNIPS / DR estimates plus their CIs, and reports
bias, RMSE, and CI-coverage (at the 95% level the verifier emits AND at a
rescaled 90% level for the regression-test acceptance threshold).
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import numpy as np
import pandas as pd

from admatix_verifier.methods import ope
from admatix_verifier.models import H0PacketSubset, VerifyRequest

from ._common import RunRecord, summarise_runs


_REQUEST = VerifyRequest(
    packet=H0PacketSubset(
        packet_id="pkt_validate_ope",
        tenant_id="tenant_validate",
        account_ref="validation:ope",
        goal="off_policy_eval",
        hypothesis="bespoke OPE recovers known policy value",
        causal_status="experimental",
        guardrails={},
        evidence_refs=[],
    ),
    data_uri="file:///dev/null",
    action_log_uri=None,
    hint={"weight_clip": 20.0},
)


def _build_world(
    scenario: str,
    n: int,
    p_treat: float,
    p_control: float,
    seed: int,
) -> tuple[pd.DataFrame, float, dict[str, Any]]:
    rng = np.random.default_rng(seed)
    if scenario == "const_prop_always_treat":
        logging_p = np.full(n, 0.5)
        treatment = (rng.random(n) < logging_p).astype(int)
        new_action = np.ones(n, dtype=int)
        true_value = p_treat
    elif scenario == "const_prop_split_policy":
        logging_p = np.full(n, 0.5)
        treatment = (rng.random(n) < logging_p).astype(int)
        new_action = np.zeros(n, dtype=int)
        new_action[: n // 2] = 1
        true_value = 0.5 * p_treat + 0.5 * p_control
    elif scenario == "varying_prop_always_treat":
        logging_p = rng.beta(2.0, 2.0, size=n)
        # Clip out tail mass so even at small n we avoid 1 / 1e-12 spikes.
        logging_p = np.clip(logging_p, 0.1, 0.9)
        treatment = (rng.random(n) < logging_p).astype(int)
        new_action = np.ones(n, dtype=int)
        true_value = p_treat
    else:
        raise ValueError(f"unknown scenario: {scenario}")

    rewards = (rng.random(n) < np.where(treatment == 1, p_treat, p_control)).astype(float)
    events = pd.DataFrame(
        {
            "logging_propensity": logging_p,
            "treatment": treatment,
            "outcome": rewards,
            "new_policy_propensity": new_action.astype(float),
        }
    )
    config = {
        "scenario": scenario,
        "n": n,
        "p_treat": p_treat,
        "p_control": p_control,
        "seed": seed,
        "true_value": true_value,
    }
    return events, float(true_value), config


def _records_for(
    scenario: str,
    n: int,
    p_treat: float,
    p_control: float,
    n_seeds: int,
    seed0: int = 1000,
) -> tuple[dict[str, list[RunRecord]], list[dict[str, Any]]]:
    by_estimator: dict[str, list[RunRecord]] = {"ips": [], "snips": [], "dr": []}
    raw: list[dict[str, Any]] = []
    for k in range(n_seeds):
        seed = seed0 + k
        events, truth, _config = _build_world(scenario, n, p_treat, p_control, seed)
        result = ope.run(_REQUEST, events)
        diag = result.diagnostics.get("estimators", {}) or {}
        for name in ("ips", "snips", "dr"):
            est = diag.get(name, {})
            by_estimator[name].append(
                RunRecord(
                    seed=seed,
                    truth=truth,
                    estimate=(float(est["value"]) if est.get("value") is not None else None),
                    ci_low=(float(est["ci_low"]) if est.get("ci_low") is not None else None),
                    ci_high=(float(est["ci_high"]) if est.get("ci_high") is not None else None),
                )
            )
        raw.append(
            {
                "scenario": scenario,
                "seed": seed,
                "truth": truth,
                "verdict": result.verdict,
                "reason": result.diagnostics.get("reason"),
                "n_effective": float(result.diagnostics.get("n_effective", 0.0)),
                "extreme_weight_fraction": float(result.diagnostics.get("extreme_weight_fraction", 0.0)),
                "estimators": diag,
            }
        )
    return by_estimator, raw


def run_ope_validation(n_seeds: int = 200, n_users: int = 4000) -> dict[str, Any]:
    """Run all three OPE scenarios and return a structured results dict."""

    p_treat = 0.30
    p_control = 0.10

    out: dict[str, Any] = {
        "config": {
            "n_seeds": n_seeds,
            "n_users": n_users,
            "p_treat": p_treat,
            "p_control": p_control,
        },
        "scenarios": {},
    }

    scenarios = (
        "const_prop_always_treat",
        "const_prop_split_policy",
        "varying_prop_always_treat",
    )
    for scenario in scenarios:
        by_est, raw = _records_for(scenario, n_users, p_treat, p_control, n_seeds)
        out["scenarios"][scenario] = {
            "ips": summarise_runs(by_est["ips"]),
            "snips": summarise_runs(by_est["snips"]),
            "dr": summarise_runs(by_est["dr"]),
        }
    return out


if __name__ == "__main__":
    summary = run_ope_validation()
    print(json.dumps(summary, indent=2, default=float))
