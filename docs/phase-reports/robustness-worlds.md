# Robustness Worlds Phase Report

Branch: `wp/robustness-worlds` (off `origin/main`)
Worktree: `/opt/admatix-wt/robust`
Status: simulator extended with three new harder world types + a
config-driven CausalProfiler sweep; full simulator pytest green (37 tests);
verifier sampled against the new worlds — data recorded below as findings,
NOT as a gate.

## Scope

Extends `services/simulator` with the world types named in the WP brief:

1. `non_stationary` — true lift exponentially decays over time; an optional
   "learning phase" (first K periods after launch) carries elevated noise and
   a transient logit drift on the baseline.
2. `cross_campaign_interference` — multiple campaigns share the audience.
   The focal campaign's per-row effect is diluted by the fraction of
   competing campaigns also active on that user (`competing_load`). The
   recorded ground truth is the NET causal effect of the focal campaign,
   still known by construction.
3. `adversarial_misspecified` — deliberately violates the common verifier
   assumptions: optional heavy-tailed (Student-t) outcome noise,
   time-varying confounder coefficients, a hidden Bernoulli confounder that
   drives BOTH treatment assignment and outcome (and is NEVER written to the
   CSV), and geo-period-level spillover that bumps control units' baseline.
4. A CausalProfiler-style sweep helper (`causal_profiler_sweep()`) that
   yields a labeled list of `SimulationConfig`s spanning confounding,
   heterogeneity, effect sign (incl. NEGATIVE lift), and treatment/control
   overlap.

No file outside `services/simulator/` was modified.

## Doctrine

Every new world preserves the simulator's defining contract: **the per-row
true effect `τ_i` exists and is known by construction**, and the recorded
`ate = mean(τ_i)`. The OBSERVED data is what gets harder.

- `treated_propensity` (= `clip(p0 + τ_i, 0, 1)`) is now written to the CSV
  alongside `baseline_propensity`. The seed-paired counterfactual difference
  is recoverable from any CSV as `mean(treated_propensity - baseline_propensity)`,
  and is also recorded as `ground_truth.seed_paired_counterfactual_diff`.
- For non-stationary worlds, decay is folded into `τ_i` directly:
  `τ_i = effective_lift * (modifier_i / mean_modifier) * exp(-decay_rate * t_i)`.
  `ate` is the SAMPLE MEAN of `τ_i` over the realized panel — verifiers
  recovering a single ATE will recover the time-averaged effect, not the
  peak lift. The peak lift is also recorded as `true_incremental_lift`.
- For cross-campaign worlds, `τ_i` is the focal campaign's per-user effect
  after dilution: `τ_i = base * modifier_i * max(0, 1 - interference_strength
  * competing_load_i)`. `ate = mean(τ_i)` is the realized net causal effect.
- For adversarial worlds, `τ_i` is the user-i direct treatment effect (the
  additive lift in propensity that being treated causes for user i). Hidden
  confounder, spillover, and time-varying confounding all shift `p0` — they
  do not change `τ_i`. The verifier's job is to recover `mean(τ_i)` in spite
  of those shifts.
- Negative `true_lift` is now supported (the sweep grid explicitly covers
  `sign ∈ {-1, 0, +1}`). The simulator does not validate `true_lift >= 0`.

## New parameters (additions to `SimulationConfig`)

| Parameter | Default | Used by | Meaning |
|---|---|---|---|
| `heterogeneity_scale` | 0.4 | all | Range of per-user CATE modifier (`1 ± h/2`). 0 disables heterogeneity. Default reproduces the previous `[0.8, 1.2]` range. |
| `effect_decay_rate` | 0.0 | non_stationary | `τ_i` is multiplied by `exp(-effect_decay_rate * period)`. |
| `learning_phase_periods` | 0 | non_stationary | Periods `t < K` get elevated noise + linear logit-drift on baseline. |
| `learning_phase_noise_multiplier` | 1.0 | non_stationary | `noise_sd` is multiplied by this during the learning phase. |
| `learning_phase_drift` | 0.0 | non_stationary | Additive logit drift on baseline; ramps linearly from this value at t=0 down to 0 at t=K. |
| `n_campaigns` | 1 | cross_campaign | Number of campaigns sharing the audience (focal = 0). |
| `interference_strength` | 0.0 | cross_campaign | `τ_i` is scaled by `max(0, 1 - interference_strength * competing_load_i)`. |
| `noise_dist` | `"gaussian"` | adversarial | `"gaussian"` or `"student_t"`. |
| `noise_df` | 5.0 | adversarial | df for Student-t noise (variance-matched to `noise_sd`). |
| `time_varying_confound_amplitude` | 0.0 | adversarial | Realized confounder term is multiplied by `1 + amp * sin(2π t / N)`. |
| `hidden_confounder_strength` | 0.0 | adversarial | Strength of an unobserved Bernoulli U_i in both assignment and outcome. NEVER written to CSV. |
| `spillover_strength` | 0.0 | adversarial | Geo-period focal-treatment rate is added to `p0` with this coefficient. |

