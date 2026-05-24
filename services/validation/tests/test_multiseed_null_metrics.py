from __future__ import annotations

from admatix_validation.multiseed import _summarize_cell_variance


def test_multiseed_uses_absolute_dispersion_for_near_zero_effects() -> None:
    summary = _summarize_cell_variance(
        estimates=[-0.001, 0.0, 0.001],
        verdicts=["inconclusive", "no_effect", "inconclusive"],
        ground_truth=0.0,
    )

    assert summary["metric_kind"] == "near_zero"
    assert summary["cv_of_estimate"] == 0.0
    assert 0.0 < summary["absolute_sd"] < 0.002
    assert summary["false_positive_rate"] == 0.0
    assert summary["verdict_stability"] == 1.0
    assert summary["passes"]


def test_multiseed_flags_placebo_lift_false_positives() -> None:
    summary = _summarize_cell_variance(
        estimates=[0.02, 0.018, 0.021],
        verdicts=["lift_detected", "lift_detected", "inconclusive"],
        ground_truth=0.0,
    )

    assert summary["metric_kind"] == "near_zero"
    assert summary["false_positive_rate"] > 0.05
    assert not summary["passes"]


def test_multiseed_fails_core_cells_with_missing_estimates() -> None:
    summary = _summarize_cell_variance(
        estimates=[None, None, None],
        verdicts=["inconclusive", "inconclusive", "inconclusive"],
        ground_truth=0.04,
    )

    assert summary["missing_estimate_rate"] == 1.0
    assert not summary["passes"]


def test_multiseed_nonzero_effect_allows_honest_abstention_variance() -> None:
    summary = _summarize_cell_variance(
        estimates=[0.03, 0.05, 0.04, 0.035, 0.045],
        verdicts=["lift_detected", "inconclusive", "lift_detected", "inconclusive", "lift_detected"],
        ground_truth=0.04,
    )

    assert summary["metric_kind"] == "nonzero"
    assert summary["cv_of_estimate"] > 0.15
    assert summary["exact_verdict_stability"] < 0.90
    assert summary["semantic_verdict_stability"] == 1.0
    assert summary["wrong_claim_rate"] == 0.0
    assert summary["passes"]


def test_multiseed_nonzero_effect_rejects_confident_wrong_claims() -> None:
    summary = _summarize_cell_variance(
        estimates=[0.03, 0.04, 0.05],
        verdicts=["lift_detected", "no_effect", "lift_detected"],
        ground_truth=0.04,
    )

    assert summary["wrong_claim_rate"] > 0.0
    assert not summary["passes"]
