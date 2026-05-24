from __future__ import annotations

from admatix_validation.rmse_bias import _is_underpowered_estimate, _missing_estimate_rate


def test_rmse_gate_counts_missing_core_estimates_as_failures() -> None:
    assert _missing_estimate_rate(n_missing=1, n_expected=10) == 0.1


def test_rmse_missing_estimate_rate_is_zero_when_expected_count_empty() -> None:
    assert _missing_estimate_rate(n_missing=0, n_expected=0) == 0.0


def test_rmse_underpowered_diagnostics_are_explicit_abstentions() -> None:
    assert _is_underpowered_estimate({"reason": "underpowered"})
    assert _is_underpowered_estimate({"reason": "UNDERPOWERED"})
    assert not _is_underpowered_estimate({"reason": "legacy_geo_without_prepost"})
    assert not _is_underpowered_estimate({})