All new parameters validate `≥ 0` at construction. `cross_campaign_interference`
rejects `n_campaigns < 2`.

## New output columns

The simulator now writes two additional columns to every world (zero in
worlds that do not use them, so existing readers are unaffected):

- `treated_propensity` — `clip(p0 + τ_i, 0, 1)`. With `baseline_propensity`
  this makes the per-row seed-paired counterfactual recoverable directly
  from the CSV.
- `competing_load` — average of competing campaigns' assignment for the
  user (0.0 outside `cross_campaign_interference`).

## New metadata blocks

`ground_truth` now also carries:

- `seed_paired_counterfactual_diff` — `mean(p1 - p0)` over all rows.
- `non_stationary` — the decay / learning-phase parameters used.
- `cross_campaign_interference` — `n_campaigns`, `interference_strength`.
- `adversarial_misspecified` — `noise_dist`, `noise_df`,
  `time_varying_confound_amplitude`, `hidden_confounder_strength`,
  `spillover_strength`.
- `outcome_model.heterogeneity_scale`, `outcome_model.noise_dist`,
  `outcome_model.noise_df` — augmented to describe the new degrees of
  freedom in the data-generating process.

## Tests

`services/simulator/tests/test_robustness_worlds.py` adds 22 tests. Every new
world type is exercised against the three required invariants from the
brief:

| World | Determinism | Seed-paired counterfactual = recorded truth | Zero-effect = exactly zero |
|---|---|---|---|
| `non_stationary` | `test_non_stationary_is_deterministic_across_two_runs` | `test_non_stationary_recorded_truth_equals_seed_paired_counterfactual` | `test_non_stationary_zero_lift_records_exactly_zero` |
| `cross_campaign_interference` | `test_cross_campaign_is_deterministic_across_two_runs` | `test_cross_campaign_recorded_truth_equals_seed_paired_counterfactual` | `test_cross_campaign_zero_lift_records_exactly_zero` |
| `adversarial_misspecified` | `test_adversarial_is_deterministic_across_two_runs` | `test_adversarial_recorded_truth_equals_seed_paired_counterfactual` | `test_adversarial_zero_lift_records_exactly_zero` |

Plus behavioral assertions that the OBSERVED data is actually harder:

- `test_non_stationary_effect_actually_decays_over_time` — early-period τ
  is at least 5x late-period τ at `decay_rate = 0.1`.
- `test_cross_campaign_interference_reduces_per_user_tau` — high-competing-load
  users have at least 2x smaller τ than low-load users.
- `test_adversarial_heavy_tail_noise_produces_extreme_p0_realizations` —
  Student-t (df=2) produces a wider robust spread of logit(p0) than Gaussian
  at the same `noise_sd`.
- `test_adversarial_spillover_bumps_control_baseline` — controls in
  heavily-treated geo-periods have measurably higher p0.
- `test_adversarial_hidden_confounder_is_not_emitted_to_csv` — the hidden
  confounder column never appears in the CSV under any name.
- `test_adversarial_time_varying_confound_scales_confounder_term` — at the
  sinusoidal peak the realized confounder term equals
  `(1 + amplitude) * coefficient`, exactly.

CausalProfiler sweep tests:

- `test_causal_profiler_sweep_covers_all_axes` — 81 cells, unique labels,
  all three signs and overlap levels represented.
- `test_causal_profiler_sweep_negative_lift_world_records_negative_ate` —
  negative-lift cells produce worlds with strictly negative recorded ATE.
- `test_causal_profiler_sweep_zero_sign_records_exactly_zero` — zero-sign
  cells produce worlds with exactly-zero recorded ATE.
- `test_causal_profiler_sweep_cells_are_deterministic` — two sweep calls
  produce byte-identical worlds.

Cross-cutting:

- `test_world_is_deterministic_across_two_runs` — extended to also iterate
  the three new world types.
- `test_seed_paired_counterfactual_diff_is_recorded_for_every_world` —
  every world type records the population counterfactual diff.
- `test_new_worlds_record_their_world_specific_metadata` — each new world's
  metadata block contains the literal parameter values used.

### Verification

```
$ .venv/bin/pytest services/simulator/tests -q
.....................................                                    [100%]
37 passed in ~2.0s
```

Re-run twice back-to-back to pin determinism:

```
$ .venv/bin/pytest services/simulator/tests -q
37 passed in 1.91s
$ .venv/bin/pytest services/simulator/tests -q
37 passed in 2.14s
```

## Verifier sample on the new worlds (data, NOT a gate)

To anchor what these worlds DO to verifier performance, the existing
`admatix-verifier` (FastAPI service, unchanged) was run against 4 seeds per
scenario via `services/simulator/scripts/sample_verifier_on_robustness_worlds.py`.
The verifier auto-selected `cate_meta_learner` for every scenario (the new
worlds carry user-level covariates and no logged propensities).

Per-scenario aggregates (mean over 4 seeds, n_users=3000, n_periods=30,
n_geos=20):

