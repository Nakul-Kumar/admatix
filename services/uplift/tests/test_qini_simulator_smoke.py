from __future__ import annotations

import json
import math

from admatix_uplift import QiniSimulatorResult, run_qini_simulator


def test_qini_simulator_smoke(tiny_qini_config):
    result = run_qini_simulator(tiny_qini_config)
    assert isinstance(result, QiniSimulatorResult)
    assert result.n_worlds == 5
    assert len(result.qini_ratios) == 5
    assert all(math.isfinite(value) for value in result.qini_ratios)
    body = json.loads(result.metrics_path.read_text(encoding="utf-8"))
    assert body["n_worlds"] == result.n_worlds
    assert body["qini_ratios"] == result.qini_ratios
    for path in result.qini_curve_paths:
        assert path.exists()
        assert path.stat().st_size > 0
