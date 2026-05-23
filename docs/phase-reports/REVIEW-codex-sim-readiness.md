# Adversarial Review — codex/sim-readiness

Reviewer branch: `review/codex-sim` (worktree: `/opt/admatix-wt/revsim`)
Subject branch: `codex/sim-readiness`
Scope: `services/simulator/`, `services/ingest/`, `data/checksums/*`, against
`docs/architecture/SIMULATION-VERIFICATION.md`, `docs/build/DATASETS.md`,
`docs/build/CODEX-SIM-READINESS-PLAN.md`, `AGENTS.md`.

## Verdict: **NEEDS-REWORK**

The branch ships clean, deterministic, well-tested stdlib Python and the two
datasets land on disk with correct row counts. The acceptance criteria in
`CODEX-SIM-READINESS-PLAN.md` are nominally met. **But the simulator is
proof-critical, and the methodology has structural defects that compromise the
core claim that "true incremental effect is known by construction" in a way an
independent verifier can be scored against.** Three problems are
release-blocking:

- The recorded `confounder_coefficients` ground truth is **fabricated** — it
  does not describe the actual outcome model. A verifier that checks against
  these will be scored against a value the simulator never used.
- The `geo_structured` world does not produce a valid geo×period panel — each
  geo only appears at a deterministic subset of periods. The geo-holdout
  verifier (SIMULATION-VERIFICATION §2.4) cannot be exercised against this
  data.
- `confound_strength=0` is silently overridden to `0.8` (outcome) / `1.0`
  (assignment) by a falsy-fallback `or`. A user who explicitly disables
  confounding in a `confounded` or `zero_lift_placebo` world still gets it.

The ingest layer has a secondary integrity problem: the manifest sha256 records
the **source archive**, not the **landed CSV** the simulator/verifier will
actually read. Tampering with the landed file is undetectable. None of these
are visible from green tests, because the tests largely re-validate the
implementation against itself.

Determinism, schema validation, license labelling, and the four world-type
*identity* checks (clean A/B is balanced, placebo's τ=0, confounded biases
naive lift, geo treatment is geo-level) are correct as far as they go. The
issues below are concentrated in (a) what ground truth means and (b) the
geo-panel structure.

---

## Issues

Severity legend: **C** = critical (release-blocking for the YC proof claim);
**H** = high; **M** = medium; **L** = low / nit.

### 1. [C] `ground_truth.confounder_coefficients` does not describe the actual outcome model

- **File:** `services/simulator/src/admatix_simulator/__init__.py:217-231`
- **Problem:** The recorded ground truth advertises
  ```python
  "confounder_coefficients": {
      "recency": confound_coeff,
      "frequency": round(confound_coeff * 0.6, 6),
      "prior_conversions": round(confound_coeff * 0.4, 6),
  },
  ```
  but the outcome model at line 193 does not multiply `recency`, `frequency`,
  or `prior_conversions` by anything. It uses a single derived feature `intent`
  (line 107) and applies one coefficient: `confound_term = confound_coeff *
  0.35 * (row["intent"] - 0.5)`. The reported per-covariate coefficients are
  not coefficients of anything that appears in the data-generating process.
  They are decorative.
- **Impact:** This is the headline integrity defect. An "independent verifier
  scored against the simulator's ground truth" — the YC proof claim — is being
  handed values that have no relation to the model used to generate the data.
  Recovering `confound_coeff` from the actual data would require recovering
  the implicit coefficients on `(recency, frequency, prior_conversions)` *that
  collapse through intent* — those are roughly
  `-0.35·c·0.55/12 ≈ -0.016·c` for recency, `0.35·c·0.3/20 ≈ 0.0053·c` for
  frequency, `0.35·c·0.15/5 ≈ 0.0105·c` for prior_conversions. Nothing close
  to `c`, `0.6c`, `0.4c`.
