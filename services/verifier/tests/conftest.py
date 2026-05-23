"""Shared pytest fixtures for the verifier test suite.

Materialises one `clean_ab` and one `zero_lift_placebo` world per test
session via `admatix_simulator.generate_world` under `tmp_path`. Pinned
seed=17, `n_users=2000`, `noise_sd=0.0` for speed and determinism.
"""

from __future__ import annotations

import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import pytest


_HERE = Path(__file__).resolve()
_VERIFIER_ROOT = _HERE.parents[1]
_REPO_ROOT = _HERE.parents[3]
# `_VERIFIER_ROOT` (services/verifier) is on sys.path so the method-validation
# harness (`services/verifier/validation/`) is importable from tests. The
# harness is intentionally a sibling of `src/` rather than a submodule of
# `admatix_verifier` because it ships no runtime code.
for candidate in (_VERIFIER_ROOT, _VERIFIER_ROOT / "src", _REPO_ROOT / "services" / "simulator" / "src"):
    candidate_str = str(candidate)
    if candidate_str not in sys.path:
        sys.path.insert(0, candidate_str)


from admatix_simulator import SimulationConfig, generate_world  # noqa: E402
from admatix_verifier.models import H0PacketSubset, VerifyRequest  # noqa: E402


@dataclass
class WorldBundle:
    name: str
    world_id: str
    data_uri: str
    metadata_uri: str
    ground_truth: dict[str, Any]
    request: VerifyRequest


def _build_request(world, world_name: str, baseline_cr: float, true_lift: float) -> VerifyRequest:
    packet = H0PacketSubset(
        packet_id=f"pkt_{world.world_id}",
        tenant_id="tenant_test",
        account_ref=f"fixture:{world_name}",
        goal="recover_lift",
        hypothesis=f"world {world_name} has true_lift={true_lift}",
        causal_status="directional_until_lift_test",
        guardrails={"budget_cap": 1_000_000.0, "freq_cap": 10},
        evidence_refs=[f"metric:sim:{world.world_id}"],
    )
    return VerifyRequest(
        packet=packet,
        data_uri=world.data_uri,
        metadata_uri=world.metadata_path.resolve().as_uri(),
        action_log_uri=None,
        hint={"design": "auto", "plausible_lift": true_lift},
    )


@pytest.fixture(scope="session")
def sim_root(tmp_path_factory: pytest.TempPathFactory) -> Path:
    return tmp_path_factory.mktemp("sim")


@pytest.fixture(scope="session")
def clean_ab_world(sim_root: Path) -> WorldBundle:
    config = SimulationConfig(
        world_type="clean_ab",
        baseline_cr=0.03,
        true_lift=0.04,
        n_users=2000,
        noise_sd=0.0,
        seasonality=0.0,
        n_periods=30,
        n_geos=20,
        seed=17,
    )
    world = generate_world(config, sim_root)
    req = _build_request(world, "clean_ab", 0.03, 0.04)
    return WorldBundle(
        name="clean_ab",
        world_id=world.world_id,
        data_uri=world.data_uri,
        metadata_uri=world.metadata_path.resolve().as_uri(),
        ground_truth=world.ground_truth,
        request=req,
    )


@pytest.fixture(scope="session")
def placebo_world(sim_root: Path) -> WorldBundle:
    config = SimulationConfig(
        world_type="zero_lift_placebo",
        baseline_cr=0.03,
        true_lift=0.0,
        n_users=2000,
        noise_sd=0.0,
        seasonality=0.0,
        n_periods=30,
        n_geos=20,
        seed=17,
    )
    world = generate_world(config, sim_root)
    req = _build_request(world, "zero_lift_placebo", 0.03, 0.0)
    return WorldBundle(
        name="zero_lift_placebo",
        world_id=world.world_id,
        data_uri=world.data_uri,
        metadata_uri=world.metadata_path.resolve().as_uri(),
        ground_truth=world.ground_truth,
        request=req,
    )
