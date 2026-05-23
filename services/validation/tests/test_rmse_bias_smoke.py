"""Acceptance test 3 — RMSE + bias smoke."""

from __future__ import annotations

from pathlib import Path

import pytest

from admatix_validation import ValidationConfig, run_rmse_bias


def test_rmse_bias_smoke(tmp_path: Path) -> None:
    seeds = list(range(301, 321))  # 20 seeds
    world_grid = [
        {"world_type": "clean_ab", "n_users": 2000, "noise_sd": 0.0,
         "seasonality": 0.0, "n_periods": 30, "n_geos": 20,
         "baseline_cr": 0.05, "true_lift": 0.04},
        {"world_type": "confounded", "n_users": 2000, "noise_sd": 0.0,
         "seasonality": 0.0, "n_periods": 30, "n_geos": 20,
         "baseline_cr": 0.05, "true_lift": 0.04,
         "confound_strength": 0.3},
    ]
    config = ValidationConfig(
        output_dir=tmp_path / "rmse-smoke",
        n_simulations=0,
        seeds=seeds,
        world_grid=world_grid,
    )
    result = run_rmse_bias(config)

    assert "clean_ab" in result.per_world_type
    assert "confounded" in result.per_world_type
    for world_type in ("clean_ab", "confounded"):
        row = result.per_world_type[world_type]
        assert row["n"] == 20
        # bias and rmse must be finite numbers
        import math
        assert math.isfinite(row["bias"]), f"{world_type} bias not finite"
        assert math.isfinite(row["rmse"]), f"{world_type} rmse not finite"

    table_text = result.table_path.read_text(encoding="utf-8")
    for token in ("clean_ab", "confounded", "bias", "rmse"):
        assert token in table_text
