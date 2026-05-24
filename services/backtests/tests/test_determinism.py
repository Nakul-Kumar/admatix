from __future__ import annotations

from .conftest import skip_if_missing_dataset


def test_hillstrom_backtest_metrics_are_byte_identical_for_same_config(tmp_path):
    skip_if_missing_dataset("hillstrom")

    from admatix_backtests import BacktestConfig, run_hillstrom_backtest

    config = BacktestConfig(
        output_dir=tmp_path / "out",
        seed=17,
        bootstrap_iters=50,
        hillstrom_arms=["mens_email"],
    )
    first = run_hillstrom_backtest(config)
    first_bytes = first.metrics_path.read_bytes()
    second = run_hillstrom_backtest(config)

    assert second.metrics_path.read_bytes() == first_bytes
    assert second.arms[0].bootstrap_distribution == first.arms[0].bootstrap_distribution


def test_criteo_backtest_metrics_are_byte_identical_for_same_config(tmp_path):
    skip_if_missing_dataset("criteo")

    from admatix_backtests import BacktestConfig, run_criteo_backtest

    config = BacktestConfig(
        output_dir=tmp_path / "out",
        seed=17,
        bootstrap_iters=50,
        criteo_outcomes=["visit"],
        criteo_sample_rows=200000,
    )
    first = run_criteo_backtest(config)
    first_bytes = first.metrics_path.read_bytes()
    second = run_criteo_backtest(config)

    assert second.metrics_path.read_bytes() == first_bytes
    assert second.outcomes[0].bootstrap_distribution == first.outcomes[0].bootstrap_distribution
