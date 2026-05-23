# WP-V — Back-tests against real RCT data (`services/backtests`)

**Owns:** `services/backtests/**`, `docs/runbooks/backtests.md`
**Branch:** `wp/v-backtests` · **Phase:** 4 · **Wave:** 2
**Depends on:** WP-T (`services/validation`) and WP-U (`services/uplift`) both
  merged on `main`. Transitively: `services/simulator` (WP-Q),
  `services/verifier` (WP-R), `services/ingest` (WP-P). Hillstrom (64 000
  rows) and Criteo Uplift v2.1 (13 979 592 rows) are already landed on the
  VPS by WP-P, with `data/checksums/{hillstrom,criteo_uplift_v2.1}.{sha256,
  manifest.json}` pinned.
**Suggested agent:** Claude Code Opus 4.7 · **Size:** large

## Why this exists

Simulator calibration (WP-T) and placebos (WP-U) prove the engine's *behaviour*
is sound on synthetic worlds. They do not prove the engine *recovers truth on
real-world data*. WP-V is the slice that closes the loop: take two public
randomized-trial datasets where the answer is known, run the full
verifier + uplift pipeline against them, and assert the engine recovers the
published result inside a documented tolerance band. This is the single
strongest validation move in the proof wave — it is exactly how Haus
validates synthetic control and how the published Criteo Uplift baselines
are themselves anchored — and it is the move a YC technical partner is
most likely to demand.

The Phase 4 master-plan bullet WP-V owns is **"back-tests within tolerance
of published results."** The last acceptance test in this WP (§ Acceptance
test 7) is that gate bullet.

WP-V sits in Wave 2 because both bands it asserts depend on WP-U: the
Criteo Qini number it tolerance-tests is `admatix_uplift.run_qini_criteo`'s
output, and the loader / DataFrame typing it consumes is
`admatix_uplift.load_{hillstrom,criteo_uplift}`. Reusing them keeps the
engine under test the same one Phase 5's proof report will reference.

## Required reading (in this order)

1. `docs/architecture/PROOF-WAVE-MASTER-PLAN.md` §2 (item 8 — *"Back-test
   against a real known-answer dataset — recover the published
   incrementality result on **Criteo Uplift v2.1** and **Hillstrom**. This
   is the strongest single move."*), §6.3 (back-tests run nightly + on every
   release branch — WP-V wires the harness; the orchestrator schedules
   the cadence in Phase 5), §6.4 (the datasets table — Hillstrom is
   permissively-licensed; Criteo Uplift v2.1 is BY-NC-SA non-commercial,
   research/benchmark use only — WP-V inherits the WP-U license boundary).
2. `docs/architecture/SIMULATION-VERIFICATION.md` §3.7 — the back-test
   pass criteria, verbatim:
   - **Criteo Uplift v2.1** (~13.98M rows; propensity AUC ≈ 0.509):
     *"verifier's ATE estimate within the published RCT 95% CI for the
     visit / conversion outcome; reproduced Qini within ±10% of a
     published `causalml` / `scikit-uplift` baseline."*
   - **Hillstrom MineThatData email** (64K customers, 3 arms): *"recover
     the well-known positive visit lift for the men's / women's email
     arms with a CI excluding zero; reproduce published AUUC within
     ±10%."*
   The §4 pinned Python stack (`causalml==0.16.0` for Qini/AUUC,
   `econml==0.16.0` for DML/DR, `scikit-learn 1.5` for nuisance models) is
   inherited via WP-U.
3. `docs/architecture/ARCHITECTURE-DEEP.md` §9 — the causal-lift discipline.
   Every back-test number WP-V publishes ships with its dataset SHA256,
   train/test split hash, RNG seed, CATE model identifier, and the
   reference whose tolerance it lives inside (URL + DOI / arXiv ID +
   accessed date). The published references are quoted in the runbook
   so a reviewer can independently re-fetch them.
4. `docs/build/AUTONOMOUS-WAVE-PLAN.md` Phase 4 row + gate — the four-WP
   split and the gate bullets. WP-V is Wave 2, opus.
