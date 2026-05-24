from __future__ import annotations

import json
import math

from .conftest import dataset_path, sha256_file, skip_if_missing_dataset


def test_hillstrom_smoke_uses_staged_dataset_and_writes_metadata(tmp_path):
    skip_if_missing_dataset("hillstrom")

    from admatix_backtests import BacktestConfig, run_hillstrom_backtest

    result = run_hillstrom_backtest(
        BacktestConfig(
            output_dir=tmp_path / "out",
            seed=17,
            bootstrap_iters=200,
            hillstrom_arms=["mens_email"],
        )
    )

    assert result.rows == 64000
    assert result.dataset_sha256 == sha256_file(dataset_path("hillstrom"))
    assert result.license_note.startswith("Hillstrom MineThatData")
    assert result.claim_limits
    assert len(result.arms) == 1
    arm = result.arms[0]
    assert arm.arm == "mens_email"
    assert arm.n_treated > 0
    assert arm.n_control > 0
    assert arm.ci_excludes_zero is True
    assert arm.ci_low > 0
    assert arm.ci_high > arm.ci_low
    assert all(math.isfinite(value) for value in [
        arm.ate_estimate,
        arm.auuc_estimate,
        arm.auuc_reference,
        arm.secondary_conversion_ate,
        arm.secondary_spend_ate,
    ])
    assert result.metrics_path.exists()
    payload = json.loads(result.metrics_path.read_text(encoding="utf-8"))
    assert payload["dataset_sha256"] == result.dataset_sha256
    assert payload["config"]["seed"] == 17
    assert payload["config"]["bootstrap_iters"] == 200
    assert payload["claim_limits"]
    assert payload["arms"][0]["auuc_reference_method"] == "self_reference_smoke_not_published_baseline"
    assert result.qini_curve_paths[0].exists()
    assert result.qini_curve_paths[0].stat().st_size > 0
