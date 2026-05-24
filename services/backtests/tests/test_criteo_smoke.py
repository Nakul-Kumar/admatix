from __future__ import annotations

import json
import math

from .conftest import dataset_path, sha256_file, skip_if_missing_dataset


def test_criteo_sample_smoke_uses_staged_dataset_and_writes_metadata(tmp_path):
    skip_if_missing_dataset("criteo")

    from admatix_backtests import BacktestConfig, run_criteo_backtest

    result = run_criteo_backtest(
        BacktestConfig(
            output_dir=tmp_path / "out",
            seed=17,
            bootstrap_iters=120,
            criteo_outcomes=["visit"],
            criteo_sample_rows=200000,
        )
    )

    assert result.rows_total == 200000
    assert result.rows_train + result.rows_test == result.rows_total
    assert result.dataset_sha256 == sha256_file(dataset_path("criteo"))
    assert 0.49 <= result.propensity_auc <= 0.53
    assert result.license_note.startswith("Criteo Uplift v2.1 is CC BY-NC-SA 4.0")
    assert result.claim_limits
    assert len(result.outcomes) == 1
    outcome = result.outcomes[0]
    assert outcome.outcome == "visit"
    assert outcome.n_treated > 0
    assert outcome.n_control > 0
    assert outcome.ate_estimate > 0
    assert all(math.isfinite(value) for value in [
        outcome.ate_estimate,
        outcome.ci_low,
        outcome.ci_high,
        outcome.qini_estimate,
        outcome.qini_reference,
        outcome.auuc_estimate,
        outcome.auuc_reference,
    ])
    assert result.metrics_path.exists()
    payload = json.loads(result.metrics_path.read_text(encoding="utf-8"))
    assert payload["dataset_sha256"] == result.dataset_sha256
    assert payload["reference_url"] == "https://arxiv.org/abs/2111.10106"
    assert payload["config"]["criteo_sample_rows"] == 200000
    assert payload["claim_limits"]
    assert payload["outcomes"][0]["qini_reference_method"] == "self_reference_smoke_not_published_baseline"
    assert payload["outcomes"][0]["auuc_reference_method"] == "self_reference_smoke_not_published_baseline"
    assert result.qini_curve_paths[0].exists()
    assert result.qini_curve_paths[0].stat().st_size > 0
    assert result.propensity_roc_path.exists()
    assert result.propensity_roc_path.stat().st_size > 0