| Scenario | True ATE | Mean est | Bias | RMSE | 95% CI cover | `lift_detected` |
|---|---:|---:|---:|---:|---:|---:|
| non_stationary_moderate | 0.0213 | 0.0180 | −0.0032 | 0.0069 | 1.00 | 0.75 |
| non_stationary_steep_decay | 0.0119 | 0.0066 | −0.0053 | 0.0069 | 1.00 | 0.00 |
| cross_campaign_mild_interference | 0.0340 | 0.0335 | −0.0005 | 0.0041 | 1.00 | 1.00 |
| cross_campaign_heavy_interference | 0.0324 | 0.0322 | −0.0002 | 0.0041 | 1.00 | 1.00 |
| adversarial_heavy_tail_only | 0.0400 | 0.0417 | +0.0017 | 0.0077 | 1.00 | 1.00 |
| adversarial_hidden_confounder | 0.0400 | 0.0715 | **+0.0315** | **0.0322** | **0.00** | 1.00 |
| adversarial_full_stack | 0.0400 | 0.0505 | +0.0105 | 0.0129 | 0.75 | 1.00 |
| adversarial_zero_lift_placebo | 0.0000 | 0.0137 | **+0.0137** | 0.0152 | **0.50** | **0.50** |

(`True ATE` for non-stationary scenarios is the time-averaged effect
recorded as `ground_truth.ate` — the peak `true_incremental_lift` is 0.04
and 0.05 respectively. The mean reflects exponential decay over the
30-period horizon.)

### What the data shows

The point of these worlds is to make the data hard; the numbers above
quantify exactly how hard.

- **Non-stationary** is recovered with small negative bias — the verifier
  reports the time-averaged effect, which IS the contract, but it does so
  with wide CIs that often span zero when the average effect is small
  (steep-decay: `lift_detected` rate = 0/4). Coverage is 100% precisely
  because CIs are wide enough to catch the truth even when point estimates
  are off.
- **Cross-campaign interference** is the easiest of the three for the
  verifier — the per-row `τ_i` already encodes the dilution, and the
  verifier recovers `mean(τ_i)` cleanly. This is the expected behavior:
  the OBSERVED data carries the right signal because focal treatment is
  independent of competing assignment.
- **Adversarial heavy-tail noise alone** doesn't break the verifier — the
  DML/T-learner aggregates over noise that already has a finite mean (we
  variance-match the Student-t to `noise_sd`).
- **Adversarial hidden confounder** is where the verifier breaks: 79%
  relative bias, 0/4 coverage, but `lift_detected` rate is still 1.00 —
  the verifier confidently reports a wrong-magnitude effect because it
  cannot adjust for U. This is the intended adversarial finding.
- **Adversarial full stack** lies between the two: hidden confounder is
  partially absorbed by other regularization but still produces 26% bias
  and 75% coverage.
- **Adversarial zero-lift placebo** is the most diagnostic case: with all
  adversarial knobs on and `true_lift=0`, the verifier reports a 0.014
  spurious lift and a 50% false-positive rate. This is exactly the
  "verifier may perform poorly on adversarial worlds" finding the WP
  brief expected — and it is now MEASURABLE because the truth is exactly
  zero by construction.

Raw per-seed results: `data/.cache/robustness-worlds-verifier-sample.json`
(not tracked).

### Honest caveats

- The sample uses 4 seeds per scenario and `n_users = 3_000`. Phase-4 will
  re-run at the 1,000-world × 200K-user grid the master plan calls out;
  these numbers are an early signal, not a final benchmark.
- The verifier was not allowed to fail the build on any of the adversarial
  results — the brief is explicit: the verifier may perform poorly on hard
  worlds; that is the intended finding, not a release blocker.
- The verifier's BSTS / OPE / geo paths were not exercised by this sample.
  The auto-selected method was `cate_meta_learner` in every case because
  the new worlds carry user-level covariates and no logged propensities.

## Files changed

```
services/simulator/src/admatix_simulator/__init__.py
services/simulator/tests/test_simulator.py
services/simulator/tests/test_robustness_worlds.py
services/simulator/scripts/sample_verifier_on_robustness_worlds.py
docs/phase-reports/robustness-worlds.md  (this file)
```

## Coordination

Per the task brief, this work is confined to `wp/robustness-worlds` and
edits ONLY `services/simulator` and its tests (plus this phase report).
`packages/schemas`, `services/verifier`, `services/validation`,
`services/uplift`, and every other component were left untouched. The
verifier was RUN (read-only) for the sample table above; its source code
was not modified.

The verifier's `WorldType` literal in `services/verifier/src/admatix_verifier/models.py`
still only enumerates the original four worlds — that is intentional. The
`/simulate` HTTP route remains restricted to the legacy worlds; the new
worlds are exercised by callers that import `admatix_simulator` directly
(as the validation harness will) and pass the resulting `data_uri` /
`metadata_uri` into `/verify`. Loosening the literal is a one-line change
that belongs in the verifier's track, not this one.