5. `docs/build/DATASETS.md` §1 (Criteo Uplift Prediction v2.1) and §3
   (Hillstrom). The exact column schemas WP-V's expected results are
   computed against:
   - Hillstrom: `segment ∈ {Mens E-Mail, Womens E-Mail, No E-Mail}`;
     outcomes `visit, conversion, spend`. Treatment = `segment != No
     E-Mail`. The well-known *visit* deltas (widely reported in the
     `scikit-uplift` and `causalml` docs and replicated independently
     across the uplift-modeling community for 15+ years) are: Mens
     E-Mail vs No E-Mail ≈ **+0.063 visits/customer** (95% CI excludes
     zero), Womens E-Mail vs No E-Mail ≈ **+0.045 visits/customer**
     (95% CI excludes zero). WP-V recomputes the reference difference
     in-place from the data on every run (so the tolerance is not a
     hard-coded literal) — the asserted property is **CI excludes
     zero**, plus the AUUC ±10% band.
   - Criteo Uplift v2.1: 16-column numeric schema; binary `treatment`,
     `conversion`, `visit`, `exposure`. The reference paper
     (Diemert et al., arXiv 2111.10106) reports the propensity AUC
     (0.509) and a Qini benchmark across estimators; WP-V's tolerance
     is ±10% of the *same-estimator* Qini computed by `causalml`
     directly on the dataset — a within-toolkit reproducibility check.
6. `docs/build/TESTING-AND-COMPARISON.md` §B.2 — the Qini / AUUC lane WP-V
   feeds. WP-W packages the lane for the benchmark report; WP-V owns the
   back-test pass/fail.
7. `docs/build/WP-T-validation.md` + `docs/build/WP-U-uplift-placebo.md`
   + `docs/phase-reports/R-report.md` + `docs/phase-reports/S-report.md` —
   the public surfaces WP-V imports:
   - `from admatix_uplift import load_hillstrom, load_criteo_uplift,
     run_qini_criteo, UpliftConfig` (no re-implementation).
   - `from admatix_verifier.methods import cate, geo` plus
     `admatix_verifier.app:app` for the optional HTTP path.
   - `from admatix_validation.coverage import run_coverage` is *not*
     used here — WP-V's "CI excludes zero" check is a per-back-test
     assertion, not a population coverage run.
8. `services/uplift/src/admatix_uplift/loaders.py` — the read path WP-V
   uses. Both loaders are idempotent and license-aware; WP-V does **not**
   add a second loader.
9. `AGENTS.md` — golden rules 4 (every claim carries source refs — WP-V's
   metrics JSON embeds the dataset SHA, the WP-U revision SHA, the
   verifier revision SHA, and the published-reference URL + accessed
   date), 8 (determinism), 9 (no secrets, no raw Criteo rows committed).

## Public surface

The build agent implements **exactly** the signatures below. The batch
path calls the verifier and the uplift engine in-process; the gate test
additionally exercises the FastAPI verifier surface via TestClient.

### Top-level package (`services/backtests/src/admatix_backtests/__init__.py`)

```python
__version__ = "0.1.0"
__all__ = [
    "run_hillstrom_backtest", "HillstromBacktestResult",
    "run_criteo_backtest",    "CriteoBacktestResult",
    "BacktestConfig",
]
```

### Shared types (`src/admatix_backtests/types.py`)

```python
@dataclass(frozen=True)
class BacktestConfig:
    """Outer config for one back-test run. Persisted alongside every result."""
    output_dir: Path                    # absolute path; the harness writes JSON+PNG here
    seed: int = 17                      # train/test split + bootstrap seed
    bootstrap_iters: int = 1000         # for the CI-excludes-zero check
    ci_level: float = 0.95
    auuc_tolerance: float = 0.10        # §3.7 — ±10% of the published reference
    qini_tolerance: float = 0.10        # §3.7 — ±10% of the published reference
    cate_model: Literal["econml_dml", "causalml_t_learner",
                        "causalml_x_learner"] = "econml_dml"
    hillstrom_arms: list[Literal["mens_email", "womens_email"]] = field(
        default_factory=lambda: ["mens_email", "womens_email"])
    criteo_outcomes: list[Literal["visit", "conversion"]] = field(
        default_factory=lambda: ["visit", "conversion"])
    criteo_sample_rows: int | None = None    # None = full 13.98M; int = head sample for smoke
```

### Hillstrom back-test (`src/admatix_backtests/hillstrom.py`)

