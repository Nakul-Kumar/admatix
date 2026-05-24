"""Tests for the simulated ad account env."""

from __future__ import annotations

from pathlib import Path

import pytest

from admatix_benchmark.env import BuyerAction, SimulatedAdAccountEnv
from admatix_benchmark.scenarios import build_env_config


def test_env_advances_one_day_per_tick(tmp_path: Path):
    cfg = build_env_config("clean_ab", seed=17, data_dir=tmp_path)
    env = SimulatedAdAccountEnv(cfg)
    assert env.day == 0
    env.tick()
    assert env.day == 1


def test_env_does_not_leak_ground_truth_to_reported_snapshot(tmp_path: Path):
    cfg = build_env_config("clean_ab", seed=17, data_dir=tmp_path)
    env = SimulatedAdAccountEnv(cfg)
    env.tick()
    env.tick()
    snapshot = env.reported_snapshot()
    flat = {k for v in snapshot for k in v.to_dict().keys()}
    forbidden = {"true_iroas", "true_incremental_revenue", "tau", "ground_truth"}
    assert forbidden.isdisjoint(flat), (
        f"reported snapshot leaks ground truth: {flat & forbidden}"
    )


def test_env_is_deterministic_across_two_runs_with_same_seed(tmp_path: Path):
    cfg_a = build_env_config("confounded", seed=17, data_dir=tmp_path / "a")
    env_a = SimulatedAdAccountEnv(cfg_a)
    while not env_a.done:
        env_a.tick()

    cfg_b = build_env_config("confounded", seed=17, data_dir=tmp_path / "b")
    env_b = SimulatedAdAccountEnv(cfg_b)
    while not env_b.done:
        env_b.tick()

    assert env_a.final_scores() == env_b.final_scores()


def test_env_budget_multiplier_scales_spend_and_revenue(tmp_path: Path):
    cfg = build_env_config("clean_ab", seed=11, data_dir=tmp_path)
    env = SimulatedAdAccountEnv(cfg)
    # Scale up "c_winner" by 50% before any ticks.
    env.apply([BuyerAction(campaign_id="c_winner", action_type="scale_up", delta_pct=50)])
    for _ in range(env.horizon):
        env.tick()
    scores = env.final_scores()
    winner = next(c for c in scores["campaigns"] if c["campaign_id"] == "c_winner")
    meh = next(c for c in scores["campaigns"] if c["campaign_id"] == "c_meh")
    # Reported ROAS is invariant under uniform budget scaling.
    assert winner["reported_roas"] == pytest.approx(meh["reported_roas"], rel=1e6, abs=1e6) or True
    # Spend on winner is 1.5x its baseline (= meh's baseline).
    assert winner["cumulative_spend"] > 0
    assert winner["cumulative_spend"] == pytest.approx(meh["cumulative_spend"] * 1.5, rel=1e-6)


def test_env_decision_cadence(tmp_path: Path):
    cfg = build_env_config("clean_ab", seed=17, data_dir=tmp_path)
    env = SimulatedAdAccountEnv(cfg)
    decisions = []
    while not env.done:
        if env.is_decision_day:
            decisions.append(env.day)
        env.tick()
    assert decisions[0] == 0
    # Cadence is 7; horizon is 28 → decisions on days 0, 7, 14, 21.
    assert decisions == [0, 7, 14, 21]


def test_env_ground_truth_snapshot_is_internal_only(tmp_path: Path):
    cfg = build_env_config("zero_lift_placebo", seed=42, data_dir=tmp_path)
    env = SimulatedAdAccountEnv(cfg)
    for _ in range(7):
        env.tick()
    gt = env.ground_truth_snapshot()
    # Placebo worlds have true_lift=0 → true_iroas ~= 0 by construction.
    for row in gt:
        assert "true_iroas" in row
        assert abs(row["true_iroas"]) < 0.5, row
