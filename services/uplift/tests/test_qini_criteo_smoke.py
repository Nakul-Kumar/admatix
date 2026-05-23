from __future__ import annotations

import json
import math

from admatix_uplift import QiniCriteoResult, UpliftConfig, run_qini_criteo

from .conftest import skip_if_missing_dataset


def test_qini_criteo_smoke(tmp_path):
    skip_if_missing_dataset("criteo")
    result = run_qini_criteo(
        UpliftConfig(output_dir=tmp_path / "out", seeds=[13], criteo_sample_rows=200_000)
    )
    assert isinstance(result, QiniCriteoResult)
    assert result.rows_total <= 200_000
    assert result.rows_train + result.rows_test == result.rows_total
    assert math.isfinite(result.qini_visit)
    assert math.isfinite(result.qini_conversion)
    assert result.qini_curve_visit_path.stat().st_size > 0
    assert result.qini_curve_conversion_path.stat().st_size > 0
    body = json.loads(result.metrics_path.read_text(encoding="utf-8"))
    assert "BY-NC-SA" in body["license_note"]