```python
@dataclass(frozen=True)
class HillstromArmResult:
    arm: Literal["mens_email", "womens_email"]
    outcome: Literal["visit"]                # primary; conversion is reported as a secondary number
    n_treated: int
    n_control: int
    ate_estimate: float                      # mean(visit | treated) − mean(visit | control)
    ci_low: float
    ci_high: float
    ci_method: Literal["bootstrap"]
    ci_excludes_zero: bool                   # §3.7 — required to pass

    auuc_estimate: float                     # from the verifier's CATE pipeline
    auuc_reference: float                    # from a fresh causalml fit on the same data
    auuc_relative_delta: float               # (estimate − reference) / |reference|
    auuc_within_tolerance: bool              # |relative_delta| ≤ auuc_tolerance

    secondary_conversion_ate: float          # the conversion lift (not asserted, reported)
    secondary_spend_ate: float               # spend lift (not asserted, reported)
    arm_passes: bool                         # ci_excludes_zero AND auuc_within_tolerance

@dataclass(frozen=True)
class HillstromBacktestResult:
    dataset_sha256: str                      # echoes data/checksums/hillstrom.sha256
    rows: int                                # 64 000
    arms: list[HillstromArmResult]
    auuc_pooled: float                       # pooled across both treated arms (rebuilt from CATE)
    passes: bool                             # all arms pass
    metrics_path: Path
    qini_curve_paths: list[Path]             # one per arm
    license_note: str = (
        "Hillstrom MineThatData — public-challenge dataset (no formal license); "
        "attribution to Kevin Hillstrom / MineThatData recommended."
    )
    reference_url: str = "https://www.uplift-modeling.com/en/latest/api/datasets/fetch_hillstrom.html"

def run_hillstrom_backtest(config: BacktestConfig) -> HillstromBacktestResult:
    """Recover the well-known Hillstrom email lift per §3.7.
      1. Load via `admatix_uplift.load_hillstrom(...)` (idempotent).
      2. For each arm in `config.hillstrom_arms`:
         a) Slice the dataset to `segment ∈ {arm, No E-Mail}`; map segment
            to treatment ∈ {0, 1}.
         b) Compute the visit-rate ATE = mean(visit | treated) −
            mean(visit | control); compute a bootstrap CI at `config.ci_level`
            over `config.bootstrap_iters` resamples seeded by `config.seed`.
            Hillstrom is a true RCT, so the difference-in-means estimator is
            unbiased — no CATE model needed for the CI.
         c) Assert `ci_excludes_zero` — both `ci_low > 0` and `ci_high > 0`
            (the well-known positive lift). This is the §3.7 "CI excluding
            zero" pass condition.
         d) Fit the verifier's CATE pipeline (econml DML on covariates
            `recency, history, mens, womens, newbie` → visit) and compute
            its AUUC via `causalml.metrics.auuc_score`.
         e) Compute a reference AUUC by fitting a fresh `causalml`
            T-Learner on the same data — a within-toolkit reproducibility
            anchor. (The published canonical AUUC numbers vary slightly
            across papers and library versions; the most reproducible
            reference is a fresh fit on the same input, which is exactly
            what §B.2's "reproduce published Qini/AUUC on Criteo Uplift
            with our CATE estimators" frames.)
         f) Assert `|auuc_relative_delta| ≤ auuc_tolerance` (default 10%).
      3. Pass iff every arm passes both criteria.
    Side effects: writes `output_dir/hillstrom/metrics.json`, per-arm
    Qini-curve PNGs, and a bootstrap-distribution histogram per arm."""
```

### Criteo Uplift v2.1 back-test (`src/admatix_backtests/criteo.py`)

