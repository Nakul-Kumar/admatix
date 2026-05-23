"""Layer (e) — Off-policy evaluation: IPW / SNIPS / Doubly Robust.

Implementation note: `obp==0.5.*` (the spec's preferred OPE library) locks
pandas<2.2, incompatible with the rest of the verifier's pin set. We
implement IPW, SNIPS, and DR directly in numpy with the standard closed-form
estimators and influence-function-style asymptotic CIs. Each estimator is
clipped at the standard weight-clip threshold; extreme weight concentration
returns `inconclusive` with `reason="extreme_weights"`.

Required input columns on the events frame:
  - `logging_propensity` ∈ (0, 1)   — the logging policy's P(treat | x)
  - `new_policy_propensity` ∈ {0,1} or (0,1) — the new policy's action / prob
  - `outcome` ∈ [0, 1]              — observed reward under the logging policy
"""

from __future__ import annotations

from typing import Any

import numpy as np
import pandas as pd
from scipy import stats

from ..models import MethodResult, VerifyRequest


_DEFAULT_WEIGHT_CLIP = 10.0


def _ips(weights: np.ndarray, rewards: np.ndarray) -> tuple[float, float]:
    estimates = weights * rewards
    value = float(np.mean(estimates))
    se = float(np.std(estimates, ddof=1) / np.sqrt(len(estimates)))
    return value, se


def _snips(weights: np.ndarray, rewards: np.ndarray) -> tuple[float, float]:
    denom = float(np.mean(weights))
    if denom == 0:
        return 0.0, float("inf")
    value = float(np.mean(weights * rewards) / denom)
    # Influence-function-style SE for the self-normalized estimator.
    residual = (weights * rewards - value * weights) / denom
    se = float(np.std(residual, ddof=1) / np.sqrt(len(residual)))
    return value, se


def _doubly_robust(
    weights: np.ndarray,
    rewards: np.ndarray,
    q_hat: np.ndarray,
    actions: np.ndarray,
    new_actions: np.ndarray,
) -> tuple[float, float]:
    # Standard DR: E[q(x, π(x)) + W·(r − q(x, a))].
    estimates = q_hat + (actions == new_actions).astype(float) * weights * (rewards - q_hat)
    value = float(np.mean(estimates))
    se = float(np.std(estimates, ddof=1) / np.sqrt(len(estimates)))
    return value, se


def _ess(weights: np.ndarray) -> float:
    total = float(np.sum(weights))
    if total == 0:
        return 0.0
    return float(total * total / np.sum(weights * weights))


def run(req: VerifyRequest, events: pd.DataFrame) -> MethodResult:
    required = {"logging_propensity", "outcome"}
    missing = required - set(events.columns)
    if missing:
        return MethodResult(
            method="ope_ips_snips_dr",
            estimate=None,
            ci_low=None,
            ci_high=None,
            verdict="inconclusive",
            causal_status="inconclusive",
            confounders=[],
            diagnostics={"reason": "missing_columns", "missing": sorted(missing)},
        )

    logging_prop = events["logging_propensity"].to_numpy(dtype=float)
    rewards = events["outcome"].to_numpy(dtype=float)
    if "treatment" in events.columns:
        actions = events["treatment"].to_numpy(dtype=int)
    else:
        actions = np.ones(len(events), dtype=int)
    new_actions = (
        events["new_policy_propensity"].to_numpy(dtype=float)
        if "new_policy_propensity" in events.columns
        else np.ones(len(events), dtype=float)
    )
    # If the new policy is given as a 0/1 deterministic action.
    if set(np.unique(new_actions.astype(int))) <= {0, 1}:
        new_action_int = new_actions.astype(int)
    else:
        new_action_int = (np.random.default_rng(17).random(len(events)) < new_actions).astype(int)

    weight_clip = _DEFAULT_WEIGHT_CLIP
    if req.hint and isinstance(req.hint.get("weight_clip"), (int, float)):
        weight_clip = float(req.hint["weight_clip"])

    raw_weights = np.where(
        new_action_int == 1,
        np.divide(1.0, np.clip(logging_prop, 1e-6, 1.0)),
        np.divide(1.0, np.clip(1.0 - logging_prop, 1e-6, 1.0)),
    )
    # Apply IPS only on rows where the logged action matches the new policy.
    indicator = (actions == new_action_int).astype(float)
    weights_eff = raw_weights * indicator
    clipped = np.clip(weights_eff, 0.0, weight_clip)

    ess = _ess(clipped)
    extreme = float(np.mean(weights_eff > weight_clip))

    ips_value, ips_se = _ips(clipped, rewards)
    snips_value, snips_se = _snips(clipped, rewards)
    # Cheap outcome model: empirical mean of reward by action.
    q_hat = np.where(
        new_action_int == 1,
        float(np.mean(rewards[actions == 1])) if (actions == 1).any() else float(np.mean(rewards)),
        float(np.mean(rewards[actions == 0])) if (actions == 0).any() else float(np.mean(rewards)),
    )
    dr_value, dr_se = _doubly_robust(clipped, rewards, q_hat, actions, new_action_int)

    z = float(stats.norm.ppf(0.975))
    estimators: dict[str, Any] = {
        "ips": {"value": ips_value, "ci_low": ips_value - z * ips_se, "ci_high": ips_value + z * ips_se, "se": ips_se},
        "snips": {
            "value": snips_value,
            "ci_low": snips_value - z * snips_se,
            "ci_high": snips_value + z * snips_se,
            "se": snips_se,
        },
        "dr": {"value": dr_value, "ci_low": dr_value - z * dr_se, "ci_high": dr_value + z * dr_se, "se": dr_se},
    }
    diagnostics: dict[str, Any] = {
        "estimators": estimators,
        "n_effective": ess,
        "weight_clip": weight_clip,
        "extreme_weight_fraction": extreme,
        "n_rows": int(len(events)),
        "backend": "numpy.ipw_snips_dr",
    }

    ess_threshold = max(20.0, 0.05 * len(events))
    if ess < ess_threshold or extreme > 0.2:
        diagnostics["reason"] = "extreme_weights"
        return MethodResult(
            method="ope_ips_snips_dr",
            estimate=snips_value,
            ci_low=estimators["snips"]["ci_low"],
            ci_high=estimators["snips"]["ci_high"],
            verdict="inconclusive",
            causal_status="inconclusive",
            confounders=["logging_propensity"],
            diagnostics=diagnostics,
        )

    estimate = snips_value
    ci_low = estimators["snips"]["ci_low"]
    ci_high = estimators["snips"]["ci_high"]
    verdict = "lift_detected" if ci_low > 0 else "no_effect" if ci_high < 0 else "inconclusive"
    causal_status = "experimental" if verdict == "lift_detected" else "inconclusive"

    return MethodResult(
        method="ope_ips_snips_dr",
        estimate=float(estimate),
        ci_low=float(ci_low),
        ci_high=float(ci_high),
        verdict=verdict,
        causal_status=causal_status,
        confounders=["logging_propensity"],
        diagnostics=diagnostics,
    )


__all__ = ["run"]
