"""Acceptance test 4 — CATE meta-learner."""

from __future__ import annotations

import pytest
from admatix_simulator import SimulationConfig, generate_world

from admatix_verifier.loaders import load_events
from admatix_verifier.methods import cate
from admatix_verifier.models import H0PacketSubset, VerifyRequest


def test_cate_recovers_ate_on_clean_ab(clean_ab_world):
    events = load_events(clean_ab_world.data_uri)
    result = cate.run(clean_ab_world.request, events)
    assert result.method == "cate_meta_learner"
    assert result.estimate is not None
    assert result.ci_low is not None and result.ci_high is not None
    assert len(result.confounders) > 0
    assert "recency" in result.confounders
    truth = clean_ab_world.ground_truth["ate"]
    # CI must bracket the recorded ground truth.
    assert result.ci_low <= truth <= result.ci_high
    assert "qini" in result.diagnostics


@pytest.fixture(scope="module")
def large_placebo_world(tmp_path_factory):
    # The §3.5 placebo tolerance (|est| <= 5% of baseline_cr) is a
    # population-level criterion — at n=2000 a single DML estimate has SE
    # comparable to the tolerance, so we materialise a larger placebo world
    # specifically for the per-seed point-estimate check.
    out = tmp_path_factory.mktemp("placebo_large")
    config = SimulationConfig(
        world_type="zero_lift_placebo",
        baseline_cr=0.03,
        true_lift=0.0,
        n_users=30_000,
        noise_sd=0.0,
        seasonality=0.0,
        n_periods=30,
        n_geos=20,
        seed=17,
    )
    world = generate_world(config, out)
    req = VerifyRequest(
        packet=H0PacketSubset(
            packet_id=f"pkt_{world.world_id}",
            tenant_id="tenant_test",
            account_ref="fixture:placebo_large",
            goal="placebo",
            hypothesis="zero lift",
            causal_status="experimental",
            guardrails={},
            evidence_refs=[],
        ),
        data_uri=world.data_uri,
        metadata_uri=world.metadata_path.resolve().as_uri(),
        action_log_uri=None,
        hint=None,
    )
    return world, req


def test_cate_near_zero_on_placebo(large_placebo_world):
    world, req = large_placebo_world
    events = load_events(req.data_uri)
    result = cate.run(req, events)
    assert result.method == "cate_meta_learner"
    assert result.estimate is not None
    # SIMULATION-VERIFICATION §3.5 placebo tolerance: |est| <= 5% of baseline_cr.
    assert abs(result.estimate) <= 0.05 * 0.03
    assert "qini" in result.diagnostics