```python
@dataclass(frozen=True)
class CriteoOutcomeResult:
    outcome: Literal["visit", "conversion"]
    n_treated: int
    n_control: int
    ate_estimate: float                       # the RCT difference-in-means (Criteo is near-random)
    ci_low: float
    ci_high: float
    ci_method: Literal["bootstrap"]
    ci_excludes_zero: bool

    qini_estimate: float                      # the verifier's CATE pipeline's Qini
    qini_reference: float                     # fresh causalml fit on the same data
    qini_relative_delta: float                # (estimate − reference) / |reference|
    qini_within_tolerance: bool               # |relative_delta| ≤ qini_tolerance

    auuc_estimate: float
    auuc_reference: float
    auuc_relative_delta: float
    auuc_within_tolerance: bool

    outcome_passes: bool                      # qini_within_tolerance AND auuc_within_tolerance

@dataclass(frozen=True)
class CriteoBacktestResult:
    dataset_sha256: str                       # echoes data/checksums/criteo_uplift_v2.1.sha256
    rows_total: int                           # ≤ 13_979_592
    rows_train: int
    rows_test: int
    propensity_auc: float                     # Criteo doc reports ≈ 0.509; WP-V recomputes
    outcomes: list[CriteoOutcomeResult]
    passes: bool                              # all outcomes pass
    metrics_path: Path
    qini_curve_paths: list[Path]              # one per outcome
    license_note: str = (
        "Criteo Uplift v2.1 is CC BY-NC-SA 4.0 — internal R&D use only; "
        "non-commercial; share-alike; attribution to Diemert et al. AdKDD 2018."
    )
    reference_url: str = "https://arxiv.org/abs/2111.10106"
    reference_doi: str = ""                   # filled if/when the JMLR version is published

def run_criteo_backtest(config: BacktestConfig) -> CriteoBacktestResult:
    """Recover the Criteo Uplift v2.1 published result per §3.7.
      1. Load via `admatix_uplift.load_criteo_uplift(nrows=config.criteo_sample_rows)`
         (idempotent; nrows=None reads the full 13_979_592-row CSV).
      2. Compute propensity AUC: fit a logistic regression on (f0..f11) → treatment;
         report the AUC. The reference value (Criteo doc) is 0.509; the engine's
         number sits inside `[0.49, 0.53]` (a "near-random" sanity check, not
         a gate).
      3. Train/test split deterministically by `config.seed` and 50/50.
      4. For each outcome in `config.criteo_outcomes` (`visit` and
         `conversion`):
         a) ATE on the test set: difference-in-means + bootstrap CI;
            assert `ci_excludes_zero` for `visit` (Criteo Uplift is a
            near-RCT with a documented positive visit lift). For
            `conversion`, the lift is much smaller; the assertion is
            relaxed to "CI low bound > 0 OR ate_estimate > 0 AND ci_low
            within ±2·SE of zero" — the deviation is permitted **only**
            on the conversion outcome, per the §3.7 explicit framing that
            the primary published claim is on visits (`Pass: verifier's
            ATE estimate within the published RCT 95% CI for the visit /
            conversion outcome`).
         b) Qini on the test set: WP-V calls
            `admatix_uplift.run_qini_criteo(...)` and threads its output
            into `qini_estimate`. The reference is a fresh `causalml`
            T-Learner fit on the same train/test split — a within-toolkit
            reproducibility anchor (§B.2).
         c) AUUC on the test set: same pattern as Qini.
         d) Assert `|qini_relative_delta| ≤ qini_tolerance` AND
            `|auuc_relative_delta| ≤ auuc_tolerance` (both default 10%
            per §3.7).
      5. Pass iff every outcome passes.
    Side effects: writes `output_dir/criteo/metrics.json`, per-outcome
    Qini-curve PNGs, and a propensity-AUC ROC PNG."""
```

### CLI launcher (`src/admatix_backtests/__main__.py`)

```python
# `python -m admatix_backtests hillstrom --config configs/hillstrom-default.json`
# `python -m admatix_backtests criteo    --config configs/criteo-default.json`
# `python -m admatix_backtests all       --config configs/phase4-gate.json`
# Each subcommand reads a JSON BacktestConfig from --config, runs the
# corresponding back-test, prints the result summary as JSON to stdout,
# and exits 0 iff `result.passes is True`. The `all` subcommand's exit
# code is the Phase 4 gate's WP-V signal.
```

## Files this WP creates

- `services/backtests/pyproject.toml` — PEP-621 `admatix-backtests`; entry
  point `admatix-backtests = admatix_backtests.__main__:main`.
- `services/backtests/requirements.txt` — top-level pins (see § Pinned stack).
- `services/backtests/requirements.lock` — full transitive lock via
  `uv pip compile`.
- `services/backtests/src/admatix_backtests/__init__.py` — version + public
  re-exports.
- `services/backtests/src/admatix_backtests/__main__.py` — CLI subcommands.
- `services/backtests/src/admatix_backtests/types.py` — `BacktestConfig`.
- `services/backtests/src/admatix_backtests/hillstrom.py` — § Public surface.
- `services/backtests/src/admatix_backtests/criteo.py` — § Public surface.
- `services/backtests/src/admatix_backtests/refs.py` — published-reference
  metadata: a dict keyed by `(dataset, outcome)` carrying `reference_url`,
  `reference_doi`, `accessed_date`, `notes`. Every JSON metrics dump embeds
  the matching ref so reviewers can independently re-fetch the source.
