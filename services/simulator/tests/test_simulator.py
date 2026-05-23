from __future__ import annotations

import csv
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

from admatix_simulator import SimulationConfig, WorldType, generate_world, naive_lift  # noqa: E402


def _read_rows(path: Path) -> list[dict[str, str]]:
    with path.open(newline="", encoding="utf-8") as handle:
        return list(csv.DictReader(handle))


def test_clean_ab_world_is_reproducible_and_records_truth(tmp_path: Path) -> None:
    config = SimulationConfig(world_type=WorldType.CLEAN_AB, n_users=600, true_lift=0.04, seed=17, noise_sd=0.0)

    first = generate_world(config, tmp_path / "first")
    second = generate_world(config, tmp_path / "second")

    assert first.world_id == second.world_id
    assert first.output_hash == second.output_hash
    assert first.ground_truth["ate"] == second.ground_truth["ate"]
    assert abs(first.ground_truth["ate"] - 0.04) < 0.003
    assert first.n_rows == 600
    assert first.data_uri.startswith("file://")
    assert first.metadata_path.exists()
    metadata = json.loads(first.metadata_path.read_text(encoding="utf-8"))
    assert metadata["config"]["world_type"] == "clean_ab"
    assert metadata["ground_truth"]["confounder_coefficients"]["recency"] == 0.0


def test_clean_ab_treatment_is_balanced_and_not_tied_to_recency(tmp_path: Path) -> None:
    config = SimulationConfig(world_type=WorldType.CLEAN_AB, n_users=1000, treat_frac=0.5, seed=21, noise_sd=0.0)
    world = generate_world(config, tmp_path)
    rows = _read_rows(world.data_path)

    treated = [row for row in rows if row["treatment"] == "1"]
    control = [row for row in rows if row["treatment"] == "0"]
    assert 430 <= len(treated) <= 570
    treated_recency = sum(float(row["recency"]) for row in treated) / len(treated)
    control_recency = sum(float(row["recency"]) for row in control) / len(control)
    assert abs(treated_recency - control_recency) < 0.8


def test_confounded_world_makes_naive_lift_biased(tmp_path: Path) -> None:
    config = SimulationConfig(
        world_type=WorldType.CONFOUNDED,
        n_users=5000,
        true_lift=0.02,
        confound_strength=2.2,
        treat_frac=0.5,
        seed=9,
    )
    world = generate_world(config, tmp_path)

    naive = naive_lift(world.data_path)

    assert abs(naive - world.ground_truth["ate"]) > 0.01
    assert world.ground_truth["confounder_coefficients"]["recency"] > 0


def test_zero_lift_placebo_keeps_tau_and_ate_at_zero(tmp_path: Path) -> None:
    config = SimulationConfig(
        world_type=WorldType.ZERO_LIFT_PLACEBO,
        n_users=800,
        true_lift=0.25,
        confound_strength=1.5,
        seed=31,
    )
    world = generate_world(config, tmp_path)
    rows = _read_rows(world.data_path)

    assert world.ground_truth["ate"] == 0.0
    assert world.ground_truth["att"] == 0.0
    assert {float(row["tau"]) for row in rows} == {0.0}


def test_geo_structured_world_assigns_treatment_at_geo_level(tmp_path: Path) -> None:
    config = SimulationConfig(world_type=WorldType.GEO_STRUCTURED, n_users=1200, n_geos=24, seed=44)
    world = generate_world(config, tmp_path)
    rows = _read_rows(world.data_path)

    treatment_by_geo: dict[str, set[str]] = {}
    for row in rows:
        treatment_by_geo.setdefault(row["geo_id"], set()).add(row["treatment"])

    assert len(treatment_by_geo) == 24
    assert all(len(assignments) == 1 for assignments in treatment_by_geo.values())
    assert world.ground_truth["geo_count"] == 24
    assert "geo_random_effect_sd" in world.ground_truth


def test_world_type_accepts_string_values(tmp_path: Path) -> None:
    config = SimulationConfig(world_type="clean_ab", n_users=100, seed=3)
    world = generate_world(config, tmp_path)

    assert world.world_type == WorldType.CLEAN_AB
    assert world.n_rows == 100
