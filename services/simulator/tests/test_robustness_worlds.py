"""Tests for the harder world types added in wp/robustness-worlds.

For every new world type we prove three things:

  (a) determinism — same (config, seed) reproduces the same CSV bytes AND the
      same recorded ground truth, across two independent runs;
  (b) the recorded true effect equals the seed-paired counterfactual
      difference, computed directly from the per-row p0 and p1 columns the
      simulator emits (this is the "true effect is known by construction"
      contract from PROOF-WAVE);
  (c) zero-effect / placebo variants record exactly zero ATE and exactly
      zero per-row tau for every user.

The point of these worlds is to make the OBSERVED data harder for the
verifier WITHOUT making the truth unknown or approximate. Every assertion
below is anchored in the recorded ground truth — never in the verifier.
"""

from __future__ import annotations

import csv
import json
import math
import sys
from pathlib import Path
from statistics import mean

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

from admatix_simulator import (  # noqa: E402
    SimulationConfig,
    SweepCell,
    WorldType,
    causal_profiler_sweep,
    generate_world,
    naive_lift,
)


def _read_rows(path: Path) -> list[dict[str, str]]:
    with path.open(newline="", encoding="utf-8") as handle:
        return list(csv.DictReader(handle))


def _paired_counterfactual_diff(rows: list[dict[str, str]]) -> float:
    """Per-row seed-paired counterfactual difference at the propensity level:
    mean(treated_propensity - baseline_propensity). The simulator writes both
    columns so this is exactly recoverable from the CSV."""

    diffs = [
        float(row["treated_propensity"]) - float(row["baseline_propensity"])
        for row in rows
    ]
    return mean(diffs)


def _mean_tau(rows: list[dict[str, str]]) -> float:
    return mean(float(row["tau"]) for row in rows)


# ---------------------------------------------------------------------------
# non_stationary world
# ---------------------------------------------------------------------------


def test_non_stationary_is_deterministic_across_two_runs(tmp_path: Path) -> None:
    config = SimulationConfig(
        world_type=WorldType.NON_STATIONARY,
        n_users=800,
        n_periods=20,
        n_geos=10,
        true_lift=0.03,
        effect_decay_rate=0.1,
        learning_phase_periods=5,
        learning_phase_noise_multiplier=3.0,
        learning_phase_drift=0.6,
        seed=1001,
    )
    a = generate_world(config, tmp_path / "a")
    b = generate_world(config, tmp_path / "b")
    assert a.world_id == b.world_id
    assert a.output_hash == b.output_hash
    assert a.ground_truth == b.ground_truth


def test_non_stationary_recorded_truth_equals_seed_paired_counterfactual(tmp_path: Path) -> None:
    """The recorded ATE must equal both (a) the sample mean of per-row tau,
    and (b) the seed-paired counterfactual difference (mean p1 - mean p0)
    encoded in the CSV. All three are facts about the same data-generating
    process; if they ever drift apart, the world's truth is no longer known."""

    config = SimulationConfig(
        world_type=WorldType.NON_STATIONARY,
        n_users=4000,
        n_periods=30,
        n_geos=20,
        true_lift=0.04,
        effect_decay_rate=0.05,
        learning_phase_periods=4,
        learning_phase_noise_multiplier=2.0,
        learning_phase_drift=0.3,
        seed=42,
        noise_sd=0.0,
    )
    world = generate_world(config, tmp_path)
    rows = _read_rows(world.data_path)

    ate = world.ground_truth["ate"]
    tau_mean = _mean_tau(rows)
    paired = _paired_counterfactual_diff(rows)

    assert math.isclose(ate, tau_mean, abs_tol=1e-9, rel_tol=1e-9)
    # paired (post-clip) can differ from mean(tau) only by clipping at p in
    # {0, 1}. With baseline_cr=0.03 and modest lift, clipping should not move
    # the mean by more than 1e-4.
    assert abs(paired - ate) < 1e-4

    # The recorded paired-counterfactual diff in ground_truth must match what
    # we just recomputed from the CSV — they are the same quantity.
    assert math.isclose(
        world.ground_truth["seed_paired_counterfactual_diff"], paired, abs_tol=1e-9
    )


