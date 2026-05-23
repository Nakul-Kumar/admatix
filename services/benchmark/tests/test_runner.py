"""Tests for the runner — including the critical 'identical buyer across arms
within a skill tier' contract.
"""

from __future__ import annotations

from pathlib import Path

from admatix_benchmark.buyer import BasicPolicyBuyer, ModernPolicyBuyer
from admatix_benchmark.gate import AdMatixGate, PassThroughGate
from admatix_benchmark.runner import ArmRunConfig, env_config_fingerprint, run_one
from admatix_benchmark.scenarios import build_env_config


def _arm_cfg(arm: str, skill_tier: str, gate_label: str) -> ArmRunConfig:
    return ArmRunConfig(
        arm=arm,
        skill_tier=skill_tier,
        gate_label=gate_label,
        buyer_kind="policy",
        world_type="clean_ab",
        seed=17,
    )


def test_env_config_fingerprint_is_stable_across_arm_constructions(tmp_path: Path):
    cfg_a = build_env_config("confounded", seed=17, data_dir=tmp_path / "a")
    cfg_b = build_env_config("confounded", seed=17, data_dir=tmp_path / "b")
    assert env_config_fingerprint(cfg_a) == env_config_fingerprint(cfg_b)


def test_arms_a_and_b_see_identical_proposals_until_gate(tmp_path: Path):
    """Identical buyer + identical env → identical buyer proposals.

    The gate may rewrite gate_decisions but the buyer's `proposals` field
    in the decision timeline must be identical between A and B.
    """
    cfg_a = build_env_config("clean_ab", seed=17, data_dir=tmp_path / "a")
    cfg_b = build_env_config("clean_ab", seed=17, data_dir=tmp_path / "b")
    r_a = run_one(
        config=_arm_cfg("A", "basic", "no_admatix"),
        env_config=cfg_a,
        buyer=BasicPolicyBuyer(),
        gate=PassThroughGate(),
        skill_pack_text="basic",
    )
    r_b = run_one(
        config=_arm_cfg("B", "basic", "with_admatix"),
        env_config=cfg_b,
        buyer=BasicPolicyBuyer(),
        gate=AdMatixGate(),
        skill_pack_text="basic",
    )
    # Proposals must match decision-for-decision through the first decision
    # (before any post-gate divergence in env state can change subsequent
    # decisions).
    first_a = r_a.decision_timeline[0]["proposals"]
    first_b = r_b.decision_timeline[0]["proposals"]
    assert first_a == first_b


def test_arms_c_and_d_see_identical_proposals_until_gate(tmp_path: Path):
    cfg_c = build_env_config("clean_ab", seed=17, data_dir=tmp_path / "c")
    cfg_d = build_env_config("clean_ab", seed=17, data_dir=tmp_path / "d")
    r_c = run_one(
        config=_arm_cfg("C", "modern", "no_admatix"),
        env_config=cfg_c,
        buyer=ModernPolicyBuyer(),
        gate=PassThroughGate(),
        skill_pack_text="modern",
    )
    r_d = run_one(
        config=_arm_cfg("D", "modern", "with_admatix"),
        env_config=cfg_d,
        buyer=ModernPolicyBuyer(),
        gate=AdMatixGate(),
        skill_pack_text="modern",
    )
    assert r_c.decision_timeline[0]["proposals"] == r_d.decision_timeline[0]["proposals"]


def test_same_seed_same_arm_same_buyer_reproduces_exactly(tmp_path: Path):
    """Reproducibility: re-running an identical config gives an identical
    final scorecard. This is the floor for honest reporting.
    """
    cfg1 = build_env_config("confounded", seed=42, data_dir=tmp_path / "r1")
    cfg2 = build_env_config("confounded", seed=42, data_dir=tmp_path / "r2")
    r1 = run_one(
        config=_arm_cfg("B", "basic", "with_admatix"),
        env_config=cfg1,
        buyer=BasicPolicyBuyer(),
        gate=AdMatixGate(),
        skill_pack_text="basic",
    )
    r2 = run_one(
        config=_arm_cfg("B", "basic", "with_admatix"),
        env_config=cfg2,
        buyer=BasicPolicyBuyer(),
        gate=AdMatixGate(),
        skill_pack_text="basic",
    )
    assert r1.final_scores == r2.final_scores
    assert r1.counts == r2.counts


def test_runner_records_timeline_per_decision_day(tmp_path: Path):
    cfg = build_env_config("clean_ab", seed=17, data_dir=tmp_path)
    r = run_one(
        config=_arm_cfg("A", "basic", "no_admatix"),
        env_config=cfg,
        buyer=BasicPolicyBuyer(),
        gate=PassThroughGate(),
        skill_pack_text="basic",
    )
    # Horizon 28, cadence 7 → 4 decisions.
    assert len(r.decision_timeline) == 4
    for entry in r.decision_timeline:
        assert "reported_snapshot" in entry
        assert "proposals" in entry
        assert "gate_decisions" in entry
        assert "ground_truth_at_day" in entry


def test_runner_counts_track_proposals_and_outcomes(tmp_path: Path):
    cfg = build_env_config("zero_lift_placebo", seed=17, data_dir=tmp_path)
    r = run_one(
        config=_arm_cfg("B", "basic", "with_admatix"),
        env_config=cfg,
        buyer=BasicPolicyBuyer(),
        gate=AdMatixGate(),
        skill_pack_text="basic",
    )
    # Placebo + basic buyer should propose scale-ups (reported ROAS looks
    # great because of non-incremental conversions). AdMatix should block
    # all/most of them, increasing false_scale_ups_prevented.
    assert r.counts["scale_up_proposals"] >= 1
    # All campaigns are zero-lift → any blocked scale-up is a false-positive
    # prevented.
    assert (
        r.counts["false_scale_ups_prevented"]
        == r.counts["scale_ups_blocked_by_gate"]
    )
