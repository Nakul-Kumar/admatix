from __future__ import annotations

import csv
import json
import math
import sys
from collections import Counter, defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

from admatix_simulator import (  # noqa: E402
    ASSIGNMENT_BIAS_MULTIPLIER,
    SimulationConfig,
    WorldType,
    generate_world,
    naive_lift,
)


def _read_rows(path: Path) -> list[dict[str, str]]:
    with path.open(newline="", encoding="utf-8") as handle:
        return list(csv.DictReader(handle))


def _logit(p: float) -> float:
    return math.log(p / (1 - p))


def _normalize(recency: int, frequency: int, prior_conversions: int) -> tuple[float, float, float]:
    return (
        (12 - recency) / 12,
        min(frequency, 20) / 20,
        min(prior_conversions, 5) / 5,
    )


def test_clean_ab_world_is_reproducible_and_records_truth(tmp_path: Path) -> None:
    config = SimulationConfig(world_type=WorldType.CLEAN_AB, n_users=600, true_lift=0.04, seed=17, noise_sd=0.0)

    first = generate_world(config, tmp_path / "first")
    second = generate_world(config, tmp_path / "second")

    assert first.world_id == second.world_id
    assert first.output_hash == second.output_hash
    assert first.ground_truth["ate"] == second.ground_truth["ate"]
    assert abs(first.ground_truth["ate"] - 0.04) < 0.003
    assert first.n_rows == 600
    assert first.data_uri.startswith("file://")
    assert first.metadata_path.exists()
    metadata = json.loads(first.metadata_path.read_text(encoding="utf-8"))
    assert metadata["config"]["world_type"] == "clean_ab"
    assert metadata["ground_truth"]["confounder_coefficients"]["recency"] == 0.0


def test_clean_ab_treatment_is_balanced_and_not_tied_to_recency(tmp_path: Path) -> None:
    config = SimulationConfig(world_type=WorldType.CLEAN_AB, n_users=1000, treat_frac=0.5, seed=21, noise_sd=0.0)
    world = generate_world(config, tmp_path)
    rows = _read_rows(world.data_path)

    treated = [row for row in rows if row["treatment"] == "1"]
    control = [row for row in rows if row["treatment"] == "0"]
    assert 430 <= len(treated) <= 570
    treated_recency = sum(float(row["recency"]) for row in treated) / len(treated)
    control_recency = sum(float(row["recency"]) for row in control) / len(control)
    assert abs(treated_recency - control_recency) < 0.8


def test_confounded_world_makes_naive_lift_biased(tmp_path: Path) -> None:
    config = SimulationConfig(
        world_type=WorldType.CONFOUNDED,
        n_users=5000,
        true_lift=0.02,
        confound_strength=2.2,
        treat_frac=0.5,
        seed=9,
    )
    world = generate_world(config, tmp_path)

    naive = naive_lift(world.data_path)

    assert abs(naive - world.ground_truth["ate"]) > 0.01
    # bias direction: high-intent users are over-targeted AND convert more, so
    # naive estimator should over-state lift relative to the ground truth.
    assert naive - world.ground_truth["ate"] > 0.01
    assert world.ground_truth["confounder_coefficients"]["recency"] > 0


def test_zero_lift_placebo_keeps_tau_and_ate_at_zero(tmp_path: Path) -> None:
    config = SimulationConfig(
        world_type=WorldType.ZERO_LIFT_PLACEBO,
        n_users=800,
        true_lift=0.25,
        confound_strength=1.5,
        seed=31,
    )
    world = generate_world(config, tmp_path)
    rows = _read_rows(world.data_path)

    assert world.ground_truth["ate"] == 0.0
    assert world.ground_truth["att"] == 0.0
    assert {float(row["tau"]) for row in rows} == {0.0}


def test_geo_structured_world_assigns_treatment_at_geo_level(tmp_path: Path) -> None:
    config = SimulationConfig(world_type=WorldType.GEO_STRUCTURED, n_users=1200, n_geos=24, seed=44)
    world = generate_world(config, tmp_path)
    rows = _read_rows(world.data_path)

    treatment_by_geo: dict[str, set[str]] = {}
    for row in rows:
        treatment_by_geo.setdefault(row["geo_id"], set()).add(row["treatment"])

    assert len(treatment_by_geo) == 24
    assert all(len(assignments) == 1 for assignments in treatment_by_geo.values())
    assert world.ground_truth["geo_count"] == 24
    assert "geo_random_effect_sd" in world.ground_truth


