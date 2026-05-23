"""Acceptance test 4 — Multi-seed variance smoke."""

from __future__ import annotations

import math
from pathlib import Path

import pytest

from admatix_validation import ValidationConfig, run_multiseed_variance


def test_multiseed_variance_smoke(tmp_path: Path) -> None:
    seeds = list(range(401, 421))  # 20 seeds
    world_grid = [
        {"world_type": "clean_ab", "n_users": 2000, "noise_sd": 0.0,
         "seasonality": 0.0, "n_periods": 30, "n_geos": 20,
         "baseline_cr": 0.05, "true_lift": 0.04},
        {"world_type": "clean_ab", "n_users": 2000, "noise_sd": 0.0,
         "seasonality": 0.0, "n_periods": 30, "n_geos": 20,
         "baseline_cr": 0.05, "true_lift": 0.05},
    ]
    config = ValidationConfig(
        output_dir=tmp_path / "multiseed-smoke",
        n_simulations=0,
        seeds=seeds,
        world_grid=world_grid,
    )
    result = run_multiseed_variance(config)

    assert len(result.cv_of_estimate) == 2
    assert len(result.verdict_stability) == 2
    for cv in result.cv_of_estimate.values():
        assert cv >= 0.0
    for stab in result.verdict_stability.values():
        assert 0.0 <= stab <= 1.0