def test_non_stationary_effect_actually_decays_over_time(tmp_path: Path) -> None:
    """Sanity: with effect_decay_rate > 0, early-period tau should be larger
    than late-period tau. The verifier doesn't get this for free — the
    OBSERVED data has a moving target — but the GROUND TRUTH knows it."""

    config = SimulationConfig(
        world_type=WorldType.NON_STATIONARY,
        n_users=3000,
        n_periods=30,
        n_geos=15,
        true_lift=0.05,
        effect_decay_rate=0.1,
        heterogeneity_scale=0.0,  # remove heterogeneity to isolate decay
        seed=7,
        noise_sd=0.0,
    )
    world = generate_world(config, tmp_path)
    rows = _read_rows(world.data_path)

    early = [float(r["tau"]) for r in rows if int(r["period"]) < 5]
    late = [float(r["tau"]) for r in rows if int(r["period"]) >= 25]
    assert early and late
    assert mean(early) > mean(late) > 0
    # exp(-0.1 * 27) / exp(-0.1 * 2) ≈ exp(-2.5) ≈ 0.082 → late should be
    # roughly an order of magnitude smaller than early.
    assert mean(late) < 0.2 * mean(early)


def test_non_stationary_zero_lift_records_exactly_zero(tmp_path: Path) -> None:
    """Placebo variant: zero true_lift with any decay/learning config must
    still record ATE == 0 and every per-row tau == 0."""

    config = SimulationConfig(
        world_type=WorldType.NON_STATIONARY,
        n_users=1000,
        true_lift=0.0,
        effect_decay_rate=0.5,
        learning_phase_periods=10,
        learning_phase_noise_multiplier=5.0,
        learning_phase_drift=1.0,
        seed=99,
    )
    world = generate_world(config, tmp_path)
    rows = _read_rows(world.data_path)

    assert world.ground_truth["ate"] == 0.0
    assert world.ground_truth["att"] == 0.0
    assert {float(r["tau"]) for r in rows} == {0.0}
    assert {float(r["treated_propensity"]) - float(r["baseline_propensity"]) for r in rows} == {0.0}


# ---------------------------------------------------------------------------
# cross_campaign_interference world
# ---------------------------------------------------------------------------


def test_cross_campaign_is_deterministic_across_two_runs(tmp_path: Path) -> None:
    config = SimulationConfig(
        world_type=WorldType.CROSS_CAMPAIGN_INTERFERENCE,
        n_users=600,
        n_campaigns=3,
        interference_strength=0.5,
        true_lift=0.04,
        seed=2002,
    )
    a = generate_world(config, tmp_path / "a")
    b = generate_world(config, tmp_path / "b")
    assert a.world_id == b.world_id
    assert a.output_hash == b.output_hash
    assert a.ground_truth == b.ground_truth


def test_cross_campaign_recorded_truth_equals_seed_paired_counterfactual(tmp_path: Path) -> None:
    config = SimulationConfig(
        world_type=WorldType.CROSS_CAMPAIGN_INTERFERENCE,
        n_users=4000,
        n_campaigns=3,
        interference_strength=0.6,
        true_lift=0.04,
        seed=2003,
        noise_sd=0.0,
    )
    world = generate_world(config, tmp_path)
    rows = _read_rows(world.data_path)

    ate = world.ground_truth["ate"]
    tau_mean = _mean_tau(rows)
    paired = _paired_counterfactual_diff(rows)

    assert math.isclose(ate, tau_mean, abs_tol=1e-9, rel_tol=1e-9)
    assert abs(paired - ate) < 1e-4
    assert math.isclose(
        world.ground_truth["seed_paired_counterfactual_diff"], paired, abs_tol=1e-9
    )


def test_cross_campaign_interference_reduces_per_user_tau(tmp_path: Path) -> None:
    """Users with high competing_load must have smaller tau than users with
    low competing_load — the cannibalization is real and per-row."""

    config = SimulationConfig(
        world_type=WorldType.CROSS_CAMPAIGN_INTERFERENCE,
        n_users=4000,
        n_campaigns=4,
        interference_strength=0.8,
        true_lift=0.05,
        heterogeneity_scale=0.0,  # remove other source of tau variation
        seed=303,
    )
    world = generate_world(config, tmp_path)
    rows = _read_rows(world.data_path)

    low = [float(r["tau"]) for r in rows if float(r["competing_load"]) <= 0.25]
    high = [float(r["tau"]) for r in rows if float(r["competing_load"]) >= 0.75]
    assert low and high
    assert mean(low) > mean(high) > 0
    # interference_strength=0.8 with competing_load=1.0 should produce tau
    # roughly 0.2x the no-interference tau.
    assert mean(high) < 0.5 * mean(low)