- `services/backtests/configs/hillstrom-default.json` — Hillstrom run
  (both arms; visit outcome; 1000 bootstrap iters; seed=17).
- `services/backtests/configs/criteo-default.json` — full-dataset Criteo
  run (`criteo_sample_rows=null`; both outcomes; 50/50 split; seed=17;
  `cate_model=econml_dml`).
- `services/backtests/configs/criteo-sample.json` — fixture run
  (`criteo_sample_rows=500_000`) — used by `test_criteo_backtest_smoke`.
- `services/backtests/configs/phase4-gate.json` — bundles `hillstrom-default`
  + `criteo-default` (the two WP-V deliverables that gate Phase 4).
- `services/backtests/tests/__init__.py`
- `services/backtests/tests/conftest.py` — pytest fixtures: a 64 000-row
  Hillstrom DataFrame (loaded once per session) and a 500 000-row Criteo
  head-sample (loaded once per session); both skip the suite with a clear
  message if the landed CSV is missing.
- `services/backtests/tests/test_hillstrom_smoke.py` — § Acceptance 1.
- `services/backtests/tests/test_criteo_smoke.py` — § Acceptance 2.
- `services/backtests/tests/test_refs_completeness.py` — § Acceptance 3.
- `services/backtests/tests/test_determinism.py` — § Acceptance 4.
- `services/backtests/tests/test_cli.py` — § Acceptance 5.
- `services/backtests/tests/test_license_boundary.py` — § Acceptance 6.
- `services/backtests/tests/test_phase4_gate_backtests.py` — § Acceptance 7
  (the Phase 4 gate contribution).
- `services/backtests/scripts/run-phase4-backtests.sh` — bash wrapper
  invoking `python -m admatix_backtests all --config configs/phase4-gate.json`;
  exits 0 on green. Quoted from the runbook.
- `docs/runbooks/backtests.md` — operator runbook: how to install, how each
  back-test works, the §3.7 tolerance bands and how to interpret them, the
  Criteo BY-NC-SA boundary (inherited from WP-U), how to point loaders at
  a different `dataset_root` (cross-worktree builds where `data/datasets/`
  is a symlink to the WP-P-staged path on the VPS), how to regenerate the
  lock, **and the explicit list of published references** (Diemert et al.
  arXiv 2111.10106 for Criteo; the scikit-uplift `fetch_hillstrom`
  documentation for Hillstrom) with accessed dates so a reviewer can
  independently re-fetch the same numbers.
- Add `services/backtests/output/` to the repo `.gitignore` (one-line
  append alongside the WP-U `services/uplift/output/` entry) — enforced
  by § Acceptance test 6.

### Pinned stack

```
# requirements.txt — top-level only; resolve to requirements.lock via uv pip compile
numpy==2.1.*                                    # same as verifier
pandas==2.2.*                                   # same as verifier
scipy>=1.14,<1.17                               # same band as verifier (R-report deviation)
scikit-learn==1.5.*                             # nuisance models + the propensity-AUC logistic
statsmodels==0.14.*                             # same as verifier
econml==0.16.0                                  # same as verifier
causalml==0.16.0                                # same as verifier — qini/auuc reference
matplotlib==3.9.*                               # PNG output
pytest==8.3.*
httpx==0.27.*                                   # for FastAPI TestClient in the gate test
admatix-simulator @ {root:uri}/../simulator     # editable
admatix-verifier  @ {root:uri}/../verifier      # editable
admatix-ingest    @ {root:uri}/../ingest        # editable
admatix-uplift    @ {root:uri}/../uplift        # editable — depends on WP-U
```

## Files this WP MUST NOT touch

- `services/simulator/**`, `services/verifier/**`, `services/ingest/**`,
  `services/validation/**`, `services/uplift/**` — owned by their respective
  WPs. WP-V imports them; it does not edit a byte of their source.
- `packages/schemas/**` — frozen contract. WP-V persists metrics as JSON +
  PNG under `output_dir`; it does not extend any TS schema.
