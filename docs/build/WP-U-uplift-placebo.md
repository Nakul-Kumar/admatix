# WP-U — Uplift (Qini / AUUC) on simulator + Criteo, plus placebo / negative-control suite (`services/uplift`)

**Owns:** `services/uplift/**`, `docs/runbooks/uplift-and-placebo.md`
**Branch:** `wp/u-uplift-placebo` · **Phase:** 4 · **Wave:** 1
**Depends on:** `services/simulator` (WP-Q), `services/verifier` (WP-R), and
  `services/ingest` (WP-P) — all merged on `main`. Hillstrom (64 000 rows) and
  Criteo Uplift v2.1 (13 979 592 rows) are already landed on the VPS by WP-P,
  with `data/checksums/{hillstrom,criteo_uplift_v2.1}.{sha256,manifest.json}`
  pinned.
**Suggested agent:** Codex 5.5 · **Size:** large

## Why this exists

WP-T proves the verifier is **calibrated** on the simulator. WP-U proves two
adjacent things, both pre-condition for "this engine recovers truth":

1. **The uplift ranking is competent** — Qini coefficient and AUUC on
   heterogeneous-lift simulator worlds (`SIMULATION-VERIFICATION.md` §3.4) and
   on Criteo Uplift v2.1 (where the published Qini is the reference target
   WP-V will hit with tolerance — WP-U gets the harness in place and runs it
   end-to-end, but does **not** assert the cross-paper tolerance band; that
   is WP-V's job).
2. **The verifier does not manufacture lift** — the placebo / negative-control
   suite per §3.5: zero-lift worlds round-tripped through the full
   `/verify` pipeline, with the mean estimate inside the tolerance band and
   the false-positive rate ≤ 0.05.

The Phase 4 master-plan bullet WP-U owns is **"placebo ~zero."** It is the
single most important honesty test in the system: a verifier that systematically
finds lift where there is none cannot ship. The last acceptance test in this
WP (§ Acceptance test 8) is that gate bullet.

WP-U is Wave 1 alongside WP-T because both can start from `main` without
waiting on each other — they share `services/simulator` + `services/verifier`
as Python imports but write to disjoint folders.

## Required reading (in this order)

1. `docs/architecture/PROOF-WAVE-MASTER-PLAN.md` §2 — the eight-item
   research-grade bar (§3.4 Qini + AUUC, §3.5 placebo are the two items
   WP-U covers), §6.3 the validation harness mandate, §6.4 the datasets
   table (Hillstrom = permissively-licensed safe default, Criteo Uplift v2.1
   = BY-NC-SA non-commercial, R&D / benchmark use only).
2. `docs/architecture/SIMULATION-VERIFICATION.md` §3.4 (Qini / AUUC pass:
   `Qini ≥ 0.5 · oracle_Qini` on heterogeneous-lift simulator worlds, with
   `causalml.metrics` as the reference scorer), §3.5 (placebo pass: mean
   estimate within `[-0.05·baseline_cr, +0.05·baseline_cr]`; false-positive
   rate ≤ 0.05 at α = 0.05; "any systematic non-zero effect on placebos is
   release-blocking"), §1.3 (the four world types — `clean_ab`,
   `geo_structured`, `confounded`, `zero_lift_placebo`), §2.3 (the CATE
   meta-learner method that produces Qini), §4 (the pinned Python stack —
   `causalml==0.16.0` is already in the verifier's lock; this WP reuses it).
3. `docs/architecture/ARCHITECTURE-DEEP.md` §9 — the causal-lift discipline.
   Every Qini number WP-U publishes ships with its dataset, train/test split
   hash, RNG seed, and CATE model identifier. Placebos are reported even when
   they pass — restraint is the deliverable.
4. `docs/build/AUTONOMOUS-WAVE-PLAN.md` Phase 4 row + gate — the four-WP
   split and the gate bullets WP-U vs. WP-V vs. WP-W contribute to.
5. `docs/build/DATASETS.md` §1 (Criteo Uplift Prediction v2.1 — 13 979 592
   rows; canonical 16-column schema `f0..f11, treatment, conversion, visit,
   exposure`; **CC BY-NC-SA 4.0 — non-commercial, internal R&D only**; URL
   `http://go.criteo.net/criteo-research-uplift-v2.1.csv.gz`) and §3
   (Hillstrom — 64 000 rows; `segment ∈ {Mens E-Mail, Womens E-Mail,
   No E-Mail}`, outcomes `visit, conversion, spend`; public-challenge
   dataset, attribution recommended). The license boundary is enforced in
   code: WP-U writes the Criteo runs only under `services/uplift/output/`
   (gitignored) and never embeds raw Criteo rows in any committed artifact
   or test fixture.
6. `docs/build/TESTING-AND-COMPARISON.md` §B.2 — the Qini/AUUC lane WP-U's
   results feed into. WP-W is the WP that *packages* that lane for the
   benchmark report; WP-U owns the underlying numbers.
7. `docs/build/WP-T-validation.md` — the sister calibration harness. WP-U
   uses the same `services/simulator` import surface and the same in-process
   verifier-method dispatch (no HTTP hop in the batch path). WP-U does
   **not** depend on `services/validation` — the two harnesses publish
   disjoint metrics bundles consumed jointly by the Phase 5 proof report.
8. `docs/build/WP-R-verifier.md` + `docs/phase-reports/R-report.md` — what
   the verifier ships today: `methods.cate.run(req, events)` returns a
   `MethodResult` whose `diagnostics["qini"]` is the Qini coefficient via
   `causalml.metrics`. The placebo test calls the full `/verify` pipeline
   via the `TestClient` pattern WP-R already wired (`tests/test_placebo_zero.py`
   is the existing seed for §3.5 at small `n`; WP-U widens it to the
   population-mean tolerance at large `n` and reports the false-positive rate
   over a full seed grid).
9. `services/simulator/src/admatix_simulator/__init__.py` — the
   `SimulationConfig(world_type=WorldType.ZERO_LIFT_PLACEBO, ...)` path and
   the `ground_truth.ate / tau` columns the placebo asserts against.
10. `services/ingest/src/admatix_ingest/__init__.py` — `acquire_by_name(...)`
    is the one entry point WP-U uses to materialise Hillstrom and Criteo
    Uplift; it is idempotent (re-uses `data/raw/` cache, re-validates
    schema, re-writes the manifest) so WP-U's tests are hermetic.
11. `AGENTS.md` — golden rules 4 (every claim carries source refs), 8
    (determinism — same seeds + same code → byte-identical metrics tables),
    9 (no secrets committed; the Criteo BY-NC-SA boundary is enforced by
    git-ignoring `services/uplift/output/` and by *never* committing
    Criteo-derived sample rows).

## Public surface

The build agent implements **exactly** the signatures below. The batch path
calls the verifier in-process; the placebo gate test additionally exercises
the FastAPI surface via TestClient (proving the HTTP round-trip is not a
silent fault).

### Top-level package (`services/uplift/src/admatix_uplift/__init__.py`)

```python
__version__ = "0.1.0"
__all__ = [
    "run_qini_simulator", "QiniSimulatorResult",
    "run_qini_criteo",    "QiniCriteoResult",
    "run_placebo_suite",  "PlaceboResult",
    "load_criteo_uplift", "load_hillstrom",
    "UpliftConfig",
]
```

### Shared types (`src/admatix_uplift/types.py`)

```python
@dataclass(frozen=True)
class UpliftConfig:
    """Outer config for one harness run. Persisted alongside every result."""
    output_dir: Path            # absolute path; the harness writes JSON+PNG here
    seeds: list[int]            # explicit seed grid (no hidden RNG)
    world_grid: list[dict] = field(default_factory=list)   # SimulationConfig kwargs
    criteo_sample_rows: int | None = None      # None = full 13.98M; int = head sample
    train_test_split: float = 0.5              # for the Criteo lane
    cate_model: Literal["econml_dml", "causalml_t_learner",
                        "causalml_x_learner"] = "econml_dml"
    ci_level: float = 0.95
```

### Qini / AUUC on the simulator (`src/admatix_uplift/qini_simulator.py`)

```python
@dataclass(frozen=True)
class QiniSimulatorResult:
    n_worlds: int
    seeds: list[int]
    per_world: list[dict]             # one row per world: seed, world_id, qini, oracle_qini, auuc
    qini_ratios: list[float]          # qini / oracle_qini per world
    median_qini_ratio: float
    pass_threshold: float = 0.5       # §3.4 — qini ≥ 0.5·oracle on the median world
    passes: bool                      # median_qini_ratio ≥ pass_threshold
    qini_curve_paths: list[Path]      # one PNG per world (caller selects which to ship)
    metrics_path: Path

def run_qini_simulator(config: UpliftConfig) -> QiniSimulatorResult:
    """Score the verifier's CATE uplift ranking on heterogeneous-lift simulator
    worlds. For each (config × seed) cell:
      1. Materialise a `clean_ab` or `confounded` world with
         `true_lift > 0` and non-trivial heterogeneity (default
         `true_lift=0.04`, `n_users=2000`, `noise_sd=0.0`).
      2. Build a VerifyRequest with hint.design="clean_ab" so the selector
         picks `cate_meta_learner`.
      3. Call `admatix_verifier.methods.cate.run(req, events_df)` and
         extract per-user CATE predictions.
      4. Compute the **oracle** Qini using the simulator's recorded
         per-user `tau` column (ground truth — never exposed to the verifier)
         and the **estimated** Qini from the CATE predictions via
         `causalml.metrics.qini_score`.
      5. Record qini_ratio = est_qini / oracle_qini per world.
    Passes iff `median(qini_ratio) ≥ 0.5` per §3.4. The harness errors out
    if `n_worlds < 20` — the median ratio is uninformative below that."""
```

### Qini / AUUC on Criteo Uplift v2.1 (`src/admatix_uplift/qini_criteo.py`)

```python
@dataclass(frozen=True)
class QiniCriteoResult:
    rows_total: int                           # rows actually loaded (≤ 13_979_592)
    rows_train: int
    rows_test: int
    qini_visit: float                         # outcome=visit
    auuc_visit: float
    qini_conversion: float                    # outcome=conversion
    auuc_conversion: float
    cate_model: str                           # echoes UpliftConfig.cate_model
    qini_curve_visit_path: Path               # PNG
    qini_curve_conversion_path: Path
    metrics_path: Path
    license_note: str = (                     # echoed into the JSON for every consumer
        "Criteo Uplift v2.1 is CC BY-NC-SA 4.0 — internal R&D use only; "
        "non-commercial; share-alike; attribution to Diemert et al. AdKDD 2018."
    )

def run_qini_criteo(config: UpliftConfig) -> QiniCriteoResult:
    """Load Criteo Uplift v2.1 from the WP-P-landed
    `data/datasets/criteo_uplift_v2.1/criteo-uplift-v2.1.csv` (path resolved
    via `load_criteo_uplift`), train/test-split deterministically by
    `config.train_test_split` and `config.seeds[0]`, fit the chosen
    `cate_model` on (f0..f11, treatment) → visit and → conversion, score
    Qini + AUUC on the held-out test set via `causalml.metrics`. Writes the
    metrics JSON + two curve PNGs under `config.output_dir/criteo/`.

    Does **not** assert a cross-paper tolerance band — WP-V owns that.
    WP-U's job is to make the numbers exist, reproducibly, on the staged
    dataset, with the license note carried into every output artifact."""
```

### Placebo / negative-control suite (`src/admatix_uplift/placebo.py`)

```python
@dataclass(frozen=True)
class PlaceboResult:
    n_worlds: int                              # ≥ 100 for the gate test
    seeds: list[int]
    baseline_cr: float                         # the §3.5 tolerance is in units of baseline_cr
    estimates: list[float]                     # one per world (signed)
    mean_estimate: float
    mean_abs_estimate: float
    tolerance: float                           # 0.05 · baseline_cr (§3.5)
    passes_mean_tolerance: bool                # |mean_estimate| ≤ tolerance
    n_lift_detected: int                       # count of worlds wrongly verdict-ed lift_detected
    false_positive_rate: float                 # n_lift_detected / n_worlds
    fpr_threshold: float = 0.05                # §3.5 — ≤ 0.05 at α = 0.05
    passes_fpr: bool                           # false_positive_rate ≤ 0.05
    passes: bool                               # passes_mean_tolerance AND passes_fpr
    per_world: list[dict]                      # for the JSON dump and curve PNG
    runs_path: Path                            # JSONL of full /verify responses
    metrics_path: Path
    distribution_plot_path: Path               # PNG: histogram of estimates around 0

def run_placebo_suite(config: UpliftConfig) -> PlaceboResult:
    """For each (config × seed) cell in `world_grid` where world_type is
    `zero_lift_placebo`:
      1. Materialise the world via `services.simulator.generate_world`.
      2. Build a VerifyRequest pointing at the world's events.csv and
         metadata.json.
      3. Call the full `/verify` pipeline via the FastAPI TestClient
         (NOT just the method — the placebo gate must catch a regression
         introduced in the API layer too).
      4. Record the estimate, the verdict, and the diagnostics.
    Passes iff §3.5 both:
      - mean_estimate ∈ [-0.05·baseline_cr, +0.05·baseline_cr], AND
      - false_positive_rate ≤ 0.05.
    Per §3.5, "any systematic non-zero effect on placebos is
    release-blocking" — the harness must surface both criteria, not just
    one."""
```

### Loaders (`src/admatix_uplift/loaders.py`)

```python
def load_hillstrom(
    *,
    dataset_root: Path = Path("data/datasets"),
    raw_root: Path = Path("data/raw"),
    checksum_root: Path = Path("data/checksums"),
) -> pd.DataFrame:
    """Idempotent — calls `admatix_ingest.acquire_by_name('hillstrom', ...)`
    if the landed CSV is missing or stale, then reads it into a pandas
    DataFrame typed per the WP-P schema (12 columns; `segment` mapped to
    `treatment ∈ {0, 1, 2}` where 0 = `No E-Mail`)."""

def load_criteo_uplift(
    *,
    nrows: int | None = None,
    dataset_root: Path = Path("data/datasets"),
    raw_root: Path = Path("data/raw"),
    checksum_root: Path = Path("data/checksums"),
) -> pd.DataFrame:
    """Idempotent loader for Criteo Uplift v2.1. Same pattern as
    `load_hillstrom`. `nrows=None` reads the full 13_979_592 rows; an
    integer reads `head(nrows)` for fixture-grade runs. The returned
    DataFrame is typed per the WP-P 16-column schema."""
```

### CLI launcher (`src/admatix_uplift/__main__.py`)

```python
# `python -m admatix_uplift qini-sim    --config configs/qini-simulator.json`
# `python -m admatix_uplift qini-criteo --config configs/qini-criteo.json`
# `python -m admatix_uplift placebo     --config configs/placebo-default.json`
# `python -m admatix_uplift all         --config configs/phase4-gate.json`
# Each subcommand reads a JSON UpliftConfig from --config, runs the
# corresponding harness, prints the result summary as JSON to stdout, and
# exits 0 iff the harness's pass flag is True. The `placebo` subcommand's
# exit code is the Phase 4 gate's WP-U signal.
```

## Files this WP creates

- `services/uplift/pyproject.toml` — PEP-621 `admatix-uplift`; entry point
  `admatix-uplift = admatix_uplift.__main__:main`.
- `services/uplift/requirements.txt` — top-level pins (see § Pinned stack).
- `services/uplift/requirements.lock` — full transitive lock via `uv pip compile`.
- `services/uplift/src/admatix_uplift/__init__.py` — version + public
  re-exports.
- `services/uplift/src/admatix_uplift/__main__.py` — CLI subcommands.
- `services/uplift/src/admatix_uplift/types.py` — `UpliftConfig`.
- `services/uplift/src/admatix_uplift/qini_simulator.py` — § Public surface.
- `services/uplift/src/admatix_uplift/qini_criteo.py` — § Public surface.
- `services/uplift/src/admatix_uplift/placebo.py` — § Public surface.
- `services/uplift/src/admatix_uplift/loaders.py` — § Public surface.
- `services/uplift/src/admatix_uplift/grids.py` — helpers to enumerate
  `(world_grid × seeds)` and turn a `SimulatedWorld` into a `VerifyRequest`
  (mirrors WP-T's `grids.py` — kept disjoint per ownership rules).
- `services/uplift/configs/qini-simulator.json` — 30-world default
  (`clean_ab`, `n_users=4000`, `true_lift=0.04`, `noise_sd=0.0`, 30 seeds).
- `services/uplift/configs/qini-criteo.json` — full-dataset Criteo run
  (`criteo_sample_rows=null`, `train_test_split=0.5`, `cate_model=econml_dml`).
- `services/uplift/configs/qini-criteo-sample.json` — fixture run
  (`criteo_sample_rows=200_000`) — used by `test_qini_criteo_smoke`.
- `services/uplift/configs/placebo-default.json` — fixture-grade placebo
  config (10 worlds at `n_users=4000`).
- `services/uplift/configs/placebo-gate.json` — the Phase 4 gate placebo
  config: 100 zero-lift-placebo worlds at `baseline_cr=0.03,
  n_users=10_000, noise_sd=0.0, seeds=range(2000, 2100)`. WP-R's
  `test_placebo_zero.py` already validates the small-n case; the gate
  config widens to the population-mean tolerance.
- `services/uplift/configs/phase4-gate.json` — bundles `qini-simulator` +
  `placebo-gate` (the two WP-U deliverables that gate Phase 4).
- `services/uplift/tests/__init__.py`
- `services/uplift/tests/conftest.py` — pytest fixtures: a `clean_ab`
  world and a `zero_lift_placebo` world materialised under `tmp_path` via
  `admatix_simulator.generate_world` (pinned seeds, `n_users=2000`,
  `noise_sd=0.0`).
- `services/uplift/tests/test_qini_simulator_smoke.py` — § Acceptance 1.
- `services/uplift/tests/test_qini_criteo_smoke.py` — § Acceptance 2.
- `services/uplift/tests/test_placebo_smoke.py` — § Acceptance 3.
- `services/uplift/tests/test_loaders.py` — § Acceptance 4.
- `services/uplift/tests/test_determinism.py` — § Acceptance 5.
- `services/uplift/tests/test_cli.py` — § Acceptance 6.
- `services/uplift/tests/test_license_boundary.py` — § Acceptance 7.
- `services/uplift/tests/test_phase4_gate_placebo.py` — § Acceptance 8
  (the Phase 4 gate contribution).
- `services/uplift/scripts/run-phase4-placebo.sh` — bash wrapper invoking
  `python -m admatix_uplift placebo --config configs/placebo-gate.json`;
  exits 0 on green. Quoted from the runbook.
- `docs/runbooks/uplift-and-placebo.md` — operator runbook: how to install,
  how each lane works, what each output JSON / PNG means, the §3.4 / §3.5
  gate bands and how to interpret them, the Criteo BY-NC-SA boundary (no
  raw rows in committed artifacts), how to point the loaders at a different
  `dataset_root` (for cross-worktree builds where `data/datasets/` is a
  symlink to the WP-P-staged path on the VPS), and how to regenerate the
  lock.
- Add `services/uplift/output/` to the repo `.gitignore` (one-line append,
  alongside the existing `data/datasets/`, `data/raw/`, `data/.cache/`
  entries) — required by § Acceptance test 7.

### Pinned stack

```
# requirements.txt — top-level only; resolve to requirements.lock via uv pip compile
numpy==2.1.*                                    # same as verifier
pandas==2.2.*                                   # same as verifier
scipy>=1.14,<1.17                               # same band as verifier (R-report deviation)
scikit-learn==1.5.*                             # nuisance models for econml DML
statsmodels==0.14.*                             # same as verifier
econml==0.16.0                                  # same as verifier — DML CATE
causalml==0.16.0                                # same as verifier — qini_score, auuc_score
matplotlib==3.9.*                               # PNG output for Qini / distribution plots
pytest==8.3.*
httpx==0.27.*                                   # for FastAPI TestClient in placebo gate
admatix-simulator @ {root:uri}/../simulator     # editable install of the sibling
admatix-verifier  @ {root:uri}/../verifier      # editable install of the sibling
admatix-ingest    @ {root:uri}/../ingest        # editable install of the sibling
```

## Files this WP MUST NOT touch

- `services/simulator/**`, `services/verifier/**`, `services/ingest/**` —
  owned by WP-Q / WP-R / WP-P. WP-U imports them; it does not edit a byte
  of their source.
- `services/validation/**` — owned by WP-T. WP-U publishes its metrics
  bundle under `services/uplift/output/`, never under
  `services/validation/output/`.
- `packages/schemas/**` — frozen contract. WP-U persists metrics as JSON
  + PNG under `output_dir`; it does not extend any TS schema.
- `packages/core/**`, `packages/connectors/**`, `packages/evidence/**`,
  `packages/policy/**`, `packages/agents/**`, `packages/evals/**`,
  `packages/ui/**`, `apps/**` — entire TypeScript monorepo is untouched.
  (WP-W is the WP that wires Qini/AUUC into `packages/evals` benchmark
  output, not WP-U.)
- `warehouse/**` — no migrations or dbt models. Uplift / placebo
  artifacts live under `services/uplift/output/` (gitignored).
- `data/datasets/**`, `data/raw/**`, `data/checksums/**` — read-only.
  WP-U calls `admatix_ingest.acquire_by_name(...)` which writes there
  idempotently; WP-U itself does not author files in those directories.
  The Criteo + Hillstrom files were landed by WP-P and are pinned by the
  existing checksums; WP-U must not author or rewrite the checksum files.
- `/opt/admatix/.build/secrets.env` — never read. The harness takes its
  inputs from `--config` JSON only. No live ad-platform credentials are
  required (the proof wave is simulator + public data only).
- `ledger.*` / `app.*` (Supabase) — WP-U has zero database writes.

## Acceptance tests

Each test runs under `cd services/uplift && pytest -q`. The numbered tests
match the test files in § Files this WP creates. Cell counts in the
*smoke* tests are deliberately small (≤ 60 s suite); the *gate* test
(§ Acceptance 8) uses production cell counts.

1. **Qini on simulator smoke — `test_qini_simulator_smoke.py`.** Calls
   `run_qini_simulator(config)` with 5 worlds (`clean_ab`, `n_users=2000`,
   `true_lift=0.04`, `noise_sd=0.0`, 5 seeds). Asserts: a
   `QiniSimulatorResult` is returned; `result.n_worlds == 5`;
   `len(result.qini_ratios) == 5`; each ratio is a finite float;
   `result.metrics_path` parses to JSON equal to the dataclass; the per-world
   Qini curve PNGs exist and are non-empty. The §3.4 gate (`passes`) is
   reported but not asserted at this cell count.

2. **Qini on Criteo smoke — `test_qini_criteo_smoke.py`.** Calls
   `run_qini_criteo(config)` with `criteo_sample_rows=200_000` (a
   `head(200_000)` slice of the landed CSV; ~0.1 s to read, ~30 s to fit).
   Asserts: a `QiniCriteoResult` is returned; `rows_total ≤ 200_000`;
   `rows_train + rows_test == rows_total`; `qini_visit` and
   `qini_conversion` are finite floats; both curve PNGs exist and are
   non-empty; `result.metrics_path` parses to JSON whose `license_note`
   carries the BY-NC-SA string verbatim.
   Skips with a clear message if the landed CSV is missing —
   `pytest.skip("Criteo Uplift v2.1 CSV not staged at <path>; run "
   "`python -m admatix_ingest criteo` first")`. This makes WP-U's test
   suite hermetic on a clean worktree while keeping the gate test honest.

3. **Placebo smoke — `test_placebo_smoke.py`.** Calls `run_placebo_suite`
   with 10 zero-lift worlds (`baseline_cr=0.03`, `n_users=4000`, 10
   seeds). Asserts: a `PlaceboResult` is returned; `n_worlds == 10`;
   `len(estimates) == 10`; `tolerance == 0.05 * 0.03 == 0.0015`;
   `false_positive_rate ∈ [0.0, 1.0]`; `runs_path` is a JSONL with 10
   lines, each a full /verify response shape; `distribution_plot_path`
   exists and is a non-empty PNG. The §3.5 gate (`passes`) is reported
   but not asserted at this cell count.

4. **Loaders — `test_loaders.py`.** Asserts:
   - `load_hillstrom()` returns a DataFrame with 64 000 rows and the
     12 WP-P columns; `segment` maps to `treatment ∈ {0, 1, 2}` with
     `0` = `No E-Mail`.
   - `load_criteo_uplift(nrows=10_000)` returns a DataFrame with
     ≤ 10 000 rows and the 16 WP-P columns; the first row's
     `treatment ∈ {0, 1}` and `conversion ∈ {0, 1}`.
   - Both loaders are idempotent — calling twice returns equal DataFrames
     and does not re-download.
   - Both loaders skip with a clear message if the landed CSV is missing
     (same pattern as test 2).

5. **Determinism — `test_determinism.py`.** Re-runs `run_qini_simulator`
   twice with the **same** `UpliftConfig`. Asserts the two `metrics_path`
   JSON files are byte-identical and the two per-world ratio lists are
   element-wise equal. Same check for `run_placebo_suite`. This is the
   harness's reproducibility floor (PROOF-WAVE-MASTER-PLAN §2 +
   AGENTS.md rule 8).

6. **CLI surface — `test_cli.py`.** Invokes `python -m admatix_uplift
   placebo --config tests/fixtures/placebo-tiny.json` via
   `subprocess.run`. Asserts: exit code 0; stdout parses as JSON
   containing `n_worlds`, `mean_estimate`, `false_positive_rate`, and
   `metrics_path` keys. Repeats for `qini-sim` with a 5-world tiny
   config. `qini-criteo` is invoked with the 200 000-row sample config
   and is skipped if the landed CSV is missing.

7. **License boundary — `test_license_boundary.py`.** Asserts that no
   committed file under the entire worktree contains a Criteo-derived
   sample row (literal-string scan for any line containing all three of
   `treatment`, `conversion`, `visit`, `exposure` as comma-separated tokens
   AND any of the 16 column names from `data/checksums/criteo_uplift_v2.1.manifest.json`).
   Also asserts `.gitignore` contains the literal line `services/uplift/output/`.
   This is the §6.4 license boundary enforced in code, not in prose.

8. **Phase 4 gate — placebo slice — `test_phase4_gate_placebo.py`
   (Phase 4 gate contribution).** The single test that closes WP-U's
   contribution to the Phase 4 gate. Loads
   `services/uplift/configs/placebo-gate.json` (100 zero-lift-placebo
   worlds at `baseline_cr=0.03, n_users=10_000, noise_sd=0.0,
   seeds=range(2000, 2100)`) and calls `run_placebo_suite`. Asserts:
   - `result.n_worlds == 100`.
   - `result.tolerance == 0.05 * 0.03 == 0.0015`.
   - `result.passes_mean_tolerance is True` — `|mean_estimate| ≤ 0.0015`
     per §3.5.
   - `result.false_positive_rate ≤ 0.05` and `result.passes_fpr is True`
     per §3.5.
   - `result.passes is True` (the conjunction).
   - The metrics bundle (`output_dir/placebo/metrics.json`,
     `output_dir/placebo/runs.jsonl` (100 lines),
     `output_dir/placebo/distribution.png`) exists and is non-empty
     on disk after the test.
   - `result.runs_path` JSONL contains zero rows with
     `verdict == "lift_detected"` AND `|estimate| > 0.0015` — i.e.,
     no world simultaneously triggered a false-positive verdict AND
     blew through the tolerance (a redundant honesty check).
   - **This is the Phase 4 gate bullet WP-U owns.** When green, the
     gate's "placebo ~zero" line is closed. WP-T owns "SBC ranks ~uniform;
     CI coverage ~nominal"; WP-V owns "back-tests within tolerance";
     WP-W owns "safety benchmark passes". All four contribute.

   The test runs ~5 minutes on the VPS; it is marked
   `@pytest.mark.slow` and is also reachable as
   `bash scripts/run-phase4-placebo.sh`.

## Verification commands

The build agent runs **exactly** the sequence below at the end of the work
package. All commands run from the worktree root unless noted.

```bash
# 1. Create the lock and install
cd services/uplift
python3.12 -m venv .venv
. .venv/bin/activate
pip install --upgrade pip uv
uv pip compile requirements.txt -o requirements.lock
uv pip sync requirements.lock

# 2. Run the uplift test suite (smoke tests 1–7; gate test 8 excluded by default)
pytest -q -m "not slow"

# 3. Run the Phase 4 gate slice explicitly (the slow path; ~5 min)
pytest -q -m slow tests/test_phase4_gate_placebo.py

# 4. Confirm the sibling Python services still pass (WP-U must not regress them)
cd ../..
. services/verifier/.venv/bin/activate
pytest services/verifier services/ingest services/simulator -q

# 5. Confirm the TypeScript monorepo is untouched
pnpm -r typecheck
pnpm exec turbo run test --concurrency=1

# 6. Secret scan
pnpm scan-secrets
```

All six commands exit 0 before WP-U is considered green.

## Deviations & escalation

- **`econml`/`causalml` install fails on this lock.** The verifier's lock
  (R-report deviation #1) widens `scipy` to `>=1.14,<1.17` for
  `causalml==0.16.0`. WP-U inherits that band. If a transitive pin breaks,
  the build agent records the actual resolved versions in the phase report
  (precedent: WP-R) and re-asserts the smoke tests are green on the new
  lock. If a deviation would *change* a §3.4 or §3.5 threshold (lower the
  Qini median bar, widen the placebo tolerance, raise the FPR ceiling),
  STOP and escalate — those numbers are the gate.
- **Criteo or Hillstrom CSV missing on the build worktree.** The standard
  pattern is `python -m admatix_ingest criteo` and `python -m admatix_ingest
  hillstrom` (idempotent — re-uses `data/raw/` cache). If `data/raw/` itself
  is also empty on this worktree, the orchestrator must symlink it from
  the WP-P-staged location on the VPS (the runbook documents the exact
  symlink). The smoke tests skip gracefully; the gate test will fail loudly,
  which is correct — the gate cannot be green without the datasets.
- **The `tests/test_phase4_gate_placebo.py` runs >10 minutes.** If the gate
  test exceeds 10 minutes on the VPS, lower `n_users` to 5 000 in
  `placebo-gate.json` and keep `n_worlds=100`. Do NOT lower `n_worlds`
  below 100 — the §3.5 false-positive-rate test is uninformative at
  smaller `N`.

## Out of scope

- Calibration (SBC, CI coverage, RMSE/bias, multi-seed variance) — that
  is WP-T, Wave 1, opus, sibling.
- Back-tests against the **published** Criteo / Hillstrom incrementality
  results within tolerance — that is WP-V, Wave 2, opus. WP-U produces
  the Criteo Qini number; WP-V asserts it sits inside the published
  reference's ±10% band.
- B.1–B.6 benchmark lanes packaging — that is WP-W, Wave 2, codex. WP-U
  feeds B.2 (uplift/incrementality) with the underlying Qini numbers;
  WP-W wraps them with the benchmark schema and writes
  `data/benchmarks/uplift-v1/`.
- Hillstrom-specific Qini at the gate level. Hillstrom is used by WP-U's
  loaders smoke test only; the Hillstrom Qini gate lives in WP-V (per
  §3.7 — "recover the well-known positive visit lift for the men's /
  women's email arms with a CI excluding zero; reproduce published AUUC
  within ±10%").
- Live ad-platform calls of any kind — none, by design.
- New TypeScript code. The uplift / placebo surface is read-only from
  the TS side; the Phase 5 proof report will reference WP-U's JSON
  metrics directly.
- A web cockpit view of placebo results. The proof artifact is the JSON
  metrics + PNG figures bundle under `services/uplift/output/`; the
  cockpit can pick them up in a later wave.
- LLM calls. There are none — the harness is pure simulator + verifier +
  causalml + econml.

## Definition of Done

All eight acceptance tests pass (seven in the fast lane, one in the slow
lane), the six verification commands exit 0, the runbook is accurate (a
reviewer can follow it from a clean shell and reproduce green
`pytest -q -m "not slow"` plus a green
`bash scripts/run-phase4-placebo.sh`), and `services/uplift` boots
independently of any TypeScript code. The Phase 4 gate's WP-U contribution
(§ Acceptance 8) is green and the placebo metrics bundle on disk is
reproducible byte-for-byte from `configs/placebo-gate.json`. WP-V
(back-tests) can now consume `run_qini_criteo` directly without further
changes to this WP; WP-W (benchmarks) can wrap WP-U's Qini metrics into
the B.2 lane without re-fitting any CATE model.

## Dispatch

Generic dispatcher, `<ID>=U`, model `codex`. Run in Phase 4 Wave 1,
alongside WP-T.

```bash
bash /opt/admatix/scripts/dispatch-wp.sh \
  U \
  wp/u-uplift-placebo \
  services/uplift \
  docs/build/WP-U-uplift-placebo.md \
  codex
```
