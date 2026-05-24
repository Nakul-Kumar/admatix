"""Acceptance test 5 — geo-holdout method."""

from __future__ import annotations

from pathlib import Path

import pytest
from admatix_simulator import SimulationConfig, generate_world

from admatix_verifier.loaders import load_events
from admatix_verifier.methods import geo
from admatix_verifier.models import H0PacketSubset, VerifyRequest


def _request_for(world, plausible_lift: float) -> VerifyRequest:
    packet = H0PacketSubset(
        packet_id=f"pkt_{world.world_id}",
        tenant_id="tenant_test",
        account_ref="fixture:geo",
        goal="geo_recovery",
        hypothesis="geo holdout",
        causal_status="experimental",
        guardrails={},
        evidence_refs=[],
    )
    return VerifyRequest(
        packet=packet,
        data_uri=world.data_uri,
        metadata_uri=world.metadata_path.resolve().as_uri(),
        action_log_uri=None,
        hint={"design": "geo_holdout", "plausible_lift": plausible_lift},
    )


@pytest.fixture(scope="module")
def powered_geo_world(tmp_path_factory) -> tuple[object, VerifyRequest]:
    out = tmp_path_factory.mktemp("geo_powered")
    config = SimulationConfig(
        world_type="geo_structured",
        baseline_cr=0.03,
        true_lift=0.04,
        n_users=4000,
        n_geos=20,
        treat_frac=0.5,
        noise_sd=0.0,
        seasonality=0.0,
        n_periods=30,
        seed=17,
    )
    world = generate_world(config, out)
    return world, _request_for(world, 0.04)


@pytest.fixture(scope="module")
def underpowered_geo_world(tmp_path_factory) -> tuple[object, VerifyRequest]:
    out = tmp_path_factory.mktemp("geo_under")
    config = SimulationConfig(
        world_type="geo_structured",
        baseline_cr=0.03,
        true_lift=0.001,
        n_users=4000,
        n_geos=4,
        treat_frac=0.5,
        noise_sd=0.0,
        seasonality=0.0,
        n_periods=30,
        seed=17,
    )
    world = generate_world(config, out)
    return world, _request_for(world, 0.001)


def test_geo_recovers_lift_in_powered_world(powered_geo_world):
    world, req = powered_geo_world
    events = load_events(world.data_uri)
    assert {"treated_geo", "post_period"} <= set(events.columns)
    result = geo.run(req, events)
    assert result.method == "geo_synthetic_control"
    assert result.estimate is not None
    assert result.diagnostics.get("estimand") == "treated_geo_x_post_period"
    assert result.diagnostics.get("mde") is not None
    assert result.diagnostics.get("power") is not None
    assert isinstance(result.diagnostics["mde"], float)
    assert isinstance(result.diagnostics["power"], float)
    target = world.ground_truth["verification_target_ate"]
    assert result.ci_low <= target <= result.ci_high
    assert abs(result.estimate - target) < 0.02


def test_geo_requires_prepost_holdout_columns(powered_geo_world):
    world, req = powered_geo_world
    events = load_events(world.data_uri).drop(columns=["treated_geo", "post_period"])
    result = geo.run(req, events)
    assert result.method == "geo_synthetic_control"
    assert result.verdict == "inconclusive"
    assert result.diagnostics.get("reason") == "missing_geo_prepost_design"


def test_geo_returns_underpowered_when_mde_above_lift(underpowered_geo_world):
    world, req = underpowered_geo_world
    events = load_events(world.data_uri)
    result = geo.run(req, events)
    assert result.method == "geo_synthetic_control"
    assert result.verdict == "inconclusive"
    assert result.diagnostics.get("reason") == "underpowered"
    assert result.estimate is not None
    assert result.ci_low is not None and result.ci_high is not None