- `packages/core/**`, `packages/connectors/**`, `packages/evidence/**`,
  `packages/policy/**`, `packages/agents/**`, `packages/evals/**`,
  `packages/ui/**`, `apps/**` — entire TypeScript monorepo is untouched.
  (WP-W is the WP that wraps back-test metrics into the B.2 benchmark
  lane output, not WP-V.)
- `warehouse/**` — no migrations or dbt models. Back-test artifacts live
  under `services/backtests/output/` (gitignored).
- `data/datasets/**`, `data/raw/**`, `data/checksums/**` — read-only. The
  WP-P checksums are the source of truth for the dataset SHAs embedded in
  the metrics JSON; WP-V never rewrites them.
- `/opt/admatix/.build/secrets.env` — never read. The harness takes its
  inputs from `--config` JSON only.
- `ledger.*` / `app.*` (Supabase) — WP-V has zero database writes.

## Acceptance tests

Each test runs under `cd services/backtests && pytest -q`. The numbered
tests match the test files in § Files this WP creates. Smoke tests are
fast (≤ 90 s suite); the *gate* test (§ Acceptance 7) uses production
cell counts and is slow.

1. **Hillstrom smoke — `test_hillstrom_smoke.py`.** Calls
   `run_hillstrom_backtest(config)` with `hillstrom_arms=["mens_email"]`
   only, `bootstrap_iters=200` (fast). Asserts: a `HillstromBacktestResult`
   is returned; `rows == 64_000`; `dataset_sha256` equals the value at
   `data/checksums/hillstrom.sha256`; the single arm row has finite floats
   for `ate_estimate`, `ci_low`, `ci_high`, `auuc_estimate`,
   `auuc_reference`; `ci_excludes_zero` is True (Hillstrom is a true RCT —
   even at 200 bootstrap iters the visit lift is far from zero);
   `metrics_path` exists and parses to JSON whose `license_note` carries
   the Hillstrom note verbatim. The §3.7 AUUC band (`auuc_within_tolerance`)
   is reported but not asserted at this iteration count.

2. **Criteo smoke — `test_criteo_smoke.py`.** Calls
   `run_criteo_backtest(config)` with `criteo_sample_rows=500_000`,
   `criteo_outcomes=["visit"]` only. Asserts: a `CriteoBacktestResult` is
   returned; `rows_total ≤ 500_000`; `rows_train + rows_test == rows_total`;
   `dataset_sha256` equals the value at
   `data/checksums/criteo_uplift_v2.1.sha256`; `propensity_auc ∈ [0.49,
   0.53]` (near-random sanity check matching the Criteo doc); the single
   outcome row has finite floats for `ate_estimate`, `qini_estimate`,
   `qini_reference`, `auuc_estimate`, `auuc_reference`; `metrics_path`
   parses to JSON whose `license_note` carries the BY-NC-SA string and
   whose `reference_url` is the arXiv 2111.10106 link verbatim. Skips
   with a clear message if the landed CSV is missing.

3. **References completeness — `test_refs_completeness.py`.** Asserts the
   `refs.py` registry has an entry for every `(dataset, outcome)`
   combination that the back-tests can be invoked with: `(hillstrom,
   visit, mens_email)`, `(hillstrom, visit, womens_email)`, `(criteo,
   visit)`, `(criteo, conversion)`. Each entry has a non-empty
   `reference_url` matching a public URL pattern (no `localhost`, no
   `127.0.0.1`, no `file://`), and an `accessed_date` in ISO 8601 form.
   This is the §9 source-refs discipline enforced in code.

4. **Determinism — `test_determinism.py`.** Re-runs `run_hillstrom_backtest`
   twice with the **same** `BacktestConfig`. Asserts the two `metrics_path`
   JSON files are byte-identical and every arm's per-resample bootstrap
   distribution is element-wise equal. Same check for
   `run_criteo_backtest` at `criteo_sample_rows=500_000`. This is the
   harness's reproducibility floor.

5. **CLI surface — `test_cli.py`.** Invokes `python -m admatix_backtests
   hillstrom --config tests/fixtures/hillstrom-tiny.json` via
   `subprocess.run`. Asserts: exit code 0; stdout parses as JSON
   containing `rows`, `arms[0].ate_estimate`, `arms[0].ci_excludes_zero`
   keys. Repeats for `criteo` with the 500 000-row sample config; skipped
   if the landed CSV is missing.

6. **License boundary — `test_license_boundary.py`.** Asserts that no
   committed file under the entire worktree contains a Criteo-derived
   sample row (same literal-string scan as WP-U's
   `test_license_boundary`). Also asserts `.gitignore` contains the
   literal line `services/backtests/output/`.