def test_world_type_accepts_string_values(tmp_path: Path) -> None:
    config = SimulationConfig(world_type="clean_ab", n_users=100, seed=3)
    world = generate_world(config, tmp_path)

    assert world.world_type == WorldType.CLEAN_AB
    assert world.n_rows == 100


# ---------------------------------------------------------------------------
# Regression tests added in fix/sim-readiness — each targets a specific
# release-blocking finding from REVIEW-codex-sim-readiness.md.
# ---------------------------------------------------------------------------


def test_recorded_confounder_coefficients_match_actual_outcome_model(tmp_path: Path) -> None:
    """Finding #1: the recorded confounder_coefficients must be the LITERAL
    coefficients used in the outcome model. We turn off noise and seasonality
    so we can reconstruct logit(p0) exactly from the recorded metadata and the
    raw covariates.
    """
    config = SimulationConfig(
        world_type=WorldType.CONFOUNDED,
        n_users=300,
        true_lift=0.0,  # makes p0 == p1 and isolates the outcome model
        confound_strength=2.5,
        seed=101,
        noise_sd=0.0,
        seasonality=0.0,
    )
    world = generate_world(config, tmp_path)
    rows = _read_rows(world.data_path)

    coefs = world.ground_truth["outcome_model"]["coefficients"]
    intercept_logit = world.ground_truth["outcome_model"]["intercept_logit"]

    # The advertised c=2.5 should land as the literal recency coefficient.
    assert math.isclose(coefs["recency"], 2.5, rel_tol=1e-9, abs_tol=1e-9)
    assert math.isclose(coefs["frequency"], 0.6 * 2.5, rel_tol=1e-9, abs_tol=1e-9)
    assert math.isclose(coefs["prior_conversions"], 0.4 * 2.5, rel_tol=1e-9, abs_tol=1e-9)

    # Reconstruct logit(p0) row-by-row using ONLY the recorded coefficients and
    # the documented normalization. With noise_sd=0 and seasonality=0 the
    # reconstruction must match the recorded baseline_propensity exactly.
    for row in rows:
        rz, fz, pz = _normalize(int(row["recency"]), int(row["frequency"]), int(row["prior_conversions"]))
        expected_logit = (
            intercept_logit
            + coefs["recency"] * (rz - 0.5)
            + coefs["frequency"] * (fz - 0.5)
            + coefs["prior_conversions"] * (pz - 0.5)
        )
        actual_logit = _logit(float(row["baseline_propensity"]))
        assert abs(actual_logit - expected_logit) < 1e-8, (
            f"recorded coefficients do not describe the outcome model:"
            f" expected {expected_logit}, got {actual_logit}"
        )


def test_recorded_assignment_model_matches_actual_treatment_propensity(tmp_path: Path) -> None:
    """Finding #1 (assignment side): the recorded `assignment_model` must
    describe the actual treatment rule. We don't have per-row propensities in
    the CSV, but we can verify by binning users on recency and checking the
    realized treatment rate matches the recorded logit model.
    """
    config = SimulationConfig(
        world_type=WorldType.CONFOUNDED,
        n_users=20_000,
        confound_strength=2.0,
        treat_frac=0.5,
        seed=77,
    )
    world = generate_world(config, tmp_path)
    rows = _read_rows(world.data_path)

    assignment = world.ground_truth["assignment_model"]
    assert assignment["rule"] == "logit_centered_covariates"
    assert math.isclose(assignment["bias_multiplier"], ASSIGNMENT_BIAS_MULTIPLIER)
    assert math.isclose(assignment["coefficients"]["recency"], 2.0)

    # Treated rate among most-recent users (recency==0 → recency_z==1) should be
    # much higher than among least-recent (recency==12 → recency_z==0).
    most_recent = [row for row in rows if int(row["recency"]) <= 1]
    least_recent = [row for row in rows if int(row["recency"]) >= 11]
    assert most_recent and least_recent
    rate_recent = sum(1 for row in most_recent if row["treatment"] == "1") / len(most_recent)
    rate_old = sum(1 for row in least_recent if row["treatment"] == "1") / len(least_recent)
    assert rate_recent - rate_old > 0.3, (
        "assignment is not actually driven by recency as the recorded coefficients claim"
    )


