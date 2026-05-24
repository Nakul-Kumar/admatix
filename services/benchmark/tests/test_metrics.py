"""Tests for scorecard aggregation."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

import pytest

from admatix_benchmark.metrics import (
    aggregate_by_arm,
    build_scorecard,
    head_to_head,
    per_world_breakdown,
)
from admatix_benchmark.runner import ArmRunConfig, RunResult


def _make_run(
    arm: str,
    world: str,
    seed: int,
    *,
    buyer_kind: str = "policy",
    skill_tier: str = "basic",
    total_spend: float = 1000.0,
    reported_revenue: float = 3000.0,
    reported_roas: float = 3.0,
    true_incremental_revenue: float = 1500.0,
    true_iroas: float = 1.5,
    net_incremental_value: float = 500.0,
    wasted_spend: float = 200.0,
    true_lift_captured: float = 1500.0,
    scale_up_proposals: int = 5,
    scale_ups_applied: int = 3,
    scale_ups_blocked_by_gate: int = 2,
    false_scale_ups_prevented: int = 1,
    true_scale_ups_prevented: int = 1,
    pause_proposals: int = 1,
    pauses_applied: int = 1,
    decisions: int = 4,
) -> RunResult:
    cfg = ArmRunConfig(
        arm=arm,
        skill_tier=skill_tier,
        gate_label="no_admatix" if arm in ("A", "C") else "with_admatix",
        buyer_kind=buyer_kind,
        world_type=world,
        seed=seed,
    )
    return RunResult(
        config=cfg,
        env_config_summary={
            "account_id": f"{world}__seed{seed}",
            "n_campaigns": 3,
            "n_periods": 28,
            "decision_every_n_days": 7,
            "campaign_specs": [],
        },
        decision_timeline=[],
        final_scores={
            "total_spend": total_spend,
            "reported_revenue": reported_revenue,
            "true_incremental_revenue": true_incremental_revenue,
            "reported_roas": reported_roas,
            "true_iroas": true_iroas,
            "net_incremental_value": net_incremental_value,
            "wasted_spend": wasted_spend,
            "true_lift_captured": true_lift_captured,
            "campaigns": [],
        },
        counts={
            "decisions": decisions,
            "proposals": scale_up_proposals + pause_proposals,
            "scale_up_proposals": scale_up_proposals,
            "scale_ups_applied": scale_ups_applied,
            "scale_ups_blocked_by_gate": scale_ups_blocked_by_gate,
            "false_scale_ups_prevented": false_scale_ups_prevented,
            "true_scale_ups_prevented": true_scale_ups_prevented,
            "pause_proposals": pause_proposals,
            "pauses_applied": pauses_applied,
        },
    )


def test_aggregate_by_arm_mean_sd_n():
    runs = [
        _make_run("A", "clean_ab", 1, total_spend=1000),
        _make_run("A", "clean_ab", 2, total_spend=1500),
        _make_run("A", "confounded", 1, total_spend=2000),
    ]
    rows = [
        {
            "arm": r.config.arm,
            "world_type": r.config.world_type,
            "seed": r.config.seed,
            "buyer_kind": r.config.buyer_kind,
            "skill_tier": r.config.skill_tier,
            "total_spend": r.final_scores["total_spend"],
            "reported_roas": r.final_scores["reported_roas"],
            "true_iroas": r.final_scores["true_iroas"],
            "net_incremental_value": r.final_scores["net_incremental_value"],
            "wasted_spend": r.final_scores["wasted_spend"],
            "true_lift_captured": r.final_scores["true_lift_captured"],
            "false_scale_ups_prevented": r.counts["false_scale_ups_prevented"],
        }
        for r in runs
    ]
    agg = aggregate_by_arm(rows, "A")
    assert agg["total_spend"]["mean"] == 1500.0
    assert agg["total_spend"]["n"] == 3


def test_aggregate_by_arm_uses_nulls_for_no_data():
    agg = aggregate_by_arm([], "D")

    assert agg["n_runs"] == 0
    assert agg["total_spend"] == {"mean": None, "sd": None, "n": 0}
    assert agg["net_incremental_value"] == {"mean": None, "sd": None, "n": 0}


def test_head_to_head_pairs_on_world_seed_buyer_tier():
    rows = [
        {
            "arm": "A", "world_type": "clean_ab", "seed": 1, "buyer_kind": "policy",
            "skill_tier": "basic", "net_incremental_value": 100.0, "wasted_spend": 50.0,
            "true_iroas": 0.5,
        },
        {
            "arm": "B", "world_type": "clean_ab", "seed": 1, "buyer_kind": "policy",
            "skill_tier": "basic", "net_incremental_value": 200.0, "wasted_spend": 20.0,
            "true_iroas": 0.8,
        },
        {
            "arm": "A", "world_type": "confounded", "seed": 1, "buyer_kind": "policy",
            "skill_tier": "basic", "net_incremental_value": 0.0, "wasted_spend": 100.0,
            "true_iroas": 0.0,
        },
        {
            "arm": "B", "world_type": "confounded", "seed": 1, "buyer_kind": "policy",
            "skill_tier": "basic", "net_incremental_value": 50.0, "wasted_spend": 30.0,
            "true_iroas": 0.3,
        },
    ]
    h2h = head_to_head(rows, "B", "A")
    assert h2h["n_paired"] == 2
    # B beats A on both → win_rate = 1.0.
    assert h2h["win_rate_over_worlds"] == 1.0
    # Mean delta net = ((200-100)+(50-0))/2 = 75
    assert h2h["delta_net_incremental_value_mean"] == 75.0
    # Mean delta wasted = ((20-50)+(30-100))/2 = -50
    assert h2h["delta_wasted_spend_mean"] == -50.0


def test_head_to_head_uses_nulls_when_unpaired():
    h2h = head_to_head([], "B", "A")

    assert h2h == {
        "delta_net_incremental_value_mean": None,
        "delta_wasted_spend_mean": None,
        "delta_true_iroas_mean": None,
        "win_rate_over_worlds": None,
        "n_paired": 0,
    }


def test_per_world_breakdown_buckets_correctly():
    rows = [
        {
            "arm": "A", "world_type": "clean_ab", "seed": 1, "buyer_kind": "policy",
            "skill_tier": "basic", "net_incremental_value": 100.0, "wasted_spend": 50.0,
            "true_iroas": 0.5, "total_spend": 1000, "false_scale_ups_prevented": 0,
        },
        {
            "arm": "B", "world_type": "clean_ab", "seed": 1, "buyer_kind": "policy",
            "skill_tier": "basic", "net_incremental_value": 200.0, "wasted_spend": 20.0,
            "true_iroas": 0.8, "total_spend": 800, "false_scale_ups_prevented": 2,
        },
    ]
    out = per_world_breakdown(rows)
    assert "clean_ab" in out
    assert out["clean_ab"]["A"]["n_runs"] == 1
    assert out["clean_ab"]["B"]["n_runs"] == 1


def test_build_scorecard_has_required_top_level_keys():
    runs = [_make_run("A", "clean_ab", 1), _make_run("B", "clean_ab", 1)]
    sc = build_scorecard(
        runs,
        config_summary={"seeds_llm": [], "seeds_policy": [1]},
        run_id="bench_test",
        generated_at="2026-05-23T00:00:00Z",
    )
    for key in (
        "schema_version",
        "run_id",
        "generated_at",
        "config",
        "by_run",
        "by_arm",
        "head_to_head",
    ):
        assert key in sc
    assert {"A", "B", "C", "D"} <= sc["by_arm"].keys()
