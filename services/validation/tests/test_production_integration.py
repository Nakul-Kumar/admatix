"""Regression tests for the production simulator -> verifier path.

These tests deliberately guard against the WP-T audit failure mode: computing
validation metrics from simulator-shaped or verifier-shaped numbers while
bypassing the actual production verifier entry point.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Callable

import pytest

from admatix_validation import (
    ValidationConfig,
    run_coverage,
    run_multiseed_variance,
    run_rmse_bias,
)


def _config(tmp_path: Path, *, seeds: list[int] | None = None) -> ValidationConfig:
    return ValidationConfig(
        output_dir=tmp_path / "production-path",
        n_simulations=0,
        seeds=seeds or [901, 902],
        world_grid=[
            {
                "world_type": "clean_ab",
                "baseline_cr": 0.05,
                "true_lift": 0.04,
                "n_users": 600,
                "noise_sd": 0.0,
                "seasonality": 0.0,
                "n_periods": 14,
                "n_geos": 10,
            }
        ],
    )


@pytest.mark.parametrize(
    ("runner", "metrics_subdir"),
    [
        (run_coverage, "coverage"),
        (run_rmse_bias, "rmse_bias"),
        (run_multiseed_variance, "multiseed"),
    ],
)
def test_harness_calls_production_verifier_entrypoint(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
    runner: Callable[[ValidationConfig], object],
    metrics_subdir: str,
) -> None:
    import admatix_verifier.app as verifier_app

    calls = []
    real_verify = verifier_app.verify

    def wrapped_verify(req):
        calls.append(req)
        return real_verify(req)

    monkeypatch.setattr(verifier_app, "verify", wrapped_verify)

    runner(_config(tmp_path))

    assert calls, "validation runners must call admatix_verifier.app.verify directly"
    assert all(call.metadata_uri for call in calls), "verifier calls must carry simulator metadata"

    runs_path = tmp_path / "production-path" / metrics_subdir / "runs.jsonl"
    rows = [json.loads(line) for line in runs_path.read_text(encoding="utf-8").splitlines()]
    assert rows
    assert {row["diagnostics"]["verifier_entrypoint"] for row in rows} == {
        "admatix_verifier.app.verify"
    }