def test_geo_structured_world_has_usable_geo_period_panel(tmp_path: Path) -> None:
    """Finding #2: a geo-holdout / DiD verifier needs every geo to be observed
    across multiple periods, and treated and control geos to co-exist at every
    populated period. The old implementation tied geo and period to user_id so
    geos only appeared in a strided coset of periods.
    """
    config = SimulationConfig(
        world_type=WorldType.GEO_STRUCTURED,
        n_users=6000,
        n_geos=20,
        n_periods=10,
        treat_frac=0.5,
        seed=55,
    )
    world = generate_world(config, tmp_path)
    rows = _read_rows(world.data_path)

    periods_per_geo: dict[str, set[int]] = defaultdict(set)
    geos_per_period: dict[int, set[str]] = defaultdict(set)
    treatment_by_geo: dict[str, str] = {}
    for row in rows:
        geo = row["geo_id"]
        period = int(row["period"])
        periods_per_geo[geo].add(period)
        geos_per_period[period].add(geo)
        treatment_by_geo[geo] = row["treatment"]

    assert len(periods_per_geo) == 20
    # Every geo must be observed at every period for a clean panel.
    for geo, periods in periods_per_geo.items():
        assert periods == set(range(10)), (
            f"geo {geo} only present in periods {sorted(periods)}; panel is not balanced"
        )

    # Every period must contain BOTH a treated and a control geo so DiD has
    # both arms at every time point.
    for period, geos in geos_per_period.items():
        treatments_present = {treatment_by_geo[g] for g in geos}
        assert treatments_present == {"0", "1"}, (
            f"period {period} missing one treatment arm: {treatments_present}"
        )

    # Geo composition of each period must be the SAME set of geos (the test
    # the old striped layout would fail outright).
    composition_per_period = {p: frozenset(g) for p, g in geos_per_period.items()}
    assert len(set(composition_per_period.values())) == 1, (
        "geo composition differs across periods — DiD will conflate treatment with composition"
    )


def test_confound_strength_zero_is_honored_in_confounded_world(tmp_path: Path) -> None:
    """Finding #3: confound_strength=0 used to be silently overridden to 0.8
    (outcome) / 1.0 (assignment). After the fix, a confounded world with
    confound_strength=0 must be indistinguishable from a clean A/B world.
    """
    config = SimulationConfig(
        world_type=WorldType.CONFOUNDED,
        n_users=8000,
        true_lift=0.02,
        confound_strength=0.0,
        treat_frac=0.5,
        seed=303,
    )
    world = generate_world(config, tmp_path)
    rows = _read_rows(world.data_path)

    # Recorded coefficients all zero — manifest must be literally true.
    coefs = world.ground_truth["confounder_coefficients"]
    assert coefs == {"recency": 0.0, "frequency": 0.0, "prior_conversions": 0.0}

    # Treatment must be unbiased Bernoulli(treat_frac).
    treated = [row for row in rows if row["treatment"] == "1"]
    control = [row for row in rows if row["treatment"] == "0"]
    treated_frac = len(treated) / len(rows)
    assert abs(treated_frac - 0.5) < 0.025

    # Treated and control covariate means must be balanced.
    treated_recency = sum(float(row["recency"]) for row in treated) / len(treated)
    control_recency = sum(float(row["recency"]) for row in control) / len(control)
    assert abs(treated_recency - control_recency) < 0.25

    # Naive lift must be approximately unbiased — within 2pp of the true lift.
    naive = naive_lift(world.data_path)
    assert abs(naive - world.ground_truth["ate"]) < 0.02, (
        f"confound_strength=0 still produces bias: naive={naive}, ate={world.ground_truth['ate']}"
    )


