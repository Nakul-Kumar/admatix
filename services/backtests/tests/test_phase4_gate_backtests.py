from __future__ import annotations

import pytest

from .conftest import skip_if_missing_dataset


@pytest.mark.slow
def test_phase4_gate_backtests_smoke_contract(tmp_path):
    skip_if_missing_dataset("hillstrom")
    skip_if_missing_dataset("criteo")

    from admatix_backtests import BacktestConfig, run_criteo_backtest, run_hillstrom_backtest

    hillstrom = run_hillstrom_backtest(
        BacktestConfig(
            output_dir=tmp_path / "gate",
            seed=17,
            bootstrap_iters=1000,
            hillstrom_arms=["mens_email", "womens_email"],
        )
    )
    assert hillstrom.passes is True
    assert all(arm.ci_excludes_zero for arm in hillstrom.arms)

    criteo = run_criteo_backtest(
        BacktestConfig(
            output_dir=tmp_path / "gate",
            seed=17,
            bootstrap_iters=1000,
            criteo_sample_rows=None,
            criteo_outcomes=["visit", "conversion"],
        )
    )
    assert criteo.rows_total == 13979592
    assert criteo.passes is True
