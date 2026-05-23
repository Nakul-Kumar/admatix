from __future__ import annotations

import json

import pytest

from admatix_uplift import UpliftConfig, run_placebo_suite


@pytest.mark.slow
def test_phase4_gate_placebo(tmp_path):
    config = UpliftConfig(
        output_dir=tmp_path / "gate",
        seeds=list(range(2000, 2100)),
        world_grid=[{
            "world_type": "zero_lift_placebo",
            "baseline_cr": 0.03,
            "true_lift": 0.0,
            "n_users": 10000,
            "noise_sd": 0.0,
            "seasonality": 0.0,
            "n_periods": 30,
            "n_geos": 20
        }],
    )
    result = run_placebo_suite(config)
    assert result.n_worlds == 100
    assert result.tolerance == 0.05 * 0.03
    assert result.passes_mean_tolerance is True
    assert result.false_positive_rate <= 0.05
    assert result.passes_fpr is True
    assert result.passes is True
    assert result.metrics_path.stat().st_size > 0
    assert result.runs_path.stat().st_size > 0
    assert result.distribution_plot_path.stat().st_size > 0
    assert len(result.runs_path.read_text(encoding="utf-8").splitlines()) == 100
    bad = []
    for line in result.runs_path.read_text(encoding="utf-8").splitlines():
        body = json.loads(line)
        estimate = 0.0 if body.get("estimate") is None else float(body["estimate"])
        if body.get("verdict") == "lift_detected" and abs(estimate) > result.tolerance:
            bad.append(body)
    assert bad == []
