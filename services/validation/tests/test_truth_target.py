from __future__ import annotations

from types import SimpleNamespace

from admatix_validation.grids import target_ground_truth_ate


def test_validation_prefers_verification_target_ate_when_simulator_records_estimand() -> None:
    world = SimpleNamespace(
        ground_truth={
            "ate": 0.02,
            "verification_target_ate": 0.04,
        }
    )

    assert target_ground_truth_ate(world) == 0.04


def test_validation_falls_back_to_population_ate_for_legacy_worlds() -> None:
    world = SimpleNamespace(ground_truth={"ate": 0.03})

    assert target_ground_truth_ate(world) == 0.03
