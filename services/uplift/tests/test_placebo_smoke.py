from __future__ import annotations

import json

from admatix_uplift import PlaceboResult, run_placebo_suite


def test_placebo_smoke(tiny_placebo_config):
    result = run_placebo_suite(tiny_placebo_config)
    assert isinstance(result, PlaceboResult)
    assert result.n_worlds == 10
    assert len(result.estimates) == 10
    assert result.tolerance == 0.05 * 0.03
    assert 0.0 <= result.false_positive_rate <= 1.0
    assert result.distribution_plot_path.stat().st_size > 0
    lines = result.runs_path.read_text(encoding="utf-8").splitlines()
    assert len(lines) == 10
    first = json.loads(lines[0])
    assert {"estimate", "ci_low", "ci_high", "verdict", "method"}.issubset(first)
