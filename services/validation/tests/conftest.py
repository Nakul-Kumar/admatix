"""Shared pytest fixtures for the validation harness test suite.

Adds the local `src` directory plus the sibling `services/simulator` and
`services/verifier` `src` directories to `sys.path` so the tests can run
without a `pip install -e` step. Materialises one clean_ab and one
confounded world per session at a pinned seed and `n_users=2000` so the
acceptance smoke tests share the same fixtures.
"""

from __future__ import annotations

import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import pytest


_HERE = Path(__file__).resolve()
_VALIDATION_ROOT = _HERE.parents[1]
_REPO_ROOT = _HERE.parents[3]
for candidate in (
    _VALIDATION_ROOT / "src",
    _REPO_ROOT / "services" / "simulator" / "src",
    _REPO_ROOT / "services" / "verifier" / "src",
):
    candidate_str = str(candidate)
    if candidate_str not in sys.path:
        sys.path.insert(0, candidate_str)


from admatix_simulator import SimulationConfig, SimulatedWorld, generate_world  # noqa: E402


@dataclass
class WorldBundle:
    name: str
    world: SimulatedWorld
    config: SimulationConfig


@pytest.fixture(scope="session")
def sim_root(tmp_path_factory: pytest.TempPathFactory) -> Path:
    return tmp_path_factory.mktemp("validation-sim")


@pytest.fixture(scope="session")
def clean_ab_world(sim_root: Path) -> WorldBundle:
    config = SimulationConfig(
        world_type="clean_ab",
        baseline_cr=0.05,
        true_lift=0.04,
        n_users=2000,
        noise_sd=0.0,
        seasonality=0.0,
        n_periods=30,
        n_geos=20,
        seed=17,
    )
    world = generate_world(config, sim_root)
    return WorldBundle(name="clean_ab", world=world, config=config)


@pytest.fixture(scope="session")
def confounded_world(sim_root: Path) -> WorldBundle:
    config = SimulationConfig(
        world_type="confounded",
        baseline_cr=0.05,
        true_lift=0.04,
        n_users=2000,
        noise_sd=0.0,
        seasonality=0.0,
        n_periods=30,
        n_geos=20,
        confound_strength=0.3,
        seed=17,
    )
    world = generate_world(config, sim_root)
    return WorldBundle(name="confounded", world=world, config=config)