- **Fix:** Either (a) drive the outcome from the underlying covariates with
  the *named, recorded* coefficients (so the metadata is literally true), or
  (b) drop `confounder_coefficients` from the ground truth and instead record
  the actual outcome-model spec used (`intent` formula, coefficient on
  `intent`, coefficient on `geo_effect`, the `intent` definition). Option (a)
  is preferable because it makes the bias structure interpretable by anyone
  reading the manifest.

### 2. [C] `geo_structured` world has no valid geo×period panel

- **File:** `services/simulator/src/admatix_simulator/__init__.py:105-106`
- **Problem:** Each row is one user with `period = user_id % n_periods` and
  `geo_id = f"geo_{user_id % n_geos:03d}"`. Both indices are deterministic
  functions of `user_id`. With the **default** `n_periods=90`,
  `n_geos=100`, every geo appears in exactly 9 of the 90 periods (the user
  ids satisfying `id % 100 = G` have `id % 90 ∈ {G mod 90, (G+100) mod 90,
  …}`, a strided coset). Worse, the test in `test_simulator.py:83-96` uses
  `n_users=1200, n_geos=24` and (by default) `n_periods=90` — there
  `gcd(24, 90)=6`, so the geo/period pattern is heavily striped.
  Empirically reproduced:
  ```
  n_users=10000, n_periods=90, n_geos=100
    min/mean/max periods-per-geo = 9/9/9
    geo_000 periods = [0, 10, 20, 30, 40, 50, 60, 70, 80]
    period 0 treat/ctrl = 34/78  (different geo composition each period)
  ```
- **Impact:** The whole point of the `geo_structured` world is to exercise
  geo-holdout verifiers — diff-in-diff or synthetic control on geos with
  pre/post periods (SIMULATION-VERIFICATION §2.4, §1.3). With this layout:
  - No treated geo has a pre-treatment period and a post-treatment period
    co-existing in the data — every geo only exists at a fixed strided set of
    periods, and within that set every row is either always-treated or
    always-control (treatment is assigned at geo level).
  - Period-level cross-sections have unbalanced and *different* geo
    composition each period, so any DiD will conflate "treatment" with "which
    geos happen to live in this period."
  - Geo random effects (geo_effects, line 185) cannot generate the
    cross-temporal correlation structure the verifier expects.
- **Fix:** Decouple `geo_id` and `period` from `user_id`. Generate
  `n_geos × n_periods` cells and populate users into each cell (e.g.,
  `user_id // n_periods` → geo bucket, or sample geo and period
  independently). The world is currently cross-sectional, not panel.

### 3. [C] `confound_strength=0` is silently overridden to a non-zero default

