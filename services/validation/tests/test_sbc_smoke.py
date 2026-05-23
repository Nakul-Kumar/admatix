"""Acceptance test 1 — SBC smoke."""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from admatix_validation import ValidationConfig, run_sbc
from admatix_validation.reference_models import REFERENCE_MODEL_NAME


def test_sbc_smoke(tmp_path: Path) -> None:
    config = ValidationConfig(
        output_dir=tmp_path / "sbc-smoke",
        n_simulations=30,
        seeds=list(range(101, 131)),
        world_grid=[{
            "world_type": "clean_ab",
            "n_users": 300,
            "noise_sd": 0.0,
            "pymc_draws": 80,
            "pymc_tune": 80,
            "n_bins": 10,
        }],
    )
    result = run_sbc(config)

    assert sum(result.rank_histogram) == 30
    assert len(result.rank_histogram) == result.n_bins
    assert 0.0 <= result.chi2_p_value <= 1.0
    assert result.shape_diagnostic in {"uniform", "u_shaped", "n_shaped", "skewed"}

    assert result.rank_plot_path.exists()
    assert result.rank_plot_path.stat().st_size > 0

    assert result.metrics_path.exists()
    parsed = json.loads(result.metrics_path.read_text(encoding="utf-8"))
    assert parsed["n_simulations"] == 30
    assert parsed["rank_histogram"] == result.rank_histogram
    assert parsed["reference_model"] == REFERENCE_MODEL_NAME

    assert result.reference_model == REFERENCE_MODEL_NAME
