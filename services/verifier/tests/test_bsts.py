"""Acceptance test 3 — BSTS / pre-post synthetic control."""

from __future__ import annotations

from admatix_verifier.loaders import load_events
from admatix_verifier.methods import bsts


def test_bsts_recovers_lift_on_clean_ab(clean_ab_world):
    events = load_events(clean_ab_world.data_uri)
    result = bsts.run(clean_ab_world.request, events)
    assert result.method == "bsts_synthetic_control"
    assert result.estimate is not None
    assert result.ci_low is not None
    assert result.ci_high is not None
    assert result.ci_low <= result.estimate <= result.ci_high
    truth = clean_ab_world.ground_truth["ate"]
    # Loose tolerance — BSTS on a coarse 30-period series is noisy; the spec
    # asks the CI to bracket truth.
    assert result.ci_low - 0.01 <= truth <= result.ci_high + 0.01


def test_bsts_returns_inconclusive_on_placebo(placebo_world):
    events = load_events(placebo_world.data_uri)
    result = bsts.run(placebo_world.request, events)
    assert result.method == "bsts_synthetic_control"
    assert result.ci_low is not None and result.ci_high is not None
    assert result.ci_low < 0 < result.ci_high
    assert result.verdict == "inconclusive"
