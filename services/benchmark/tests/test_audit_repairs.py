"""Audit repair tests for leakage, LLM accounting, and proof readiness."""

from __future__ import annotations

from dataclasses import replace
from pathlib import Path

import pytest

from admatix_benchmark.buyer import BasicPolicyBuyer
from admatix_benchmark.buyer.llm import ClaudeBuyerConfig, ClaudeHeadlessBuyer
from admatix_benchmark.cli import run_matrix
from admatix_benchmark.env import CampaignReportedView, SimulatedAdAccountEnv
from admatix_benchmark.gate import PassThroughGate
from admatix_benchmark.leakage import assert_no_future_leakage
from admatix_benchmark.metrics import build_scorecard
from admatix_benchmark.runner import ArmRunConfig, RunResult, run_one
from admatix_benchmark.scenarios import build_env_config


def _run(
    *,
    arm: str = "A",
    buyer_kind: str = "policy",
    row_kind: str = "policy",
    row_status: str = "completed",
) -> RunResult:
    cfg = ArmRunConfig(
        arm=arm,
        skill_tier="basic",
        gate_label="no_admatix",
        buyer_kind=buyer_kind,
        world_type="clean_ab",
        seed=17,
    )
    return RunResult(
        config=cfg,
        env_config_summary={},
        decision_timeline=[],
        final_scores={
            "total_spend": 100.0,
            "reported_revenue": 200.0,
            "true_incremental_revenue": 50.0,
            "reported_roas": 2.0,
            "true_iroas": 0.5,
            "net_incremental_value": -50.0,
            "wasted_spend": 25.0,
            "true_lift_captured": 50.0,
            "campaigns": [],
        },
        counts={
            "decisions": 1,
            "proposals": 1,
            "scale_up_proposals": 0,
            "scale_ups_applied": 0,
            "scale_ups_blocked_by_gate": 0,
            "false_scale_ups_prevented": 0,
            "true_scale_ups_prevented": 0,
            "pause_proposals": 0,
            "pauses_applied": 0,
        },
        row_kind=row_kind,
        row_status=row_status,
    )


def test_leakage_guard_rejects_future_named_fields():
    payload = {
        "campaign_id": "camp_1",
        "lifetime_reported_roas": 2.1,
        "future_true_iroas": 0.0,
    }

    with pytest.raises(ValueError, match="future_true_iroas"):
        assert_no_future_leakage(payload, source="buyer prompt")


def test_buyer_prompt_fields_pass_leakage_guard():
    visible = CampaignReportedView(
        campaign_id="camp_1",
        status="active",
        daily_budget=100.0,
        lifetime_spend=250.0,
        lifetime_reported_revenue=700.0,
        lifetime_reported_conversions=7.0,
        lifetime_reported_roas=2.8,
        last_window_days=7,
        last_window_spend=100.0,
        last_window_reported_revenue=280.0,
        last_window_reported_conversions=3.0,
        last_window_reported_roas=2.8,
        days_active=7,
    )

    assert_no_future_leakage(visible.to_dict(), source="buyer prompt")


def test_runner_rejects_future_window_snapshot_before_buyer_sees_it(tmp_path: Path):
    cfg = build_env_config("clean_ab", seed=17, data_dir=tmp_path)

    class FutureWindowEnv:
        def __init__(self, env_cfg):
            self._inner = SimulatedAdAccountEnv(env_cfg)

        def __getattr__(self, name):
            return getattr(self._inner, name)

        def reported_snapshot(self):
            return [
                replace(row, last_window_days=row.days_active + 1)
                for row in self._inner.reported_snapshot()
            ]

    with pytest.raises(ValueError, match="last_window_days"):
        run_one(
            config=ArmRunConfig("A", "basic", "no_admatix", "policy", "clean_ab", 17),
            env_config=cfg,
            buyer=BasicPolicyBuyer(),
            gate=PassThroughGate(),
            skill_pack_text="basic",
            env_factory=FutureWindowEnv,
        )


def test_scorecard_counts_llm_provenance_and_blocks_proof_without_real_llm():
    rows = [
        _run(row_kind="policy", buyer_kind="policy"),
        _run(row_kind="llm_fallback", buyer_kind="llm", row_status="fallback"),
        _run(row_kind="llm_failed", buyer_kind="llm", row_status="failed"),
        _run(row_kind="llm_skipped", buyer_kind="llm", row_status="skipped"),
    ]

    scorecard = build_scorecard(
        rows,
        config_summary={"seeds_llm": [17], "seeds_policy": [17]},
        run_id="bench_test",
        generated_at="2026-05-23T00:00:00Z",
    )

    assert scorecard["llm_lane_accounting"] == {
        "policy_rows": 1,
        "real_llm_rows": 0,
        "deterministic_fallback_rows": 1,
        "failed_llm_rows": 1,
        "skipped_llm_rows": 1,
    }
    assert scorecard["proof_readiness"]["status"] == "BLOCKED"
    assert "requires_nonzero_real_llm_rows" in scorecard["proof_readiness"]["blocking_reasons"]


def test_scorecard_proof_ready_only_with_real_llm_row():
    scorecard = build_scorecard(
        [_run(row_kind="llm_real", buyer_kind="llm")],
        config_summary={"seeds_llm": [17], "seeds_policy": []},
        run_id="bench_test",
        generated_at="2026-05-23T00:00:00Z",
    )

    assert scorecard["llm_lane_accounting"]["real_llm_rows"] == 1
    assert scorecard["proof_readiness"]["status"] == "READY"
    assert scorecard["proof_readiness"]["claim_limit"] == (
        "calibrated simulator/public RCT proof only; no live spend lift claim"
    )


def test_cli_skip_llm_records_skipped_rows_and_blocks_proof(tmp_path: Path):
    scorecard = run_matrix(
        out_dir=tmp_path / "out",
        data_dir=tmp_path / "data",
        seeds_llm=[17],
        seeds_policy=[17],
        world_types=["clean_ab"],
        arms=["A"],
        model="claude-haiku-4-5-20251001",
        skip_llm=True,
        decisions_runs=1,
    )

    assert scorecard["llm_lane_accounting"]["skipped_llm_rows"] == 1
    assert scorecard["llm_lane_accounting"]["real_llm_rows"] == 0
    assert scorecard["proof_readiness"]["status"] == "BLOCKED"


def test_cli_fallback_rows_are_not_counted_as_real_llm(tmp_path: Path):
    scorecard = run_matrix(
        out_dir=tmp_path / "out",
        data_dir=tmp_path / "data",
        seeds_llm=[17],
        seeds_policy=[],
        world_types=["clean_ab"],
        arms=["A"],
        model="claude-haiku-4-5-20251001",
        skip_llm=False,
        decisions_runs=1,
        buyer_factory=lambda skill_tier, buyer_kind, model: ClaudeHeadlessBuyer(
            ClaudeBuyerConfig(skill_tier=skill_tier, binary="definitely-not-claude")
        ),
    )

    assert scorecard["llm_lane_accounting"]["deterministic_fallback_rows"] == 1
    assert scorecard["llm_lane_accounting"]["real_llm_rows"] == 0
    assert scorecard["proof_readiness"]["status"] == "BLOCKED"