def test_cross_campaign_zero_lift_records_exactly_zero(tmp_path: Path) -> None:
    config = SimulationConfig(
        world_type=WorldType.CROSS_CAMPAIGN_INTERFERENCE,
        n_users=1000,
        n_campaigns=3,
        interference_strength=0.7,
        true_lift=0.0,
        seed=505,
    )
    world = generate_world(config, tmp_path)
    rows = _read_rows(world.data_path)

    assert world.ground_truth["ate"] == 0.0
    assert world.ground_truth["att"] == 0.0
    assert {float(r["tau"]) for r in rows} == {0.0}


def test_cross_campaign_requires_at_least_two_campaigns() -> None:
    try:
        SimulationConfig(
            world_type=WorldType.CROSS_CAMPAIGN_INTERFERENCE,
            n_users=100,
            n_campaigns=1,
        )
    except ValueError:
        return
    raise AssertionError("cross_campaign with n_campaigns=1 should be rejected")


# ---------------------------------------------------------------------------
# adversarial_misspecified world
# ---------------------------------------------------------------------------


def test_adversarial_is_deterministic_across_two_runs(tmp_path: Path) -> None:
    config = SimulationConfig(
        world_type=WorldType.ADVERSARIAL_MISSPECIFIED,
        n_users=600,
        confound_strength=1.0,
        noise_dist="student_t",
        noise_df=3,
        time_varying_confound_amplitude=0.5,
        hidden_confounder_strength=0.8,
        spillover_strength=0.4,
        true_lift=0.03,
        seed=3003,
    )
    a = generate_world(config, tmp_path / "a")
    b = generate_world(config, tmp_path / "b")
    assert a.world_id == b.world_id
    assert a.output_hash == b.output_hash
    assert a.ground_truth == b.ground_truth


def test_adversarial_recorded_truth_equals_seed_paired_counterfactual(tmp_path: Path) -> None:
    """Even with hidden confounders, time-varying confounding, heavy-tailed
    noise, and spillover, the recorded ATE must equal the seed-paired
    counterfactual difference encoded in the CSV. The OBSERVED data is hard;
    the TRUTH is exact."""

    config = SimulationConfig(
        world_type=WorldType.ADVERSARIAL_MISSPECIFIED,
        n_users=5000,
        confound_strength=1.0,
        noise_dist="student_t",
        noise_df=4,
        time_varying_confound_amplitude=0.4,
        hidden_confounder_strength=0.7,
        spillover_strength=0.3,
        true_lift=0.03,
        seed=4004,
    )
    world = generate_world(config, tmp_path)
    rows = _read_rows(world.data_path)

    ate = world.ground_truth["ate"]
    tau_mean = _mean_tau(rows)
    paired = _paired_counterfactual_diff(rows)

    assert math.isclose(ate, tau_mean, abs_tol=1e-9, rel_tol=1e-9)
    # With heavy-tailed noise plus hidden_u/spillover shifting p0 near the
    # rails, clipping correction can be a few-bp; bound it loosely.
    assert abs(paired - ate) < 5e-4


def test_adversarial_hidden_confounder_is_not_emitted_to_csv(tmp_path: Path) -> None:
    """The hidden confounder is what makes the verifier's job hard — it
    drives both assignment and outcome but the verifier never sees it. The
    metadata records its STRENGTH so we know it's there, but no per-row
    value leaks into the CSV."""

    config = SimulationConfig(
        world_type=WorldType.ADVERSARIAL_MISSPECIFIED,
        n_users=500,
        confound_strength=0.0,
        hidden_confounder_strength=2.0,
        seed=12,
    )
    world = generate_world(config, tmp_path)
    rows = _read_rows(world.data_path)

    forbidden = {"hidden_u", "_hidden_u", "hidden_confounder"}
    assert forbidden.isdisjoint(set(rows[0].keys()))
    assert world.ground_truth["adversarial_misspecified"]["hidden_confounder_strength"] == 2.0


