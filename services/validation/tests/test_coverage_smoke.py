"""Acceptance test 2 — CI-coverage smoke."""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from admatix_validation import ValidationConfig, run_coverage


def test_coverage_smoke(tmp_path: Path) -> None:
    seeds = list(range(201, 221))  # 20 seeds
    world_grid = [
        # 3 grid cells × 20 seeds = 60 worlds
        {"world_type": "clean_ab", "n_users": 2000, "noise_sd": 0.0,
         "seasonality": 0.0, "n_periods": 30, "n_geos": 20,
         "baseline_cr": 0.05, "true_lift": 0.04},
        {"world_type": "clean_ab", "n_users": 2000, "noise_sd": 0.0,
         "seasonality": 0.0, "n_periods": 30, "n_geos": 20,
         "baseline_cr": 0.03, "true_lift": 0.04},
        {"world_type": "clean_ab", "n_users": 2000, "noise_sd": 0.0,
         "seasonality": 0.0, "n_periods": 30, "n_geos": 20,
         "baseline_cr": 0.05, "true_lift": 0.05},
    ]
    config = ValidationConfig(
        output_dir=tmp_path / "coverage-smoke",
        n_simulations=0,
        seeds=seeds,
        world_grid=world_grid,
    )
    result = run_coverage(config)

    assert result.n_worlds == 60
    assert 0.0 <= result.empirical_coverage <= 1.0
    assert result.per_method, "per_method must have at least one entry"

    assert result.runs_path.exists()
    line_count = sum(1 for line in result.runs_path.read_text(encoding="utf-8").splitlines() if line.strip())
    assert line_count == result.n_worlds

    assert result.metrics_path.exists()
    parsed = json.loads(result.metrics_path.read_text(encoding="utf-8"))
    assert parsed["n_worlds"] == 60
    assert parsed["empirical_coverage"] == result.empirical_coverage

    assert result.coverage_curve_path.exists()
    assert result.coverage_curve_path.stat().st_size > 0
