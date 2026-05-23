"""Tests for the AdMatix gate — both the pass-through and the verifier-backed
implementations.
"""

from __future__ import annotations

from pathlib import Path

import pytest

from admatix_benchmark.env import BuyerAction, SimulatedAdAccountEnv
from admatix_benchmark.gate import AdMatixGate, PassThroughGate
from admatix_benchmark.scenarios import build_env_config


def _env(world: str, seed: int, tmp_path: Path) -> SimulatedAdAccountEnv:
    cfg = build_env_config(world, seed, data_dir=tmp_path)
    env = SimulatedAdAccountEnv(cfg)
    # Tick once so there's some history to verify against (the verifier
    # actually reads the whole simulator world, not just the to-date slice,
    # but we want a realistic call shape).
    for _ in range(7):
        env.tick()
    return env


def test_passthrough_gate_applies_everything(tmp_path: Path):
    env = _env("clean_ab", seed=17, tmp_path=tmp_path)
    gate = PassThroughGate()
    proposals = [
        BuyerAction(campaign_id="c_winner", action_type="scale_up", delta_pct=30),
        BuyerAction(campaign_id="c_dud", action_type="pause"),
    ]
    decisions = gate.apply(proposals, env)
    assert all(d.outcome == "applied" for d in decisions)
    assert all(d.gate_invoked is False for d in decisions)
    # final actions are unchanged.
    assert decisions[0].final_action.action_type == "scale_up"
    assert decisions[1].final_action.action_type == "pause"


def test_admatix_gate_calls_verifier_on_scale_up_only(tmp_path: Path):
    env = _env("clean_ab", seed=17, tmp_path=tmp_path)
    gate = AdMatixGate()
    proposals = [
        BuyerAction(campaign_id="c_winner", action_type="scale_up", delta_pct=20),
        BuyerAction(campaign_id="c_dud", action_type="hold"),
        BuyerAction(campaign_id="c_meh", action_type="pause"),
    ]
    decisions = gate.apply(proposals, env)
    by_cid = {d.proposal.campaign_id: d for d in decisions}
    # Only the scale_up triggers the verifier.
    assert by_cid["c_winner"].gate_invoked is True
    assert by_cid["c_dud"].gate_invoked is False
    assert by_cid["c_meh"].gate_invoked is False
    # Non-scale-up actions pass through.
    assert by_cid["c_dud"].outcome == "applied"
    assert by_cid["c_meh"].outcome == "applied"


def test_admatix_gate_holds_on_zero_lift_placebo(tmp_path: Path):
    # On a placebo world the verifier should NOT confirm lift; the gate must
    # therefore NOT allow scale-ups. Verdict may be inconclusive or no_effect;
    # both must NOT be "applied".
    env = _env("zero_lift_placebo", seed=17, tmp_path=tmp_path)
    gate = AdMatixGate()
    proposals = [
        BuyerAction(campaign_id="c_placebo_1", action_type="scale_up", delta_pct=30),
    ]
    decisions = gate.apply(proposals, env)
    assert decisions[0].outcome in ("held", "cut")
    assert decisions[0].verifier_verdict in ("inconclusive", "no_effect")


def test_admatix_gate_records_verifier_estimate_and_method(tmp_path: Path):
    env = _env("clean_ab", seed=17, tmp_path=tmp_path)
    gate = AdMatixGate()
    proposals = [
        BuyerAction(campaign_id="c_winner", action_type="scale_up", delta_pct=20),
    ]
    decisions = gate.apply(proposals, env)
    d = decisions[0]
    assert d.gate_invoked is True
    assert d.verifier_method is not None
    # Some scale-up should produce a non-null estimate (CATE on clean A/B).
    assert d.verifier_estimate is not None