- **File:** `services/simulator/src/admatix_simulator/__init__.py:137-141, 183`
- **Problem:** Two `or`-based falsy-fallbacks treat `0` as "unset":
  ```python
  # _assign_treatment:
  strength = config.confound_strength if config.confound_strength else 1.0
  # generate_world:
  confound_coeff = 0.0 if config.world_type == WorldType.CLEAN_AB else (config.confound_strength or 0.8)
  ```
  A user who configures `WorldType.CONFOUNDED, confound_strength=0.0` (a
  perfectly reasonable request: "I want confounding turned off in a confounded
  template") gets `strength=1.0` for assignment and `confound_coeff=0.8` for
  the outcome. Reproduced:
  ```
  confounded with confound_strength=0 → recorded coefs {recency: 0.8, ...},
  naive_lift=0.033 vs ATE=0.020 (still strongly biased).
  ```
  Same applies to `zero_lift_placebo` (the placebo world *cannot* be
  configured without confounding because the only way to ask for "no
  confounding" is `confound_strength=0`, which is overridden).
- **Impact:** The placebo world is the verifier's most important sanity
  check. The fact that a placebo with `confound_strength=0` still has hidden
  confounding (0.8 outcome coupling, 1.0 assignment coupling) means the
  placebo can never be a *pure* zero-lift world. The `zero_lift_placebo`
  test asserts τ=0 and ATE=0, which is true (because `effective_lift=0`
  overrides everything), but the realized outcomes still carry
  selection-on-intent.
- **Fix:** Use explicit defaults at construction (`SimulationConfig`
  per-world-type defaults) or check `is None` instead of `or`. Better: make
  `confound_strength` *the only* knob and default it correctly per world
  type during `__post_init__`, so callers cannot end up in this trap.

### 4. [H] User-period model is degenerate — one row per user

- **File:** `services/simulator/src/admatix_simulator/__init__.py:99-118`
- **Problem:** SIMULATION-VERIFICATION §1.1 describes "user-period rows", but
  the implementation generates **one row per user** with `period` synthesized
  from `user_id`. No user has a longitudinal record. There is no within-user
  trend, no per-user noise that persists, no impression-level data.
- **Impact:** The BSTS / synthetic control path (Layer (b),
  SIMULATION-VERIFICATION §2.2) needs aggregate time series. The only time
  signal here is `_seasonality(period)`, but it appears as a coefficient on
  `period` in p0 with no within-unit autocorrelation. Power/MDE calculations
  that assume geo-level variance over time will be miscalibrated.
- **Fix:** Either change the doc to acknowledge "one row per user, periods
  are a covariate label for seasonality" (cheap), or emit `n_users ×
  n_periods` rows with user-fixed effects (expensive but matches the spec).

### 5. [H] Calibration to real data (Criteo / Hillstrom) is absent

- **File:** `services/simulator/src/admatix_simulator/__init__.py`
- **Problem:** SIMULATION-VERIFICATION §1.4 makes calibration to Criteo /
  Hillstrom a gating step: "Before a world is accepted, marginal distributions
  … are compared to reference fits … 1-Wasserstein distance below tolerance."
  Nothing in `services/simulator` reads the staged datasets or computes any
  distance metric.
- **Impact:** Simulated worlds may look nothing like real campaign data — a
  verifier tuned to the simulator's marginals will not transfer to live ad
  data. This is exactly what the calibration step is meant to prevent.
- **Fix:** Either (a) acknowledge in the phase report that calibration is
  out-of-scope for sim-readiness and tracked as a separate WP, or (b) add a
  `calibrate()` function that compares per-arm conversion rates, recency /
  frequency histograms, and revenue marginals against fits from the staged
  datasets and refuses to emit a world that fails tolerance.

### 6. [H] Manifest sha256 protects the upstream archive, not the landed file

- **File:** `services/ingest/src/admatix_ingest/__init__.py:208-214`
- **Problem:** `acquire_dataset` passes `source_path` (the raw download,
  possibly a `.gz`) to `write_checksum_record`, not the landed file. For
  Criteo the manifest records the `.csv.gz` checksum; the
  `criteo_uplift_v2.1.sha256` file references `criteo-research-uplift-v2.1.csv.gz`,
  not the decompressed `criteo-uplift-v2.1.csv` the simulator/verifier will
  actually open. Verified locally:
  ```
  Source (.gz) sha256: c9df…
  Landed (.csv) sha256: 4c58…
  Manifest sha256:     c9df…  (== source)
  Manifest original_filename: src.csv.gz, byte_size: 104  (≠ landed)
  ```
- **Impact:** If anyone tampers with the landed CSV (or it bit-rots),
  `sha256sum -c data/checksums/criteo_uplift_v2.1.sha256` against the landed
  file will not detect it. The proof package's data-integrity story is
  weaker than it appears. For Hillstrom this is a non-issue because the
  source and landed file are byte-identical CSV.
- **Fix:** Either checksum the **landed** artifact (loses ability to verify
  upstream archive), or record **both** hashes in the manifest
  (`archive_sha256` and `landed_sha256`), and write checksum files for the
  landed paths that downstream code will use.

### 7. [H] No pinned expected hash; first-run hash is silently trusted

- **File:** `services/ingest/src/admatix_ingest/__init__.py:39-49, 195-225`
- **Problem:** `DatasetSpec` carries no `expected_sha256` field. On every
  run, whatever bytes are at the URL get hashed and recorded — there is no
  comparison against a known-good value. A compromised mirror or a partial
  download would result in a "valid"-looking manifest with a different hash.
- **Impact:** The provenance claim is "we recorded a hash" rather than "we
  verified against a known hash." For Criteo, DATASETS.md says no upstream
  checksum is published, so the *first* download has to be trusted blind —
  but subsequent verifications should fail if the bytes change. Today they
  silently re-record.
- **Fix:** Add `expected_sha256: str | None` to `DatasetSpec`. After
  `_copy_or_decompress`, if `expected_sha256` is set, compare and **abort**
  on mismatch. Pin the values already discovered (`0e58…` for Hillstrom,
  `2716…` for Criteo) into the spec so re-acquires are self-checking.

### 8. [M] `download_to_raw` re-uses any non-empty cached file with no integrity check

- **File:** `services/ingest/src/admatix_ingest/__init__.py:228-238`
- **Problem:** `if target.exists() and target.stat().st_size > 0: return target`.
  A partial / corrupt download larger than 0 bytes is treated as authoritative
  on subsequent runs. There is no resume, no minimum-size check, no hash
  comparison.
- **Impact:** A botched 1-byte file becomes the de-facto source forever
  until manually deleted. Combined with issue #7 (no expected hash), the
  acquire pipeline cannot self-repair from a bad cache.
- **Fix:** Either always re-validate the cached file against
  `expected_sha256`, or require the user to delete and re-fetch.

### 9. [M] Source URLs are plain HTTP

- **File:** `services/ingest/src/admatix_ingest/__init__.py:84, 96`
- **Problem:** Both upstream URLs are `http://`, not `https://`. Without
  transport integrity and no `expected_sha256`, a MITM-modified file would be
  accepted and its hash recorded as "the truth."
- **Impact:** Real proof-time risk for the YC claim, even if low-probability.
- **Fix:** Use HTTPS where available (some Criteo `go.criteo.net` redirects
  do support HTTPS). For URLs that only support HTTP, pin
  `expected_sha256` (issue #7) so transport tampering is detected.

### 10. [M] `validate_dataset` checks header order and counts rows, nothing else

- **File:** `services/ingest/src/admatix_ingest/__init__.py:127-149`
- **Problem:** No type validation (treatment column is 0/1, conversion is
  0/1, numeric columns are numeric). A file with the correct header and
  garbage in cells would pass.
- **Impact:** Downstream code fails later with confusing errors.
- **Fix:** For the validation datasets (Hillstrom, Criteo), sample N rows
  and assert per-column type/range. Cheap, ~100 rows is enough.

### 11. [M] `enforce_expected_rows` is opt-in and default off

- **File:** `services/ingest/src/admatix_ingest/__init__.py:201, 248`
- **Problem:** The CLI requires `--enforce-rows` to make the published row
  count an acceptance criterion. The phase report claims the published row
  counts match, but the default `acquire_dataset` call would have passed
  even on truncated downloads.
- **Impact:** Silent partial-download acceptance.
- **Fix:** Make `enforce_expected_rows=True` the default for known
  datasets; allow opt-out via CLI flag for development.

### 12. [M] CATE heterogeneity is weak

- **File:** `services/simulator/src/admatix_simulator/__init__.py:179-180,
  189-191`
- **Problem:** `raw_modifiers = [0.8 + 0.4 * intent]` produces a 20% range
  on τ. After normalization, `tau ∈ [~0.8·effective_lift, ~1.2·effective_lift]`.
  With default `true_lift=0.005`, the spread is ±0.001. Empirically, in a
  `confounded` world with `confound_strength=3.0`, `ATT − ATE = 0.00047`
  (4.7% relative) — barely enough heterogeneity to challenge meta-learners.
- **Impact:** Layer (c) verifiers (CATE meta-learners,
  SIMULATION-VERIFICATION §2.3) and the Qini / AUUC harness (§3.4) will be
  testing on a near-homogeneous-effect world. The Qini ≥ 0.5·(oracle Qini)
  threshold is easy to clear when the oracle ranking itself is barely
  separating.
- **Fix:** Either expose a `heterogeneity_strength` knob and document its
  meaning, or widen the modifier range (e.g., 0.4 to 1.6) and make
  heterogeneity driven by more than one feature so the CATE ranking is
  non-trivial.

### 13. [M] `geo_structured` test does not assert a usable panel

- **File:** `services/simulator/tests/test_simulator.py:83-96`
- **Problem:** The test only checks that each geo has one treatment value.
  It does not check that geos are present across periods, that treated and
  control geos overlap in time, or that DiD is even feasible.
- **Impact:** Issue #2 is invisible to the test suite. This is exactly the
  kind of "test re-validates the bug" pattern that hides methodology
  problems.
- **Fix:** Add an assertion that every geo appears in ≥ k periods and that
  both treated and control geos co-exist at every period (after fixing
  issue #2).

### 14. [L] Recorded ATE is identically `effective_lift` by construction

- **File:** `services/simulator/src/admatix_simulator/__init__.py:189-190, 218`
- **Problem:** `tau = effective_lift * modifier / mean_modifier`. So
  `mean(tau) = effective_lift * mean(modifier) / mean_modifier = effective_lift`
  to machine precision. The recorded `ate` field is therefore always equal
  to `true_incremental_lift`, redundantly.
- **Impact:** Not a correctness issue but the redundancy obscures whether
  the verifier should target `mean(tau_i)` (sample ATE) or `E[τ]` (population
  ATE). The normalization conflates them.
- **Fix:** Either drop one of the two fields, or document explicitly that
  the simulator chooses `mean(tau_i) = true_lift` exactly via normalization.

### 15. [L] Negative `true_lift` accepted with no validation

- **File:** `services/simulator/src/admatix_simulator/__init__.py:36-48`
- **Problem:** `__post_init__` rejects bad `treat_frac`, `n_users`,
  `baseline_cr`, `n_periods`, `n_geos`, but not `true_lift`. `true_lift = -0.5`
  is accepted; with the modifier normalization, `p1 = p0 - 0.5*modifier_i`,
  which is clipped to 0 for almost every unit. The recorded ATE will be
  `−0.5`, the realized outcomes will all be 0.
- **Impact:** Garbage inputs produce garbage worlds silently.
- **Fix:** Range-check `true_lift` (e.g., abs ≤ 0.5) or document that the
  user must keep it reasonable.

### 16. [L] `revenue` rng consumption is conditional on outcome

- **File:** `services/simulator/src/admatix_simulator/__init__.py:199`
- **Problem:** `revenue = round(rng.lognormvariate(...), 4) if outcome
  else 0.0`. The `rng` is only advanced for converting users. This is
  deterministic per config, but it means changing `baseline_cr` slightly (so
  some outcomes flip) shifts every subsequent revenue draw downstream.
- **Impact:** Low — reproducibility for the same config is intact; only
  cross-config comparisons are affected.
- **Fix:** Draw revenue unconditionally and zero it out post-hoc, so the
  rng state is independent of outcome realizations.

### 17. [L] World id collision domain is 48 bits

- **File:** `services/simulator/src/admatix_simulator/__init__.py:209`
- **Problem:** `world_id = f"w_{config_hash[:12]}"`. 12 hex chars = 48 bits.
  Birthday collisions at ~2^24 worlds. Fine today, fragile if a sweep grid
  ever runs millions of worlds.
- **Fix:** Use 16 hex chars (64 bits).

### 18. [L] `naive_lift` has no SE; tests don't pin its bias direction

- **File:** `services/simulator/src/admatix_simulator/__init__.py:254-263`,
  `tests/test_simulator.py:50-64`
- **Problem:** `naive_lift` is a point estimate only. The confounded test
  asserts `abs(naive − ATE) > 0.01` but does not assert the bias is
  positive (which is what one would expect from high-intent users being both
  over-targeted and more likely to convert).
- **Fix:** Either assert `naive − ATE > 0.01` (signed), or add a verifier
  smoke test that uses propensity weighting and checks the bias collapses.

### 19. [L] `DATASET_SPECS` exposes Criteo under two aliases

- **File:** `services/ingest/src/admatix_ingest/__init__.py:106-110`
- **Problem:** Both `"criteo"` and `"criteo_uplift_v2.1"` map to the same
  spec. `argparse choices` will list both. The user-facing key is
  ambiguous.
- **Fix:** Pick one canonical key.

### 20. [L] `budget` parameter accepted but unused; `true_iroas` always null; spend not modeled

- **File:** `services/simulator/src/admatix_simulator/__init__.py:26, 218-220`
- **Problem:** `budget` is declared in `SimulationConfig` and documented in
  SIMULATION-VERIFICATION §1.2 ("caps treated impressions"), but the
  simulator never enforces or even reads it. `true_iroas` is hard-coded to
  `None`. There is no spend per impression, so iROAS is not derivable.
- **Impact:** Verifier branches that test iROAS or budget-cap guardrail
  proofs (SIMULATION-VERIFICATION §2.1) cannot be exercised against this
  simulator. The proof claim "we verified iROAS within ±10% of truth"
  cannot be supported.
- **Fix:** Either drop `budget` from the config (with a doc update), or
  enforce it by truncating treated impressions and recording realized
  `n_treated`, and add a per-impression cost so iROAS = sum(revenue · W) /
  sum(cost · W) is computable.

### 21. [L] License is metadata only — no enforcement

- **File:** `services/ingest/src/admatix_ingest/__init__.py:181-191`
- **Problem:** The manifest records `redistribution: internal_non_commercial_only`
  for Criteo, but nothing in the pipeline prevents the file from being
  redistributed (e.g., bundled into an exported proof package). Discipline-only.
- **Fix:** Make `redistribution: internal_non_commercial_only` a flag the
  packaging step refuses to bundle.

### 22. [L] RNG seed offsets are magic numbers

- **File:** `services/simulator/src/admatix_simulator/__init__.py:95, 123,
  182, 184`
- **Problem:** `seed+10_003`, `seed+30_007`, `seed+40_009`. The intent
  (orthogonal RNG streams) is fine, but the offsets are undocumented. A
  reader has to read all four call sites to be sure they are distinct.
- **Fix:** Name them: `SEED_OFFSET_TREAT`, `SEED_OFFSET_OUTCOME`, etc.

### 23. [L] `_open_text` only handles `.gz` and plain CSV

- **File:** `services/ingest/src/admatix_ingest/__init__.py:121-124`
- **Problem:** No `.bz2`, `.zip`, `.zst`, `.tsv`, etc. DATASETS.md
  references zip and tsv (Criteo Attribution, iPinYou) but those datasets
  are out of scope here. Fine for the current two datasets; flag if scope
  expands.

---

## What the tests do and do not cover

Passing tests (`pytest services/ingest services/simulator -q` → 10 pass):

- `test_clean_ab_world_is_reproducible_and_records_truth` — same seed
  reproduces same world hash. ✓ Verified independently.
- `test_clean_ab_treatment_is_balanced_and_not_tied_to_recency` — treated
  recency mean ≈ control recency mean. ✓
- `test_confounded_world_makes_naive_lift_biased` — |naive − ATE| > 0.01.
  ✓ but does not pin sign or the source of the bias.
- `test_zero_lift_placebo_keeps_tau_and_ate_at_zero` — all τ_i = 0,
  ATE = 0, ATT = 0. ✓ True because `effective_lift` is hard-zeroed; does
  not verify the placebo is otherwise calibrated.
- `test_geo_structured_world_assigns_treatment_at_geo_level` — each geo
  has a single treatment value. ✓ but does **not** assert a usable
  geo×period panel (issue #2 / #13).
- `test_world_type_accepts_string_values` — enum coercion. ✓
- `test_hillstrom_schema_checksum_and_manifest` — round-trips schema and
  manifest. ✓ Notably, asserts `result.sha256 == compute_sha256(source)`,
  which encodes the issue #6 behaviour rather than catching it.
- `test_criteo_uplift_gzip_lands_decompressed_and_validates_schema` —
  gzip → CSV landing, schema OK. ✓ Same source-vs-landed checksum issue.
- `test_schema_rejects_missing_or_misordered_columns` — header mismatch
  caught. ✓
- `test_write_checksum_record_is_stable_and_git_safe` — manifest does not
  embed `data/datasets`. ✓

Missing tests that would catch real bugs:

1. Geo×period panel feasibility for `geo_structured` (issue #2).
2. Naive-lift recovery on clean A/B at large n (sanity check on the
   unbiased baseline).
3. Confounder coefficient consistency: regression of outcome on
   covariates should recover the recorded coefficients within tolerance.
   This is the test that would have caught issue #1.
4. `confound_strength=0` honored explicitly in confounded /
   zero_lift_placebo (issue #3).
5. Determinism across world types: identical seed but different
   `world_type` should produce identical `X_i` (currently true; should be
   pinned).
6. Negative `true_lift` rejected or documented (issue #15).
7. `expected_sha256` enforcement for ingest (issue #7).
8. Partial-cache rejection in `download_to_raw` (issue #8).

---

## Recommended remediation order

To unblock the proof claim, fix in this order:

1. Issues **#1** (fake confounder coefficients) and **#3** (silent
   override) — both methodology integrity, both small diffs.
2. Issue **#2** (geo panel structure) — restructures the geo world; biggest
   single fix but essential for Layer (d) of the verifier.
3. Issues **#6** + **#7** + **#8** (ingest checksum / expected hash /
   partial cache) — single coordinated change to the manifest and
   `download_to_raw`, adds an `expected_sha256` field, pins both Hillstrom
   and Criteo to their first-discovered hash.
4. Issue **#5** (calibration) — either implement or explicitly scope out
   in the phase report. Currently the report claims sim-readiness without
   acknowledging this gap.
5. Issue **#12** (heterogeneity strength) — required before Qini / AUUC
   gates have any teeth.

The remaining medium and low issues are cleanup that can be batched.

---

## Files reviewed

```
services/simulator/src/admatix_simulator/__init__.py    (267 lines)
services/simulator/tests/test_simulator.py              (104 lines)
services/simulator/requirements.txt                     (1 line)
services/ingest/src/admatix_ingest/__init__.py          (308 lines)
services/ingest/src/admatix_ingest/__main__.py          (4 lines)
services/ingest/tests/test_ingest.py                    (107 lines)
services/ingest/requirements.txt                        (1 line)
data/checksums/hillstrom.sha256
data/checksums/hillstrom.manifest.json
data/checksums/criteo_uplift_v2.1.sha256
data/checksums/criteo_uplift_v2.1.manifest.json
.gitignore (relevant entries)
```

Reference specs:

```
docs/architecture/SIMULATION-VERIFICATION.md
docs/build/DATASETS.md
docs/build/CODEX-SIM-READINESS-PLAN.md
docs/phase-reports/codex-sim-readiness.md
AGENTS.md
```

No source code in `services/` was modified by this review.