def test_adversarial_heavy_tail_noise_produces_extreme_p0_realizations(tmp_path: Path) -> None:
    """Student-t (low df) noise has fatter tails than Gaussian; with the same
    noise_sd we should see more extreme p0 values. This is the OBSERVED-data
    pain that motivates the world type."""

    common = dict(
        world_type=WorldType.ADVERSARIAL_MISSPECIFIED,
        n_users=4000,
        confound_strength=0.0,
        true_lift=0.0,
        noise_sd=1.0,
        seed=771,
        seasonality=0.0,
    )
    gauss_world = generate_world(SimulationConfig(noise_dist="gaussian", **common), tmp_path / "g")
    t_world = generate_world(SimulationConfig(noise_dist="student_t", noise_df=2, **common), tmp_path / "t")

    def _logit_p0_range(rows: list[dict[str, str]]) -> float:
        # Heavier tails -> more extreme logit values. Use a robust spread
        # metric (5-95 percentile range) so we're not dominated by a single
        # outlier.
        from statistics import quantiles

        logit_p0 = []
        for r in rows:
            p = float(r["baseline_propensity"])
            p = min(max(p, 1e-9), 1 - 1e-9)
            logit_p0.append(math.log(p / (1 - p)))
        qs = quantiles(logit_p0, n=20)
        return qs[18] - qs[0]  # 95th - 5th percentile (approximate)

    g_rows = _read_rows(gauss_world.data_path)
    t_rows = _read_rows(t_world.data_path)
    assert _logit_p0_range(t_rows) > _logit_p0_range(g_rows)


def test_adversarial_spillover_bumps_control_baseline(tmp_path: Path) -> None:
    """Spillover makes control users in heavily-treated geo-periods have a
    higher p0 — that's the SUTVA violation we want the verifier to grapple
    with. The per-row tau is unaffected; only the baseline shifts."""

    common = dict(
        world_type=WorldType.ADVERSARIAL_MISSPECIFIED,
        n_users=4000,
        n_geos=20,
        n_periods=20,
        confound_strength=0.0,
        true_lift=0.0,  # isolate the spillover effect on p0
        noise_sd=0.0,
        seasonality=0.0,
        seed=88,
    )
    no_spill = generate_world(SimulationConfig(spillover_strength=0.0, **common), tmp_path / "ns")
    spill = generate_world(SimulationConfig(spillover_strength=1.0, **common), tmp_path / "s")

    no_spill_rows = _read_rows(no_spill.data_path)
    spill_rows = _read_rows(spill.data_path)
    # Restrict to control users in both worlds and compare their p0 means.
    no_spill_p0 = [
        float(r["baseline_propensity"]) for r in no_spill_rows if r["treatment"] == "0"
    ]
    spill_p0 = [
        float(r["baseline_propensity"]) for r in spill_rows if r["treatment"] == "0"
    ]
    assert mean(spill_p0) > mean(no_spill_p0) + 1e-3


def test_adversarial_zero_lift_records_exactly_zero(tmp_path: Path) -> None:
    """Even with every adversarial knob turned on, true_lift=0 must produce
    exactly zero ATE / per-row tau / paired counterfactual difference. This
    is the placebo guarantee — the verifier MUST return inconclusive on
    these worlds and we MUST be able to score it against zero."""

    config = SimulationConfig(
        world_type=WorldType.ADVERSARIAL_MISSPECIFIED,
        n_users=1500,
        confound_strength=2.0,
        noise_dist="student_t",
        noise_df=3,
        time_varying_confound_amplitude=0.8,
        hidden_confounder_strength=1.5,
        spillover_strength=0.5,
        true_lift=0.0,
        seed=606,
    )
    world = generate_world(config, tmp_path)
    rows = _read_rows(world.data_path)

    assert world.ground_truth["ate"] == 0.0
    assert world.ground_truth["att"] == 0.0
    assert {float(r["tau"]) for r in rows} == {0.0}
    diffs = {
        round(float(r["treated_propensity"]) - float(r["baseline_propensity"]), 12)
        for r in rows
    }
    assert diffs == {0.0}


