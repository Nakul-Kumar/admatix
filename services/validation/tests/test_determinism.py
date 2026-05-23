"""Acceptance test 5 — Determinism (reproducibility floor).

Re-runs `run_coverage`, `run_rmse_bias`, and `run_multiseed_variance` twice
with the same ValidationConfig. Asserts the metrics.json and runs.jsonl
byte-compare equal across runs. This is the reproducibility floor
(PROOF-WAVE-MASTER-PLAN §2 + AGENTS.md rule 8).

Both runs target the same `output_dir`; the second run overwrites the
first, so we hash the first run's artifacts before re-running.
"""

from __future__ import annotations

import hashlib
from pathlib import Path

import pytest

from admatix_validation import (
    ValidationConfig,
    run_coverage,
    run_multiseed_variance,
    run_rmse_bias,
)


_GRID = [
    {"world_type": "clean_ab", "n_users": 1500, "noise_sd": 0.0,
     "seasonality": 0.0, "n_periods": 14, "n_geos": 10,
     "baseline_cr": 0.05, "true_lift": 0.04},
    {"world_type": "confounded", "n_users": 1500, "noise_sd": 0.0,
     "seasonality": 0.0, "n_periods": 14, "n_geos": 10,
     "baseline_cr": 0.05, "true_lift": 0.04,
     "confound_strength": 0.3},
]

_SEEDS = list(range(501, 511))  # 10 seeds — keeps the test under ~60s


def _sha(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def _config(output_dir: Path) -> ValidationConfig:
    return ValidationConfig(
        output_dir=output_dir,
        n_simulations=0,
        seeds=list(_SEEDS),
        world_grid=[dict(c) for c in _GRID],
    )


def test_coverage_is_byte_deterministic(tmp_path: Path) -> None:
    out = tmp_path / "run"
    config = _config(out)
    r1 = run_coverage(config)
    metrics_hash_1 = _sha(r1.metrics_path)
    runs_hash_1 = _sha(r1.runs_path)

    r2 = run_coverage(config)
    assert _sha(r2.metrics_path) == metrics_hash_1
    assert _sha(r2.runs_path) == runs_hash_1


def test_rmse_bias_is_byte_deterministic(tmp_path: Path) -> None:
    out = tmp_path / "run"
    config = _config(out)
    r1 = run_rmse_bias(config)
    metrics_hash_1 = _sha(r1.metrics_path)
    runs_path_1 = r1.metrics_path.with_name("runs.jsonl")
    runs_hash_1 = _sha(runs_path_1)

    r2 = run_rmse_bias(config)
    assert _sha(r2.metrics_path) == metrics_hash_1
    assert _sha(r2.metrics_path.with_name("runs.jsonl")) == runs_hash_1


def test_multiseed_is_byte_deterministic(tmp_path: Path) -> None:
    out = tmp_path / "run"
    config = _config(out)
    r1 = run_multiseed_variance(config)
    metrics_hash_1 = _sha(r1.metrics_path)
    runs_path_1 = r1.metrics_path.with_name("runs.jsonl")
    runs_hash_1 = _sha(runs_path_1)

    r2 = run_multiseed_variance(config)
    assert _sha(r2.metrics_path) == metrics_hash_1
    assert _sha(r2.metrics_path.with_name("runs.jsonl")) == runs_hash_1