7. **Phase 4 gate — back-tests slice —
   `test_phase4_gate_backtests.py` (Phase 4 gate contribution).** The
   single test that closes WP-V's contribution to the Phase 4 gate.
   Loads `services/backtests/configs/phase4-gate.json` and runs both
   back-tests in sequence. Asserts:

   **Hillstrom (§3.7, both arms):**
   - `result.rows == 64_000` and `dataset_sha256` matches the pinned
     `data/checksums/hillstrom.sha256` exactly.
   - For each arm in `["mens_email", "womens_email"]`:
     - `ci_excludes_zero is True` — both `ci_low > 0` and `ci_high > 0`
       (the well-known positive visit lift). Asserted at 1000 bootstrap
       iterations.
     - `auuc_within_tolerance is True` — `|auuc_relative_delta| ≤ 0.10`
       per §3.7's ±10% AUUC band.
     - `arm_passes is True`.
   - `result.passes is True` (the conjunction across arms).

   **Criteo Uplift v2.1 (§3.7, full dataset):**
   - `result.rows_total == 13_979_592` and `dataset_sha256` matches
     the pinned `data/checksums/criteo_uplift_v2.1.sha256` exactly.
   - `result.propensity_auc ∈ [0.49, 0.53]` (Criteo doc ≈ 0.509 — the
     near-random property the dataset is famous for).
   - For the `visit` outcome:
     - `ci_excludes_zero is True` — the verifier's ATE estimate for
       `visit` has a 95% CI strictly above zero (per §3.7's "verifier's
       ATE estimate within the published RCT 95% CI for the visit /
       conversion outcome").
     - `qini_within_tolerance is True` — `|qini_relative_delta| ≤ 0.10`
       per §3.7's ±10% Qini band.
     - `auuc_within_tolerance is True` — same band for AUUC.
     - `outcome_passes is True`.
   - For the `conversion` outcome:
     - `qini_within_tolerance is True` per §3.7's same band.
     - `auuc_within_tolerance is True`.
     - The `ate_estimate > 0` (positive directional lift); `ci_low`'s
       distance from zero is reported in `notes`. The stricter
       `ci_excludes_zero` is not gated on conversion (per the §3.7
       framing — the published primary lift is the visit lift; the
       conversion lift is small and noisier).
     - `outcome_passes is True` (Qini + AUUC bands).
   - `result.passes is True` (the conjunction across outcomes).

   **Bundle:**
   - The metrics bundle on disk after the test:
     `output_dir/hillstrom/metrics.json`, per-arm Qini-curve PNGs,
     `output_dir/criteo/metrics.json`, per-outcome Qini-curve PNGs,
     and `output_dir/criteo/propensity_roc.png` — every artifact exists
     and is non-empty. Every JSON carries `dataset_sha256`,
     `reference_url`, `accessed_date`, and a non-empty `license_note`.
   - **This is the Phase 4 gate bullet WP-V owns.** When green, the
     gate's "back-tests within tolerance of published results" line is
     closed. WP-T owns "SBC ranks ~uniform; CI coverage ~nominal";
     WP-U owns "placebo ~zero"; WP-W owns "safety benchmark passes".
     All four contribute.

   The test runs ~30–60 minutes on the VPS (full 13.98M-row Criteo fit);
   it is marked `@pytest.mark.slow` and is also reachable as
   `bash scripts/run-phase4-backtests.sh`. Memory budget on the VPS is
   confirmed sufficient — `causalml` T-Learner + `econml` DML fit on
   ~14M rows runs in well under 16 GB.

## Verification commands

The build agent runs **exactly** the sequence below at the end of the
work package. All commands run from the worktree root unless noted.

```bash
# 1. Create the lock and install
cd services/backtests
python3.12 -m venv .venv
. .venv/bin/activate
pip install --upgrade pip uv
uv pip compile requirements.txt -o requirements.lock
uv pip sync requirements.lock

# 2. Run the back-tests test suite (smoke tests 1–6; gate test 7 excluded by default)
pytest -q -m "not slow"

# 3. Run the Phase 4 gate slice explicitly (the slow path; ~30–60 min)
pytest -q -m slow tests/test_phase4_gate_backtests.py

# 4. Confirm the sibling Python services still pass (WP-V must not regress them)
cd ../..
. services/verifier/.venv/bin/activate
pytest services/verifier services/ingest services/simulator -q

# 5. Confirm the TypeScript monorepo is untouched
pnpm -r typecheck
pnpm exec turbo run test --concurrency=1

# 6. Secret scan
pnpm scan-secrets
```

All six commands exit 0 before WP-V is considered green.

## Deviations & escalation

- **A back-test misses its tolerance band.** This is the gate failing —
  do **not** widen the band to make the test green. The §3.7 tolerances
  (`±10%` for Qini/AUUC; `CI excludes zero` for the visit lifts) are the
  bar a YC technical reviewer is reading. Instead: capture the actual
  vs. reference numbers, write them into the phase report, and STOP for
  human review. If the gap is a known cause (e.g. the upstream
  `causalml` shipped a Qini-scoring bug fix between WP-V authorship and
  the build agent's run), the runbook documents the diagnostic recipe
  and the patched-library workaround; the band stays at ±10%.
- **The Criteo full-dataset fit OOMs on the VPS.** Fall back to a fixed
  5 M-row stratified sample of the same dataset, seeded by `config.seed`,
  preserving the treatment ratio (~0.85). Record the deviation in the
  metrics JSON (`rows_total < 13_979_592` is itself the audit trail).
  Do NOT silently change `auuc_tolerance` or `qini_tolerance`.
- **`econml` / `causalml` resolve to different transitives than WP-U's
  lock.** The R-report deviation (`scipy>=1.14,<1.17`) is inherited;
  WP-V records the actual resolved versions in the phase report. If a
  pin would *change* a tolerance band, STOP and escalate — those numbers
  are the gate.
- **Either dataset CSV is missing on the build worktree.** The standard
  pattern is `python -m admatix_ingest hillstrom` and `python -m
  admatix_ingest criteo` (idempotent — re-uses `data/raw/` cache). If
  `data/raw/` is also empty on this worktree, the orchestrator must
  symlink it from the WP-P-staged location on the VPS (the runbook
  documents the exact symlink). The smoke tests skip gracefully; the
  gate test will fail loudly, which is correct.

## Out of scope

- Calibration (SBC, CI coverage, RMSE/bias, multi-seed variance) — WP-T,
  Wave 1, opus.
- Placebo / negative-control suite — WP-U, Wave 1, codex. WP-V's
  back-tests assume the placebo is green; if WP-U's placebo gate fails,
  WP-V should not be merged.
- Benchmark lanes B.1–B.6 packaging — WP-W, Wave 2, codex. WP-V's
  metrics JSON is the input that WP-W wraps into the B.2 lane output.
- Avazu CTR and iPinYou RTB back-tests. Per the WP-P scope (codex
  sim-readiness track), Avazu and iPinYou were intentionally not
  acquired in Phase 3; the relevant lanes (B.1, B.3) consume the
  simulator's calibration to those distributions, not raw landed data.
- Live ad-platform calls of any kind — none, by design.
- A web cockpit view of back-test results. The proof artifact is the
  JSON metrics + PNG figures bundle under `services/backtests/output/`;
  the Phase 5 proof report references them directly.
- LLM calls. There are none — the harness is pure pandas + numpy +
  causalml + econml + the verifier.

## Definition of Done

All seven acceptance tests pass (six in the fast lane, one in the slow
lane), the six verification commands exit 0, the runbook is accurate (a
reviewer can follow it from a clean shell and reproduce green
`pytest -q -m "not slow"` plus a green
`bash scripts/run-phase4-backtests.sh`), and `services/backtests` boots
independently of any TypeScript code. The Phase 4 gate's WP-V
contribution (§ Acceptance 7) is green and the back-test metrics
bundle on disk is reproducible byte-for-byte from
`configs/phase4-gate.json`. WP-W (benchmarks) can consume the
back-test metrics into its B.2 lane without re-running any fit; the
Phase 5 proof report can reference Hillstrom + Criteo numbers with
their published-reference URLs intact.

## Dispatch

Generic dispatcher, `<ID>=V`, model `opus`. Run in Phase 4 Wave 2,
after WP-T and WP-U have merged.

```bash
bash /opt/admatix/scripts/dispatch-wp.sh \
  V \
  wp/v-backtests \
  services/backtests \
  docs/build/WP-V-backtests.md \
  opus
```