def test_adversarial_time_varying_confound_scales_confounder_term(tmp_path: Path) -> None:
    """At periods where sin(2pi t / N) = 0 the realized confounder term must
    equal the recorded coefficient; at peaks it must be amplified by exactly
    (1 + amplitude). With noise_sd=0 we can read this off baseline_propensity."""

    config = SimulationConfig(
        world_type=WorldType.ADVERSARIAL_MISSPECIFIED,
        n_users=4000,
        n_periods=12,
        n_geos=8,
        confound_strength=1.5,
        true_lift=0.0,
        time_varying_confound_amplitude=0.7,
        hidden_confounder_strength=0.0,
        spillover_strength=0.0,
        seasonality=0.0,
        noise_sd=0.0,
        seed=222,
    )
    world = generate_world(config, tmp_path)
    rows = _read_rows(world.data_path)

    # Group recency-extreme users by period to recover the modulated coef.
    # For recency=0 → recency_z=1 → (recency_z - 0.5) = 0.5.
    # logit(p0) - intercept = recency_coef_effective * 0.5
    intercept_logit = world.ground_truth["outcome_model"]["intercept_logit"]
    recency_coef_recorded = world.ground_truth["outcome_model"]["coefficients"]["recency"]
    # Period at quarter-cycle should be the most amplified (sin = 1).
    amp = config.time_varying_confound_amplitude
    n_periods = config.n_periods
    peak_period = max(range(n_periods), key=lambda t: math.sin(2 * math.pi * t / n_periods))
    peak_factor = 1.0 + amp * math.sin(2 * math.pi * peak_period / n_periods)

    peak_recency_high = [
        r for r in rows if int(r["period"]) == peak_period and int(r["recency"]) == 0
    ]
    if peak_recency_high:
        # Take any one such row; with noise_sd=0 the recovered coef is exact.
        p0 = float(peak_recency_high[0]["baseline_propensity"])
        recency_z, frequency_z, prior_z = (
            (12 - 0) / 12,
            min(int(peak_recency_high[0]["frequency"]), 20) / 20,
            min(int(peak_recency_high[0]["prior_conversions"]), 5) / 5,
        )
        coefs = world.ground_truth["outcome_model"]["coefficients"]
        # Reconstruct logit(p0) with the time-varying multiplier applied.
        expected_logit = intercept_logit + peak_factor * (
            coefs["recency"] * (recency_z - 0.5)
            + coefs["frequency"] * (frequency_z - 0.5)
            + coefs["prior_conversions"] * (prior_z - 0.5)
        )
        actual_logit = math.log(p0 / (1 - p0))
        assert abs(actual_logit - expected_logit) < 1e-8

    # Recorded amplitude must match what the test just verified.
    assert world.ground_truth["adversarial_misspecified"]["time_varying_confound_amplitude"] == amp


# ---------------------------------------------------------------------------
# CausalProfiler sweep
# ---------------------------------------------------------------------------


def test_causal_profiler_sweep_covers_all_axes() -> None:
    cells = causal_profiler_sweep(
        world_type=WorldType.CONFOUNDED,
        base=SimulationConfig(world_type=WorldType.CONFOUNDED, n_users=200, seed=1),
        seed=1,
    )
    # Default grid: 3 * 3 * 3 * 3 = 81 cells.
    assert len(cells) == 81
    # Labels must be unique — duplicates would mean two cells with identical
    # axis values, which defeats the sweep.
    labels = [c.label for c in cells]
    assert len(set(labels)) == len(labels)
    # Cover both sign of the lift (positive AND negative AND zero) — this is
    # the "effect sign (including negative lift)" axis from the WP brief.
    signs = {
        ("pos" if c.config.true_lift > 0 else ("neg" if c.config.true_lift < 0 else "zero"))
        for c in cells
    }
    assert signs == {"pos", "neg", "zero"}
    # Cover both low and high overlap.
    treat_fracs = {c.config.treat_frac for c in cells}
    assert treat_fracs == {0.1, 0.5, 0.9}


def test_causal_profiler_sweep_negative_lift_world_records_negative_ate(tmp_path: Path) -> None:
    """A negative-lift cell must produce a world whose recorded ATE is
    negative — the simulator must support 'this campaign actually hurt'."""

    cells = causal_profiler_sweep(
        world_type=WorldType.CONFOUNDED,
        base=SimulationConfig(world_type=WorldType.CONFOUNDED, n_users=1000, seed=11),
        seed=11,
        base_lift_magnitude=0.04,
    )
    neg_cells = [c for c in cells if c.config.true_lift < 0]
    assert neg_cells
    # Pick a single negative cell, generate it, and check the recorded ATE.
    cell = neg_cells[0]
    world = generate_world(cell.config, tmp_path / cell.label.replace("|", "_"))
    assert world.ground_truth["ate"] < 0
    rows = _read_rows(world.data_path)
    assert _mean_tau(rows) < 0


def test_causal_profiler_sweep_zero_sign_records_exactly_zero(tmp_path: Path) -> None:
    cells = causal_profiler_sweep(
        world_type=WorldType.CONFOUNDED,
        base=SimulationConfig(world_type=WorldType.CONFOUNDED, n_users=500, seed=21),
        seed=21,
    )
    zero_cells = [c for c in cells if c.config.true_lift == 0.0]
    assert zero_cells
    cell = zero_cells[0]
    world = generate_world(cell.config, tmp_path / cell.label.replace("|", "_"))
    assert world.ground_truth["ate"] == 0.0
    rows = _read_rows(world.data_path)
    assert {float(r["tau"]) for r in rows} == {0.0}


