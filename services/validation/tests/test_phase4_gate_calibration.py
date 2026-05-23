"""Acceptance test 7 — Phase 4 gate (calibration slice).

Loads `services/validation/configs/phase4-gate.json` and runs the full
SBC + coverage harness on it. The test is marked `@pytest.mark.slow` and
expected to take ~10 minutes on the VPS; it is gated by the
`run-phase4-calibration.sh` wrapper in the runbook.

Pass criteria (SIMULATION-VERIFICATION §3.1 + §3.2 — locked from the spec):
  - SBC: passes_uniformity is True (≥ 500 simulations, χ²-p > 0.05, no
    systematic ∪/∩ shape).
  - CI coverage: passes_nominal is True (empirical_coverage ∈ [0.93, 0.97]
    on ≥ 1000 worlds; per-method breakdown gating applies above 200
    worlds).
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from admatix_validation import (
    ValidationConfig,
    run_coverage,
    run_sbc,
)


_HERE = Path(__file__).resolve()
_VALIDATION_ROOT = _HERE.parents[1]
_CONFIG_PATH = _VALIDATION_ROOT / "configs" / "phase4-gate.json"


def _load_config(tmp_path: Path) -> ValidationConfig:
    raw = json.loads(_CONFIG_PATH.read_text(encoding="utf-8"))
    raw["output_dir"] = tmp_path / "phase4-gate"
    return ValidationConfig(**raw)


@pytest.mark.slow
def test_sbc_uniform_at_phase4_scale(tmp_path: Path) -> None:
    config = _load_config(tmp_path)
    assert config.n_simulations >= 500, "phase4-gate SBC must run ≥ 500 simulations (§3.1)"
    result = run_sbc(config)

    assert result.metrics_path.exists()
    assert result.rank_plot_path.exists()
    assert result.draws_path.exists()
    assert result.passes_uniformity, (
        f"SBC not uniform — chi2_p={result.chi2_p_value:.4f}, shape={result.shape_diagnostic!r}, "
        f"rank_histogram={result.rank_histogram}"
    )


@pytest.mark.slow
def test_ci_coverage_at_phase4_scale(tmp_path: Path) -> None:
    config = _load_config(tmp_path)
    n_worlds = len(config.world_grid) * len(config.seeds)
    assert n_worlds >= 1000, f"phase4-gate coverage must scan ≥ 1000 worlds (§3.2), got {n_worlds}"

    result = run_coverage(config)
    assert result.metrics_path.exists()
    assert result.runs_path.exists()
    assert result.coverage_curve_path.exists()
    assert result.passes_nominal, (
        f"CI coverage outside [0.93, 0.97] — empirical={result.empirical_coverage:.3f}, "
        f"per_method={result.per_method!r}"
    )
