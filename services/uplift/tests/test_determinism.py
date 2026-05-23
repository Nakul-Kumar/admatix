from __future__ import annotations

from admatix_uplift import UpliftConfig, run_placebo_suite, run_qini_simulator


def test_qini_simulator_determinism(tmp_path, tiny_qini_config):
    one = run_qini_simulator(tiny_qini_config)
    first_bytes = one.metrics_path.read_bytes()
    two = run_qini_simulator(tiny_qini_config)
    assert first_bytes == two.metrics_path.read_bytes()
    assert one.qini_ratios == two.qini_ratios


def test_placebo_determinism(tmp_path):
    config = UpliftConfig(
        output_dir=tmp_path / "out",
        seeds=[11, 12],
        world_grid=[{
            "world_type": "zero_lift_placebo",
            "baseline_cr": 0.03,
            "true_lift": 0.0,
            "n_users": 2000,
            "noise_sd": 0.0,
            "seasonality": 0.0,
            "n_periods": 30,
            "n_geos": 20
        }],
    )
    one = run_placebo_suite(config)
    first_bytes = one.metrics_path.read_bytes()
    two = run_placebo_suite(config)
    assert first_bytes == two.metrics_path.read_bytes()
    assert one.estimates == two.estimates