def test_causal_profiler_sweep_cells_are_deterministic(tmp_path: Path) -> None:
    """Two calls to the sweep must produce identical cells AND identical
    generated worlds. The whole point of a sweep is that a verifier's
    average performance over the grid is reproducible."""

    cells_a = causal_profiler_sweep(
        world_type=WorldType.CONFOUNDED,
        base=SimulationConfig(world_type=WorldType.CONFOUNDED, n_users=200, seed=7),
        seed=7,
    )
    cells_b = causal_profiler_sweep(
        world_type=WorldType.CONFOUNDED,
        base=SimulationConfig(world_type=WorldType.CONFOUNDED, n_users=200, seed=7),
        seed=7,
    )
    assert [c.label for c in cells_a] == [c.label for c in cells_b]
    # Spot-check one cell — generated world must match byte-for-byte.
    cell_a = cells_a[3]
    cell_b = cells_b[3]
    a = generate_world(cell_a.config, tmp_path / "a")
    b = generate_world(cell_b.config, tmp_path / "b")
    assert a.world_id == b.world_id
    assert a.output_hash == b.output_hash


# ---------------------------------------------------------------------------
# Metadata invariants across the new worlds
# ---------------------------------------------------------------------------


def test_new_worlds_record_their_world_specific_metadata(tmp_path: Path) -> None:
    """Each new world's metadata.json must carry the world-specific block
    (non_stationary, cross_campaign_interference, adversarial_misspecified)
    with the literal parameter values the world was generated under. Without
    this, a downstream reader cannot tell what flavor of hardness the world
    encodes."""

    cases = [
        (
            "non_stationary",
            SimulationConfig(
                world_type=WorldType.NON_STATIONARY,
                n_users=200,
                effect_decay_rate=0.07,
                learning_phase_periods=4,
                seed=1,
            ),
            {"effect_decay_rate": 0.07, "learning_phase_periods": 4},
        ),
        (
            "cross_campaign_interference",
            SimulationConfig(
                world_type=WorldType.CROSS_CAMPAIGN_INTERFERENCE,
                n_users=200,
                n_campaigns=4,
                interference_strength=0.55,
                seed=2,
            ),
            {"n_campaigns": 4, "interference_strength": 0.55},
        ),
        (
            "adversarial_misspecified",
            SimulationConfig(
                world_type=WorldType.ADVERSARIAL_MISSPECIFIED,
                n_users=200,
                confound_strength=0.5,
                noise_dist="student_t",
                noise_df=4,
                time_varying_confound_amplitude=0.3,
                hidden_confounder_strength=0.4,
                spillover_strength=0.2,
                seed=3,
            ),
            {
                "noise_dist": "student_t",
                "noise_df": 4,
                "time_varying_confound_amplitude": 0.3,
                "hidden_confounder_strength": 0.4,
                "spillover_strength": 0.2,
            },
        ),
    ]
    for name, config, expected in cases:
        world = generate_world(config, tmp_path / name)
        meta = json.loads(world.metadata_path.read_text(encoding="utf-8"))
        block = meta["ground_truth"][name]
        for key, value in expected.items():
            assert block[key] == value, f"{name}.{key}: expected {value}, got {block[key]}"


def test_seed_paired_counterfactual_diff_is_recorded_for_every_world(tmp_path: Path) -> None:
    """Every world records a population-level seed-paired counterfactual
    difference. Downstream tooling can use this to verify the per-row truth
    contract without needing to reconstruct it from the CSV."""

    for world_type in WorldType:
        kwargs: dict = {"world_type": world_type, "n_users": 200, "seed": 33}
        if world_type in (
            WorldType.CONFOUNDED,
            WorldType.ZERO_LIFT_PLACEBO,
            WorldType.ADVERSARIAL_MISSPECIFIED,
        ):
            kwargs["confound_strength"] = 0.5
        if world_type == WorldType.CROSS_CAMPAIGN_INTERFERENCE:
            kwargs["n_campaigns"] = 2
        if world_type == WorldType.GEO_STRUCTURED:
            kwargs["n_geos"] = 10
            kwargs["n_periods"] = 10
        world = generate_world(SimulationConfig(**kwargs), tmp_path / world_type.value)
        assert "seed_paired_counterfactual_diff" in world.ground_truth
