# Fix Sim Readiness Phase Report

Branch: `fix/sim-readiness` (based on `origin/codex/sim-readiness`)
Worktree: `/opt/admatix-wt/fixsim`
Status: simulator integrity defects flagged in `REVIEW-codex-sim-readiness.md`
fixed; full pytest suite green; ready for re-review.

## Scope

This track addresses the **NEEDS-REWORK** verdict from
`docs/phase-reports/REVIEW-codex-sim-readiness.md` (branch
`origin/review/codex-sim`). All three release-blocking CRITICAL findings are
resolved by root-cause fixes in `services/simulator` and `services/ingest`,
each backed by a regression test that genuinely would have caught the bug.
The cheap HIGH findings (#6, #7) are also fixed; remaining MEDIUM/LOW
findings are noted below with disposition.

No file outside `services/simulator/` and `services/ingest/` was modified.

---

## Critical findings — fixed

### #1 — `confounder_coefficients` did not describe the actual outcome model

- **Problem:** the manifest advertised
  `{"recency": c, "frequency": 0.6c, "prior_conversions": 0.4c}` but the
  outcome model multiplied a single derived `intent` feature by one
  coefficient. The recorded coefficients had no relation to the
  data-generating process — a verifier scored against them would be scored
  against fiction.
- **Fix:** dropped the derived `intent` feature entirely. The outcome model
  now uses the three named normalized covariates directly, with the literal
  coefficients that are recorded in the manifest:

  ```
  logit(p0) = intercept_logit
            + recency_coef         * (recency_z - 0.5)
            + frequency_coef       * (frequency_z - 0.5)
            + prior_conversions_coef * (prior_conversions_z - 0.5)
            + seasonality(period)
            + geo_effect[geo_id]
            + N(0, noise_sd)
  ```

  `recency_z = (12 - recency) / 12`, `frequency_z = min(frequency, 20) / 20`,
  `prior_conversions_z = min(prior_conversions, 5) / 5`. The same coefficients
  drive the treatment-assignment logit (scaled by an explicit
  `ASSIGNMENT_BIAS_MULTIPLIER = 3.0`) in confounded / zero-lift placebo
  worlds. The ground truth now carries an `outcome_model` block (formula,
  intercept_logit, coefficients, covariate_normalization, noise/seasonality
  amplitudes, treatment-effect normalization note) and an `assignment_model`
  block (rule, treat_frac, bias_multiplier, coefficients). The legacy
  `confounder_coefficients` field is retained and now reports the literal
  truth.
- **Storage precision:** `baseline_propensity` is now serialized at 12dp
  (was 8dp) so a verifier can reconstruct `logit(p0)` exactly from the
  manifest formula.
- **Files:**
  - `services/simulator/src/admatix_simulator/__init__.py` —
    `_normalize_covariates`, `_confounder_coefficients`,
    `_covariate_contribution`, rewritten `_covariates`,
    `_assign_treatment`, and `generate_world`.
- **New test that would have caught it:**
  `test_recorded_confounder_coefficients_match_actual_outcome_model` —
  generates a no-noise/no-seasonality world, reconstructs `logit(p0)` from
  the recorded coefficients alone, and asserts it equals the recorded
  `baseline_propensity` to within 1e-8 for every row.
- **Supporting test:**
  `test_recorded_assignment_model_matches_actual_treatment_propensity` —
  verifies the assignment_model coefficients actually drive treatment by
  binning users on recency and checking that the realized treated-rate
  differential matches the recorded logit model's direction and magnitude.

### #2 — `geo_structured` world had no valid geo×period panel

- **Problem:** `geo_id = f"geo_{user_id % n_geos:03d}"` and
  `period = user_id % n_periods` made both indices deterministic functions of
  `user_id`. With default `n_geos=100, n_periods=90` every geo appeared in
  exactly 9 of 90 periods, period composition varied per period, and
  geo-holdout / DiD verifiers could not be exercised.
- **Fix:** for `geo_structured` worlds only, geo and period are decoupled
  from `user_id`. Round-robin geo allocation populates every geo (`geo_index
  = user_id % n_geos`); period allocation is a within-geo cycle
  (`(user_id // n_geos) % n_periods`) with a per-world jitter from a
  dedicated panel RNG (`SEED_OFFSET_PANEL`). For
  `n_users >= n_geos * n_periods` this produces a fully balanced
  geo×period panel: every geo observed at every period. The construction
  validator now refuses `geo_structured` configs with `n_users < n_geos`.
- **Files:**
  - `services/simulator/src/admatix_simulator/__init__.py` — `_covariates`,
    `SimulationConfig.__post_init__`.
- **New test that would have caught it:**
  `test_geo_structured_world_has_usable_geo_period_panel` — asserts every
  geo is observed at every period, every period contains both a treated
  and a control geo, and the geo composition is identical across periods
  (the old striped layout would fail every one of those assertions).

### #3 — `confound_strength=0` was silently overridden

- **Problem:** two `or`-based falsy-fallbacks treated `0` as "unset":

  ```python
  # _assign_treatment
  strength = config.confound_strength if config.confound_strength else 1.0
  # generate_world
  confound_coeff = 0.0 if world_type == WorldType.CLEAN_AB else (config.confound_strength or 0.8)
  ```

  A confounded world configured with `confound_strength=0` still got
  `strength=1.0` for assignment and `confound_coeff=0.8` for outcome. The
  zero-lift placebo could never be a pure zero-lift world because there was
  no way to actually turn confounding off.
- **Fix:** removed both fallbacks. `confound_strength` is the single knob,
  passed verbatim into the outcome and assignment models. For clean A/B and
  geo-structured worlds the coefficients are 0 by construction (user-level
  confounding is not part of those worlds' generative story); for confounded
  and zero-lift placebo worlds, the configured value is honored even when
  zero. `SimulationConfig.__post_init__` now rejects negative
  `confound_strength`.
- **Files:**
  - `services/simulator/src/admatix_simulator/__init__.py` —
    `_confounder_coefficients`, `_assign_treatment`,
    `SimulationConfig.__post_init__`.
- **New tests that would have caught it:**
  - `test_confound_strength_zero_is_honored_in_confounded_world` — confirms
    a confounded world with `confound_strength=0` has zero recorded
    coefficients, balanced treated/control covariate means, and an
    unbiased naive lift.
  - `test_zero_lift_placebo_with_no_confounding_is_truly_zero` — confirms a
    placebo with `confound_strength=0` has a naive lift tightly centered on
    zero (the verifier-must-return-null sanity check the original placebo
    test couldn't enforce).

### Determinism contract (cross-cutting)

- **New test:** `test_world_is_deterministic_across_two_runs` — runs every
  world type twice with the same `(config, seed)` and pins
  `world_id == world_id`, `output_hash == output_hash`, and
  `ground_truth == ground_truth`. Run twice in CI as a sanity check.

---

## High findings — fixed (cheap and obviously correct)

### #6 — Manifest sha256 protected the upstream archive, not the landed file

- **Fix:** `write_checksum_record` now hashes the LANDED artifact (the file
  downstream code opens), records the upstream `archive_sha256` separately,
  and writes the `.sha256` file keyed on the LANDED filename so
  `sha256sum -c data/checksums/<dataset>.sha256` validates the right bytes.
  `AcquisitionResult` gains an `archive_sha256` field.
- **File:** `services/ingest/src/admatix_ingest/__init__.py`.
- **New test:** the existing Criteo test now asserts
  `manifest["sha256"] == compute_sha256(landed)` and
  `manifest["archive_sha256"] == compute_sha256(source)` — encoding the new
  invariant rather than the bug.

### #7 — No pinned expected hash; first-run hash was silently trusted

- **Fix:** `DatasetSpec` gains `expected_archive_sha256` and
  `expected_landed_sha256`. Pinned values for Hillstrom (landed == archive,
  `0e5893…`) and Criteo (archive `2716e1bf…`; landed pending observed
  download). `acquire_dataset` and `download_to_raw` raise
  `DatasetIntegrityError` on mismatch instead of silently re-recording.
- **File:** `services/ingest/src/admatix_ingest/__init__.py`.
- **New tests:**
  - `test_acquire_dataset_aborts_on_archive_hash_mismatch`
  - `test_acquire_dataset_aborts_on_landed_hash_mismatch`

### #8 — `download_to_raw` trusted any non-empty cached file

- **Fix:** when `expected_archive_sha256` is set, `download_to_raw`
  validates the cached file against the pin and removes / re-downloads on
  mismatch. Without a pin, behavior is unchanged (still trusts non-empty
  cache — documented as a fallback).
- **New test:** `test_download_to_raw_rejects_corrupt_cache_when_hash_is_pinned`.

### #11 — `enforce_expected_rows` was opt-in (related cheap fix)

- **Fix:** `acquire_dataset` and `acquire_by_name` now default to
  `enforce_expected_rows=True`. The CLI flips from `--enforce-rows` (opt-in)
  to `--no-enforce-rows` (opt-out for development).

### #16 — Revenue RNG consumption was conditional on outcome (related cheap fix)

- **Fix:** revenue is now drawn unconditionally in the outcome loop and
  zeroed out post-hoc when `outcome == 0`. The outcome RNG stream is now
  independent of which users converted.
- **New test:** `test_revenue_rng_is_independent_of_outcome_realization`.

### #17 — World id collision domain widened from 48 to 64 bits

- **Fix:** `world_id = f"w_{config_hash[:16]}"` (was `[:12]`).

### #19 — Removed ambiguous `"criteo"` alias

- **Fix:** `DATASET_SPECS` is keyed only on the canonical
  `criteo_uplift_v2.1`; the duplicate `"criteo"` key was removed.

### #22 — RNG seed offsets are now named constants

- **Fix:** `SEED_OFFSET_COVARIATES / TREATMENT / OUTCOME / GEO_EFFECT /
  PANEL` documented at module scope.

---

## Findings noted (MEDIUM / LOW, not addressed in this track)

| # | Severity | Status | Notes |
|---|---|---|---|
| 4 | H | **noted** | One row per user. Out of scope here — true user-period panels would explode row counts (≥ 18M at default config) and need a row-format change. Scheduled for a separate WP. |
| 5 | H | **noted** | Calibration to Criteo / Hillstrom. Out of scope for sim-readiness fixes; would require pulling the staged datasets into the simulator's loop. Tracked as a follow-up. |
| 9 | M | **noted** | Source URLs are plain HTTP. Pinning `expected_archive_sha256` (finding #7, fixed) now detects MITM tampering even without HTTPS. Will switch to HTTPS where the publishers support it in a follow-up. |
| 10 | M | **noted** | `validate_dataset` only checks header order + row count. Per-cell type validation is a cheap follow-up but doesn't block the proof claim. |
| 12 | M | **noted** | Weak CATE heterogeneity. Modifier range and feature dependency unchanged; widening this requires deciding the meta-learner test plan first. |
| 13 | M | **fixed** | The geo-panel test now asserts panel feasibility (see #2). |
| 14 | L | **fixed** | `outcome_model.notes` documents the `mean(tau_i) == true_incremental_lift` normalization explicitly. |
| 15 | L | **partial** | Negative `confound_strength` now rejected; negative `true_lift` validation deferred. |
| 16 | L | **fixed** | See above. |
| 17 | L | **fixed** | See above. |
| 18 | L | **fixed** | Confounded test now also asserts the signed bias direction (`naive - ATE > 0.01`). |
| 19 | L | **fixed** | See above. |
| 20 | L | **noted** | `budget` / iROAS modeling — out of scope; requires a per-impression cost model and a treated-impression cap. |
| 21 | L | **noted** | License is metadata only. Enforcement belongs in the packaging step, not in ingest. |
| 22 | L | **fixed** | See above. |
| 23 | L | **noted** | `_open_text` handles `.gz` + plain CSV; sufficient for current datasets. |

---

## Verification

```
$ .venv/bin/pytest services/simulator services/ingest -q
......................                                                   [100%]
22 passed in 0.89s
```

Determinism test run twice back-to-back, both pass:

```
$ .venv/bin/pytest services/simulator/tests/test_simulator.py::test_world_is_deterministic_across_two_runs -q
. 1 passed in 0.06s
$ .venv/bin/pytest services/simulator/tests/test_simulator.py::test_world_is_deterministic_across_two_runs -q
. 1 passed in 0.06s
```

Test breakdown:

- `services/simulator/tests/test_simulator.py`: 15 tests (6 pre-existing,
  9 new). Pre-existing tests pass unchanged against the rewritten model.
- `services/ingest/tests/test_ingest.py`: 7 tests (4 pre-existing, 3 new).
  Pre-existing tests pass against the new manifest schema (the synthetic
  fixtures use a `_strip_pinned_hashes` helper to avoid tripping the new
  integrity checks against test-only bytes).

---

## Coordination

Per the task brief, this work is confined to `fix/sim-readiness`. No
`main`, `wp/*`, `codex/verifier`, or TypeScript-package files were touched.
The verifier track on `codex/verifier` will consume the corrected ground
truth — the recorded `outcome_model` and `assignment_model` blocks give it
everything it needs to recover the data-generating process and be scored
honestly against truth.

---

## Files changed

```
services/simulator/src/admatix_simulator/__init__.py
services/simulator/tests/test_simulator.py
services/ingest/src/admatix_ingest/__init__.py
services/ingest/tests/test_ingest.py
docs/phase-reports/fix-sim-readiness.md  (this file)
```
