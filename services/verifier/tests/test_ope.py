"""Acceptance test 6 — OPE (IPS / SNIPS / DR)."""

from __future__ import annotations

import numpy as np
import pandas as pd

from admatix_verifier.methods import ope
from admatix_verifier.models import H0PacketSubset, VerifyRequest


def _request(hint: dict | None = None) -> VerifyRequest:
    packet = H0PacketSubset(
        packet_id="pkt_ope",
        tenant_id="tenant_test",
        account_ref="fixture:ope",
        goal="off_policy_eval",
        hypothesis="new policy beats logging",
        causal_status="experimental",
        guardrails={},
        evidence_refs=[],
    )
    return VerifyRequest(
        packet=packet,
        data_uri="file:///dev/null",
        action_log_uri=None,
        hint=hint,
    )


def _build_events(
    n: int,
    logging_p: float,
    true_value_treat: float,
    true_value_control: float,
    new_policy_prob: float,
    seed: int = 17,
) -> pd.DataFrame:
    rng = np.random.default_rng(seed)
    treatment = (rng.random(n) < logging_p).astype(int)
    rewards = rng.random(n) < np.where(treatment == 1, true_value_treat, true_value_control)
    new_action = (rng.random(n) < new_policy_prob).astype(int)
    return pd.DataFrame(
        {
            "logging_propensity": np.full(n, logging_p),
            "treatment": treatment,
            "outcome": rewards.astype(float),
            "new_policy_propensity": new_action.astype(float),
        }
    )


def test_ope_recovers_known_value_with_clean_overlap():
    n = 8000
    logging_p = 0.5
    true_treat = 0.30
    true_control = 0.10
    # New policy: always treat (action == 1 everywhere). Known value = true_treat.
    events = _build_events(n, logging_p, true_treat, true_control, new_policy_prob=1.0)
    req = _request(hint={"weight_clip": 10.0})
    result = ope.run(req, events)
    assert result.method == "ope_ips_snips_dr"
    estimators = result.diagnostics["estimators"]
    for name in ("ips", "snips", "dr"):
        assert name in estimators
        assert "value" in estimators[name]
        assert "ci_low" in estimators[name]
        assert "ci_high" in estimators[name]
    snips_value = float(estimators["snips"]["value"])
    assert abs(snips_value - true_treat) <= 0.15 * true_treat


def test_ope_returns_inconclusive_on_extreme_weights():
    n = 4000
    rng = np.random.default_rng(13)
    treatment = (rng.random(n) < 0.5).astype(int)
    rewards = rng.random(n) < np.where(treatment == 1, 0.3, 0.1)
    # Pathological logging propensity — concentrated extremely close to 0 or 1
    # → weights blow up under a deterministic always-treat new policy.
    logging_p = rng.uniform(1e-4, 5e-4, size=n)
    events = pd.DataFrame(
        {
            "logging_propensity": logging_p,
            "treatment": treatment,
            "outcome": rewards.astype(float),
            "new_policy_propensity": np.ones(n),
        }
    )
    req = _request(hint={"weight_clip": 5.0})
    result = ope.run(req, events)
    assert result.method == "ope_ips_snips_dr"
    assert result.verdict == "inconclusive"
    assert result.diagnostics.get("reason") == "extreme_weights"