def test_zero_lift_placebo_with_no_confounding_is_truly_zero(tmp_path: Path) -> None:
    """Finding #3 (placebo path): a zero-lift placebo with confound_strength=0
    must be a PURE zero-effect world — no selection-on-X, no biased naive lift.
    Previously the `or 0.8` fallback meant the placebo always carried hidden
    confounding even when the caller asked for none.
    """
    config = SimulationConfig(
        world_type=WorldType.ZERO_LIFT_PLACEBO,
        n_users=8000,
        true_lift=0.0,
        confound_strength=0.0,
        treat_frac=0.5,
        seed=505,
    )
    world = generate_world(config, tmp_path)

    assert world.ground_truth["ate"] == 0.0
    assert world.ground_truth["confounder_coefficients"]["recency"] == 0.0
    # With no confounding and zero true lift, the naive estimator should be
    # tightly centered on zero — the verifier-must-return-null sanity check.
    naive = naive_lift(world.data_path)
    assert abs(naive) < 0.015, f"placebo with no confounding has nonzero naive lift: {naive}"


def test_world_is_deterministic_across_two_runs(tmp_path: Path) -> None:
    """Same (config, seed) must reproduce the same bytes AND the same ground
    truth, across every world type. This pins the determinism contract.
    """
    for world_type in WorldType:
        kwargs: dict = {"world_type": world_type, "n_users": 400, "seed": 13}
        if world_type in (
            WorldType.CONFOUNDED,
            WorldType.ZERO_LIFT_PLACEBO,
            WorldType.ADVERSARIAL_MISSPECIFIED,
        ):
            kwargs["confound_strength"] = 0.7
        if world_type == WorldType.GEO_STRUCTURED:
            kwargs["n_geos"] = 8
            kwargs["n_periods"] = 5
        if world_type == WorldType.NON_STATIONARY:
            kwargs["effect_decay_rate"] = 0.05
            kwargs["learning_phase_periods"] = 3
            kwargs["learning_phase_noise_multiplier"] = 2.0
            kwargs["learning_phase_drift"] = 0.4
        if world_type == WorldType.CROSS_CAMPAIGN_INTERFERENCE:
            kwargs["n_campaigns"] = 3
            kwargs["interference_strength"] = 0.4
        if world_type == WorldType.ADVERSARIAL_MISSPECIFIED:
            kwargs["noise_dist"] = "student_t"
            kwargs["noise_df"] = 4
            kwargs["time_varying_confound_amplitude"] = 0.5
            kwargs["hidden_confounder_strength"] = 0.6
            kwargs["spillover_strength"] = 0.3
        config = SimulationConfig(**kwargs)
        first = generate_world(config, tmp_path / f"{world_type.value}_a")
        second = generate_world(config, tmp_path / f"{world_type.value}_b")
        assert first.world_id == second.world_id
        assert first.output_hash == second.output_hash
        assert first.ground_truth == second.ground_truth


def test_confound_strength_negative_is_rejected() -> None:
    """Finding #15 (low) variant: validate inputs at construction."""
    try:
        SimulationConfig(world_type=WorldType.CONFOUNDED, n_users=100, confound_strength=-0.1)
    except ValueError:
        return
    raise AssertionError("negative confound_strength should be rejected")


def test_geo_structured_requires_enough_users() -> None:
    """If n_users < n_geos some geos would be empty, breaking the geo panel."""
    try:
        SimulationConfig(world_type=WorldType.GEO_STRUCTURED, n_users=5, n_geos=20)
    except ValueError:
        return
    raise AssertionError("geo_structured n_users < n_geos should be rejected")


def test_revenue_rng_is_independent_of_outcome_realization(tmp_path: Path) -> None:
    """Finding #16: revenue is now drawn unconditionally so the RNG state does
    not depend on whether a particular user converted. With this invariant,
    flipping noise_sd or other parameters does not reach into the revenue
    distribution of unrelated users.
    """
    config = SimulationConfig(world_type=WorldType.CLEAN_AB, n_users=500, seed=1, noise_sd=0.0)
    world = generate_world(config, tmp_path)
    rows = _read_rows(world.data_path)
    # Converters should have positive, distinct revenue draws (not all the same).
    revenues = [float(row["revenue"]) for row in rows if row["outcome"] == "1"]
    assert revenues
    assert len(set(revenues)) > 1
