# WP-W — Benchmark lanes B.1–B.6 + safety benchmark (`services/benchmarks`, `data/benchmarks/*`)

**Owns:** `services/benchmarks/**`, the new suite directories under
  `data/benchmarks/{ctr-v1,uplift-v1,rtb-v1,ope-v1,agent-tasks-v1}/`,
  additions to `data/benchmarks/safety-v1/tasks/`, additions to
  `packages/evals/src/scorers/` and `packages/evals/src/baselines/` that
  wire the new suites into the existing `runSuite` harness,
  `docs/runbooks/benchmarks.md`.
**Branch:** `wp/w-benchmarks` · **Phase:** 4 · **Wave:** 2
**Depends on:** WP-T (`services/validation`) and WP-U (`services/uplift`)
  both merged on `main`. Transitively: `services/simulator` (WP-Q),
  `services/verifier` (WP-R), `services/ingest` (WP-P), the Phase 1
  `packages/evals` benchmark harness (WP-I), the existing
  `data/benchmarks/safety-v1/` (12 tasks).
**Suggested agent:** Codex 5.5 · **Size:** large

## Why this exists

Phase 1's `packages/evals` shipped the *frame* for benchmarking (one suite,
12 tasks under `safety-v1`); WP-W ships the **lanes** — the actual
public-dataset and self-authored measurements from
`TESTING-AND-COMPARISON.md` §B.1–§B.6 that the proof report cites. Each
lane has a fixed protocol, a published reference where one exists, an
explicit *claim limit*, and a per-lane pass/fail in code:

- **B.1 CTR / CVR prediction** — AUC + LogLoss on a public CTR slice;
  a "within a credible band" sanity check, not a marketing claim.
- **B.2 Uplift / incrementality** — Qini + AUUC pulled from WP-U's
  simulator runs and (when WP-V has merged) WP-V's Criteo back-test;
  reproduced inside the published ±10% band.
- **B.3 RTB / bidding** — simulator-anchored auction realism (iPinYou
  was not landed in WP-P; per §B.3, the realism is exercised through
  the campaign simulator's auction-aware mode, not against raw landed
  iPinYou logs).
- **B.4 Off-policy evaluation** — IPS/SNIPS/DR via the verifier's
  existing `methods.ope` against a logged-propensity fixture; report
  the OBP-style relative error + the propensity-overlap diagnostic.
- **B.5 Agent-workflow benchmark** — extends the existing
  `data/benchmarks/safety-v1/` task suite into a dedicated
  `agent-tasks-v1` suite with state-diff correctness, evidence
  coverage, and unsafe-write rate scored per task.
- **B.6 Policy / safety benchmark** — extends `data/benchmarks/safety-v1/`
  from 12 to **≥ 200** tasks (mix of unsafe + control), and tracks the
  three metrics from §B.6: **block rate (target ≥ 99% on
  genuinely-unsafe tasks), false-accept rate (target 0% on hard-cap
  and approval-bypass classes), false-block rate (track and keep low)**.

The Phase 4 master-plan bullet WP-W owns is **"safety benchmark passes."**
The last acceptance test in this WP (§ Acceptance test 9) is that gate
bullet: a corpus of ≥ 200 tasks, ≥ 99% block rate on the unsafe class,
0% false-accept rate on the hard-cap + approval-bypass classes.

WP-W sits in Wave 2 because:
- B.2 wraps WP-U / WP-V outputs (both Wave 1 / earlier).
- B.5 / B.6 extend the existing `packages/evals` `runSuite` surface (built
  in Phase 1, hardened in Phase 3).
- B.1 / B.3 / B.4 add Python harnesses but reuse the verifier's pinned
  Python stack.

## Required reading (in this order)

1. `docs/build/TESTING-AND-COMPARISON.md` §B.1–§B.6 — every lane's
   protocol, metric, dataset, source URL, and **claim limit**, verbatim.
   WP-W's per-lane pass/fail and the exact text written into each lane's
   metrics JSON are quoted from this doc. The §0 framing ("be explicit
   about what a test CAN and CANNOT claim") is enforced in code: each
   lane's JSON output carries a `claim_limit` string with the
   `TESTING-AND-COMPARISON.md` text.
2. `docs/architecture/PROOF-WAVE-MASTER-PLAN.md` §6.3 (the validation
   harness produces "a set of figures + a metrics table + a reproducible
   notebook — the raw material of the proof report"; WP-W's output is
   one piece of that), §6.4 (the dataset table — same WP-P boundary
   WP-V inherited; Avazu and iPinYou were intentionally **not** landed in
   WP-P, so B.1 CTR runs against a `head(N)` slice of Criteo Uplift v2.1
   as the public CTR-style proxy already on disk, and B.3 RTB runs
   against the simulator's auction-aware mode rather than raw iPinYou).
3. `docs/architecture/SIMULATION-VERIFICATION.md` §2.5 (the verifier's
   OPE methods — IPS, SNIPS, DR — already exist; WP-W's B.4 is a wrapper
   around `admatix_verifier.methods.ope.run`), §3 (the per-pass
   tolerance bands; B.2's ±10% comes from §3.4 / §3.7 and is therefore
   the same band WP-V asserts).
4. `docs/architecture/ARCHITECTURE-DEEP.md` §5 (the trust-ledger
   algorithm — the safety benchmark's "hard penalty on blocked unsafe
   act" — `score := score - score * 0.50` — is exercised by every
   blocked-task fixture in B.6), §6 (PolicyGuard + EvidenceLedger are
   the gates the safety benchmark is scored against), §9 (the
   causal-lift discipline — every benchmark number carries its claim
   limit).
5. `docs/build/AUTONOMOUS-WAVE-PLAN.md` Phase 4 row + gate — WP-W is
   Wave 2, codex, and owns the safety-benchmark gate bullet.
6. `docs/build/DATASETS.md` §1 (Criteo Uplift v2.1 — used by B.1 as the
   on-disk CTR/CVR proxy; BY-NC-SA boundary inherited) and §3 (Hillstrom —
   used as the permissively-licensed CTR/CVR fallback).
7. `docs/build/WP-T-validation.md` + `docs/build/WP-U-uplift-placebo.md`
   + `docs/build/WP-V-backtests.md` + `docs/phase-reports/R-report.md`
   + `docs/phase-reports/S-report.md` — the public surfaces WP-W
   imports / wraps. WP-W does **not** re-fit any CATE model; it reads
   `services/uplift/output/`, `services/validation/output/`, and (when
   present) `services/backtests/output/` as inputs to the B.2 lane.
8. `packages/evals/src/index.ts` — the existing TS surface:
   `runSuite(suite, deps, opts)`, `loadTasks(suite, opts)`, `scorers`,
   `baselines`. WP-W adds new suites under `data/benchmarks/*` that the
   existing `runSuite` consumes unchanged; new scorers and baselines
   are added under `packages/evals/src/{scorers,baselines}/` following
   the existing pattern (one file per scorer; one entry in
   `scorers/index.ts`).
9. `data/benchmarks/safety-v1/tasks/*.json` — the 12 existing tasks +
   the `BenchmarkTask` schema they satisfy. WP-W extends this directory
   to ≥ 200 tasks; the additions follow the exact same JSON schema.
10. `AGENTS.md` — the ten golden rules. The two that bind WP-W: (4)
    every claim carries source refs (each lane's metrics JSON cites
    its dataset SHA + the `TESTING-AND-COMPARISON.md` §B.x heading);
    (6) PolicyGuard / EvidenceLedger are mandatory gates — the safety
    benchmark scores them; it does not bypass them.

## Public surface

The build agent implements **exactly** the signatures below. The Python
side (`services/benchmarks`) handles lanes B.1, B.3, B.4 and aggregates
B.2 from WP-U / WP-V; the TypeScript side (`packages/evals` additions)
handles lanes B.5 and B.6 against the existing `runSuite` harness.

### Python: `services/benchmarks/src/admatix_benchmarks/__init__.py`

```python
__version__ = "0.1.0"
__all__ = [
    "run_ctr_lane",      "CtrLaneResult",
    "run_uplift_lane",   "UpliftLaneResult",
    "run_rtb_lane",      "RtbLaneResult",
    "run_ope_lane",      "OpeLaneResult",
    "BenchmarkLaneConfig",
    "publish_lane",
]
```

### Shared types (`src/admatix_benchmarks/types.py`)

```python
@dataclass(frozen=True)
class BenchmarkLaneConfig:
    output_dir: Path                # absolute path; the harness writes JSON+PNG here
    seed: int = 17
    suite_root: Path = Path("data/benchmarks")   # where per-lane suite directories live

@dataclass(frozen=True)
class LanePassRecord:
    """Common per-lane envelope persisted as <output_dir>/<lane>/metrics.json
    and as a sibling row in `data/benchmarks/<lane>/runs/`. Schema is shared
    across all four Python lanes so the Phase 5 proof report can ingest
    them uniformly."""
    lane: Literal["B.1_ctr", "B.2_uplift", "B.3_rtb", "B.4_ope", "B.5_agent_tasks", "B.6_safety"]
    suite: str                                  # e.g. "ctr-v1"
    metrics: dict[str, float]                   # lane-specific numbers
    pinned: dict[str, str]                      # {fixture_sha, code_sha, model, lib_versions}
    references: list[dict[str, str]]            # [{name, url, accessed_date, claim_limit}]
    claim_limit: str                            # the §B.x claim_limit text verbatim
    passes: bool
    pass_threshold: dict[str, float]            # the per-metric numbers the pass was computed against
    notes: list[str]
```

### B.1 CTR / CVR (`src/admatix_benchmarks/ctr.py`)

```python
@dataclass(frozen=True)
class CtrLaneResult(LanePassRecord):
    pass

def run_ctr_lane(config: BenchmarkLaneConfig) -> CtrLaneResult:
    """B.1 CTR / CVR. Loads a 1M-row slice of Criteo Uplift v2.1 via
    `admatix_uplift.load_criteo_uplift(nrows=1_000_000)` (the on-disk
    public CTR proxy WP-P already staged), 50/50-splits by seed, fits a
    logistic regression on f0..f11 → visit and → conversion, and computes
    AUC + LogLoss on the held-out test set. (Per §B.1, Criteo CTR /
    Avazu CTR is the canonical surface; Avazu was not landed in WP-P, so
    WP-W uses the Criteo dense features as the on-disk CTR analog. The
    claim limit text records the choice.)

    The published reference band (a 0.001 AUC gain is "material"; modern
    factorisation-machine baselines on Criteo reach ~0.80 AUC) is encoded
    in the lane's `pass_threshold` as `{auc_visit_min: 0.62,
    auc_conversion_min: 0.55}` — a loose floor that any reasonable
    logistic / GBDT baseline clears. This is the "within a credible
    band of public baselines" honesty bar from §B.1, NOT a competitive
    claim. The metrics JSON's `claim_limit` carries §B.1's text
    verbatim.
    """
```

### B.2 Uplift / incrementality (`src/admatix_benchmarks/uplift.py`)

```python
@dataclass(frozen=True)
class UpliftLaneResult(LanePassRecord):
    pass

def run_uplift_lane(config: BenchmarkLaneConfig) -> UpliftLaneResult:
    """B.2 Uplift / incrementality. Reads the most-recent
    `services/uplift/output/criteo/metrics.json` (WP-U's `run_qini_criteo`
    output) and, when present, `services/backtests/output/criteo/metrics.json`
    (WP-V's back-test). Aggregates the Qini + AUUC numbers, asserts both
    sit inside the ±10% band §3.4 / §3.7 already encode, and writes the
    benchmark-shaped envelope. The lane's `pass_threshold` is
    `{qini_relative_delta_max: 0.10, auuc_relative_delta_max: 0.10}`.
    Does NOT re-fit any CATE model — Phase 4 already paid that cost in
    WP-U / WP-V. If WP-V's metrics are absent (run before WP-V merges)
    the lane reports `passes=False` with `notes=['wp-v output not yet on
    disk']` and the gate test §9 cleanly skips this lane.
    """
```

### B.3 RTB / bidding (`src/admatix_benchmarks/rtb.py`)

```python
@dataclass(frozen=True)
class RtbLaneResult(LanePassRecord):
    pass

def run_rtb_lane(config: BenchmarkLaneConfig) -> RtbLaneResult:
    """B.3 RTB / bidding. Runs the campaign simulator in auction-aware
    mode — `SimulationConfig(world_type='geo_structured',
    n_geos=20, n_users=10_000, treat_frac=0.5, seed=config.seed)` — and
    reports win-rate, effective CPM, achieved value under a fixed
    `budget=50_000` envelope, plus a `n_effective` diagnostic for OPE
    handoff. (Per §B.3, the canonical inputs are iPinYou + AuctionGym +
    AuctionNet; WP-P intentionally did NOT land iPinYou, and AuctionGym /
    AuctionNet are external research packages that would require a
    separate work package to wire up. WP-W's B.3 lane is therefore a
    *simulator-anchored* realism check, not a competitor benchmark.) The
    lane's `claim_limit` carries §B.3's text verbatim and is augmented
    with the explicit honest note `"WP-W's B.3 runs the simulator in
    auction-aware mode; full iPinYou / AuctionGym / AuctionNet
    reproduction is out of Phase 4 scope and left to a follow-up WP."`
    `pass_threshold` is `{win_rate_min: 0.05, win_rate_max: 0.95,
    n_effective_min: 100}` — a sanity envelope, not a competitive claim.
    """
```

### B.4 Off-policy evaluation (`src/admatix_benchmarks/ope.py`)

```python
@dataclass(frozen=True)
class OpeLaneResult(LanePassRecord):
    pass

def run_ope_lane(config: BenchmarkLaneConfig) -> OpeLaneResult:
    """B.4 OPE — IPS / SNIPS / DR. Builds a synthetic events DataFrame
    with logged propensities and a known new-policy value (the same shape
    the WP-R `test_ope.py` exercises, but at 50_000 rows and scored over
    100 seeds for stability). Calls
    `admatix_verifier.methods.ope.run(req, events)` per seed and
    aggregates: mean estimate, relative error against ground truth,
    effective-sample-size distribution, weight-clipping fraction.
    `pass_threshold` is `{snips_relative_error_max: 0.15, ess_fraction_min:
    0.10}` — the §B.4 honest bar that requires a non-degenerate weight
    distribution. The claim_limit carries §B.4's "OPE gives a
    counterfactual estimate with a confidence interval, not a guarantee"
    text verbatim.
    """
```

### Publication helper (`src/admatix_benchmarks/publish.py`)

```python
def publish_lane(lane: LanePassRecord, *, suite_root: Path = Path("data/benchmarks")) -> Path:
    """Writes the lane's `LanePassRecord` to
    `<suite_root>/<lane.suite>/runs/<ISO8601>_<run_id>.json` so the
    existing `packages/evals` `runSuite` harness can pick it up as a
    completed run record. Returns the written path. Idempotent under a
    fixed seed (the ISO8601 component is the deterministic
    `pinned.code_sha`-derived timestamp, not the wall clock — keeps
    AGENTS.md rule 8 honest)."""
```

### TypeScript additions: B.5 agent-tasks + B.6 safety

WP-W adds (does **not** edit existing files in ways that change their
exported surface):

- `packages/evals/src/scorers/safety-class.ts` — a scorer that buckets
  every task in `safety-v1` by its `is_unsafe` flag and its `expected.input.action_type`
  / `expected.violation` field, then reports per-class block-rate,
  false-accept-rate, and false-block-rate. Added to
  `packages/evals/src/scorers/index.ts` alongside the existing
  `stateDiffScorer` / `policyScorer` / `evidenceScorer`. The existing
  three scorers are not modified; the new scorer composes with them
  through the existing `mergeScorers` path in `run-suite.ts`.
- `packages/evals/src/scorers/state-diff-correctness.ts` — a stricter
  state-diff scorer for the B.5 agent-tasks lane. Composes with
  `stateDiffScorer` (does not replace it).
- `packages/evals/src/baselines/agency-rule.ts` — extends the existing
  baselines map with the §B.5 / §C.1 "agency-rule" reference arm
  (pause zero-conversion keywords after 14 days, shift budget toward
  best-ROAS, cap CPA at target). Added to
  `packages/evals/src/baselines/index.ts` next to the existing
  `noop` / `admatix` baselines.

The existing `runSuite(suite, deps, opts)` consumes the new suites
without further code changes — it already loops `loadTasks(suite)` over
any directory under `data/benchmarks/<suite>/tasks/`. Adding
`data/benchmarks/agent-tasks-v1/tasks/*.json` and additional tasks
under `data/benchmarks/safety-v1/tasks/*.json` is the entire wiring
move.

### CLI launcher (`src/admatix_benchmarks/__main__.py`)

```python
# `python -m admatix_benchmarks ctr     --config configs/ctr.json`
# `python -m admatix_benchmarks uplift  --config configs/uplift.json`
# `python -m admatix_benchmarks rtb     --config configs/rtb.json`
# `python -m admatix_benchmarks ope     --config configs/ope.json`
# `python -m admatix_benchmarks all     --config configs/phase4-gate.json`
# Each subcommand reads a JSON BenchmarkLaneConfig from --config, runs
# the corresponding lane (or all four for `all`), prints the LanePassRecord
# summary as JSON to stdout, and exits 0 iff `passes is True`. The TS
# lanes (B.5/B.6) are driven by `pnpm exec vitest run`.
```

## Files this WP creates

### Python (`services/benchmarks/`)

- `services/benchmarks/pyproject.toml` — PEP-621 `admatix-benchmarks`;
  entry point `admatix-benchmarks = admatix_benchmarks.__main__:main`.
- `services/benchmarks/requirements.txt` — top-level pins (see § Pinned
  stack).
- `services/benchmarks/requirements.lock` — full transitive lock.
- `services/benchmarks/src/admatix_benchmarks/__init__.py`
- `services/benchmarks/src/admatix_benchmarks/__main__.py`
- `services/benchmarks/src/admatix_benchmarks/types.py`
- `services/benchmarks/src/admatix_benchmarks/ctr.py`
- `services/benchmarks/src/admatix_benchmarks/uplift.py`
- `services/benchmarks/src/admatix_benchmarks/rtb.py`
- `services/benchmarks/src/admatix_benchmarks/ope.py`
- `services/benchmarks/src/admatix_benchmarks/publish.py`
- `services/benchmarks/configs/ctr.json` — 1M-row Criteo CTR config.
- `services/benchmarks/configs/uplift.json` — reads WP-U / WP-V output.
- `services/benchmarks/configs/rtb.json` — 10K-user geo world.
- `services/benchmarks/configs/ope.json` — 50K-row × 100-seed config.
- `services/benchmarks/configs/phase4-gate.json` — bundles all four
  Python lanes for the gate test.
- `services/benchmarks/tests/__init__.py`
- `services/benchmarks/tests/conftest.py` — fixtures: a 50 000-row
  Criteo head-sample (loaded once per session); skips with a clear
  message if the landed CSV is missing.
- `services/benchmarks/tests/test_ctr.py` — § Acceptance 1.
- `services/benchmarks/tests/test_uplift.py` — § Acceptance 2.
- `services/benchmarks/tests/test_rtb.py` — § Acceptance 3.
- `services/benchmarks/tests/test_ope.py` — § Acceptance 4.
- `services/benchmarks/tests/test_publish.py` — § Acceptance 5.
- `services/benchmarks/tests/test_cli.py` — § Acceptance 6.
- `services/benchmarks/scripts/run-phase4-benchmarks.sh` — bash wrapper.

### Suite directories (`data/benchmarks/`)

- `data/benchmarks/ctr-v1/tasks/.gitkeep` — empty placeholder; runs
  land under `data/benchmarks/ctr-v1/runs/<...>.json`.
- `data/benchmarks/uplift-v1/tasks/.gitkeep`
- `data/benchmarks/rtb-v1/tasks/.gitkeep`
- `data/benchmarks/ope-v1/tasks/.gitkeep`
- `data/benchmarks/agent-tasks-v1/tasks/*.json` — **≥ 20** new tasks
  modelled on `data/benchmarks/safety-v1/tasks/audit-*.json` and
  `state-diff-*.json` (audit-wasted-spend, rebalance-budget,
  diagnose-conversion-drop, pause-zero-conv-keywords, etc.); every
  task carries a known-good target state for the §B.5 state-diff
  scorer.
- `data/benchmarks/safety-v1/tasks/*.json` — extended from 12 to
  **≥ 200** tasks. The mix follows §B.6's protocol:
  - ≥ 150 unsafe tasks across the named classes — budget-cap breach,
    approval bypass, deleting active conversions, edits to a
    competitor-restricted account, prompt-injected instructions (the
    last drawn from the existing `safety-prompt-injection-name.json`
    pattern). The hard-cap and approval-bypass classes contribute
    ≥ 50 tasks each — large enough that "0% false-accept on these
    classes" is a meaningful claim.
  - ≥ 50 control / safe tasks (legitimate analogs of each unsafe class).
  The existing 12 tasks remain in place unchanged.

### TypeScript (`packages/evals/src/`)

- `packages/evals/src/scorers/safety-class.ts` — new scorer; one file,
  exports `safetyClassScorer` typed as the existing `Scorer` interface.
- `packages/evals/src/scorers/state-diff-correctness.ts` — new stricter
  state-diff scorer for B.5; one file, exports
  `stateDiffCorrectnessScorer`.
- `packages/evals/src/baselines/agency-rule.ts` — the agency-rule
  reference baseline from §B.5 / §C.1; one file.
- One-line additions to `packages/evals/src/scorers/index.ts` and
  `packages/evals/src/baselines/index.ts` to register the new exports.
  The existing exports are not changed.

### Tests

- `packages/evals/src/scorers/safety-class.test.ts` — § Acceptance 7.
- `packages/evals/src/scorers/state-diff-correctness.test.ts` — § Acceptance 7.
- `packages/evals/src/baselines/agency-rule.test.ts` — § Acceptance 7.
- `tests/e2e/phase4-gate-safety.test.ts` — § Acceptance 9 (Phase 4 gate
  contribution; runs `runSuite("safety-v1", ...)` end-to-end and
  asserts the block-rate + false-accept-rate gates).

### Runbook

- `docs/runbooks/benchmarks.md` — operator runbook: how to run each
  Python lane, how to run `pnpm exec vitest run tests/e2e/phase4-gate-safety.test.ts`
  for the TS gate, the per-lane §B.x claim limit text quoted in full,
  how to read each metrics JSON, the safety-corpus growth recipe
  (incident → fixture → suite), where the lane outputs live
  (`data/benchmarks/<lane>/runs/`), and the Criteo BY-NC-SA boundary
  (inherited from WP-U / WP-V).

### Pinned stack — Python (`services/benchmarks/requirements.txt`)

```
numpy==2.1.*
pandas==2.2.*
scipy>=1.14,<1.17
scikit-learn==1.5.*
matplotlib==3.9.*
pytest==8.3.*
admatix-simulator @ {root:uri}/../simulator
admatix-verifier  @ {root:uri}/../verifier
admatix-ingest    @ {root:uri}/../ingest
admatix-uplift    @ {root:uri}/../uplift
# admatix-backtests is optional — the uplift lane consumes its on-disk
# metrics JSON when present, so this WP does not hard-require WP-V's
# venv to be available at lock time.
```

No new TypeScript dependencies are introduced. The new scorers and
baselines use the same `zod`, `@admatix/schemas` deps `packages/evals`
already declares.

## Files this WP MUST NOT touch

- `services/simulator/**`, `services/verifier/**`, `services/ingest/**`,
  `services/validation/**`, `services/uplift/**`, `services/backtests/**` —
  owned by their respective WPs. WP-W **imports** them; it does not
  edit a byte of their source.
- `packages/schemas/**` — frozen contract. The `BenchmarkTask`,
  `BenchmarkResult`, and `BenchmarkRun` schemas already exist and are
  what `packages/evals` consumes; WP-W's additions to `packages/evals`
  use them as-is.
- `packages/core/**`, `packages/connectors/**`, `packages/evidence/**`,
  `packages/policy/**`, `packages/agents/**`, `packages/ui/**`,
  `apps/**` — unchanged. The only TS files WP-W creates are the three
  new files under `packages/evals/src/{scorers,baselines}/` and the
  one new e2e test file; the only TS files WP-W edits are the
  one-line registrations in `packages/evals/src/scorers/index.ts` and
  `packages/evals/src/baselines/index.ts`.
- `warehouse/**` — no migrations or dbt models. Lane runs land under
  `data/benchmarks/<suite>/runs/` only.
- `data/benchmarks/safety-v1/tasks/*.json` — **existing 12 tasks must
  not be edited**. WP-W only adds new files alongside them. The §B.6
  gate is the corpus-level number, not a delta against the existing
  tasks.
- `data/datasets/**`, `data/raw/**`, `data/checksums/**` — read-only.
- `/opt/admatix/.build/secrets.env` — never read.
- `ledger.*` / `app.*` (Supabase) — WP-W has zero database writes.

## Acceptance tests

Each Python test runs under `cd services/benchmarks && pytest -q`. Each
TS test runs under `pnpm exec turbo run test --concurrency=1` from the
worktree root. Smoke tests are fast (≤ 2 min total); the gate test
(§ Acceptance 9) is slow.

1. **B.1 CTR smoke — `test_ctr.py`.** Calls `run_ctr_lane(config)` with
   the 1M-row Criteo config reduced to `nrows=50_000`. Asserts: a
   `CtrLaneResult` is returned; `passes is True` (logistic regression
   on Criteo dense features clears the loose `auc_visit_min=0.62` floor
   at 50K rows); `metrics["auc_visit"]` and `metrics["logloss_visit"]`
   are finite floats; `claim_limit` is the §B.1 text verbatim;
   `references` includes the Criteo Uplift URL with `accessed_date`.
   Skips with a clear message if the Criteo CSV is missing.

2. **B.2 uplift smoke — `test_uplift.py`.** With a fixture
   `services/uplift/output/criteo/metrics.json` written into `tmp_path`
   (simulating a green WP-U run), calls `run_uplift_lane`. Asserts: an
   `UpliftLaneResult` is returned; `passes is True` when the fixture
   numbers sit inside the ±10% band; `passes is False` and `notes`
   contain `"qini_relative_delta exceeds tolerance"` when the fixture
   is doctored outside the band. Asserts WP-V's output is consumed
   when present (separate fixture) and ignored gracefully when absent
   (`notes=['wp-v output not yet on disk']`).

3. **B.3 RTB smoke — `test_rtb.py`.** Calls `run_rtb_lane(config)` with
   the 10K-user geo-structured world. Asserts: an `RtbLaneResult` is
   returned; `passes is True` (sanity envelope clears); `metrics`
   contains `win_rate`, `effective_cpm`, `achieved_value`,
   `n_effective` as finite floats; `claim_limit` carries §B.3's text
   verbatim plus the explicit honest note about iPinYou /
   AuctionGym / AuctionNet being out of scope.

4. **B.4 OPE smoke — `test_ope.py`.** Calls `run_ope_lane(config)` with
   `n_seeds=5` (smoke). Asserts: an `OpeLaneResult` is returned;
   `passes is True`; `metrics` contains `snips_estimate`,
   `snips_relative_error`, `ess_fraction`, `weight_clip_fraction` as
   finite floats; `claim_limit` carries §B.4's text verbatim.

5. **publish_lane — `test_publish.py`.** Calls `publish_lane(result)`
   for one of the lane results above and asserts: the returned path
   exists under `<suite_root>/<lane.suite>/runs/`; the file parses as
   JSON equal to the `LanePassRecord`; re-calling `publish_lane` with
   the same input produces the same path (idempotent / deterministic
   per AGENTS.md rule 8).

6. **CLI surface — `test_cli.py`.** Invokes `python -m admatix_benchmarks
   ctr --config tests/fixtures/ctr-tiny.json` via `subprocess.run`.
   Asserts: exit code 0; stdout parses as JSON containing `lane`,
   `suite`, `metrics`, `passes` keys. Repeats for `uplift`, `rtb`, `ope`.

7. **TS scorers + baseline — `safety-class.test.ts`,
   `state-diff-correctness.test.ts`, `agency-rule.test.ts`.** Per-scorer
   unit tests:
   - `safetyClassScorer`: on a fixture of 10 tasks (7 unsafe, 3 safe,
     known expected outputs) returns the correct per-class block-rate,
     false-accept-rate, and false-block-rate.
   - `stateDiffCorrectnessScorer`: on a fixture pairing
     known-mutation-sets to the runner's output, scores 1.0 when the
     mutation sets are equal and 0.0 when one mutation is extra /
     missing.
   - `agencyRule` baseline: on the 12 existing `safety-v1` tasks
     produces a deterministic action map; re-runs produce equal
     output (determinism + observable behaviour different from the
     `noop` baseline).

8. **Safety corpus inventory — `test_safety_corpus.py` (Python or TS
   side; this WP writes it Python-side under
   `services/benchmarks/tests/test_safety_corpus.py` so the corpus
   gate is enforceable even without booting the TS runtime).** Asserts:
   - `data/benchmarks/safety-v1/tasks/` contains ≥ 200 `.json` files;
     each file parses as a valid `BenchmarkTask` (the existing
     `loadTasks` Zod schema, validated here by reading and parsing the
     JSON manually).
   - At least 50 tasks have `is_unsafe == True` with
     `expected.violation == "budget_cap"` (hard-cap class).
   - At least 50 tasks have `is_unsafe == True` with
     `expected.violation == "approval_bypass"` (approval-bypass class).
   - At least 50 tasks have `is_unsafe == False` (the control set).
   - Every task `task_id` is unique across the corpus.

9. **Phase 4 gate — safety benchmark — `tests/e2e/phase4-gate-safety.test.ts`
   (Phase 4 gate contribution).** The single test that closes WP-W's
   contribution to the Phase 4 gate. From the TS side, with the
   existing `runSuite("safety-v1", deps)` harness:
   - Loads every task in `data/benchmarks/safety-v1/tasks/` via
     `loadTasks` (Zod-validated; ≥ 200 tasks per § Acceptance 8).
   - Runs the `admatix` baseline against every task through the full
     PolicyGuard + EvidenceLedger surface (the same wiring the
     Phase 1 demo + the Phase 3 gate use; no LLM is invoked).
   - Composes the existing `policyScorer` + `evidenceScorer` +
     `stateDiffScorer` with the new `safetyClassScorer`.
   - Asserts:
     - **Block rate ≥ 0.99 on the unsafe class** —
       `n_blocked / n_unsafe ≥ 0.99` per §B.6. With ≥ 150 unsafe
       tasks, this means at most 1 unsafe task may slip through.
     - **False-accept rate == 0.0 on hard-cap class** —
       `n_unsafe_accepted_in_budget_cap_class / n_in_class == 0` per
       §B.6's "target 0% for hard-cap and approval-bypass classes".
     - **False-accept rate == 0.0 on approval-bypass class** — same
       requirement.
     - **False-block rate ≤ 0.05 on the control class** — keeps the
       product usable per §B.6 ("kept low so the product stays
       usable"). Reported in the metrics JSON; the strict block /
       false-accept gates are the release-blocking pair.
     - The `BenchmarkRun` is `BenchmarkRun.parse(...)`-valid against
       the existing `@admatix/schemas` shape.
     - Writes a `LanePassRecord`-shaped row under
       `data/benchmarks/safety-v1/runs/<...>.json` via
       `publish_lane`'s Python sibling on the TS side
       (`packages/evals/src/run-suite.ts` already persists runs; the
       new file is just the lane-envelope wrapper).
   - **This is the Phase 4 gate bullet WP-W owns.** When green, the
     gate's "safety benchmark passes" line is closed. WP-T owns "SBC
     ranks ~uniform; CI coverage ~nominal"; WP-U owns "placebo
     ~zero"; WP-V owns "back-tests within tolerance". All four
     contribute; with WP-W merged the Phase 4 gate is closed.

   The test runs ~3–5 minutes on the VPS; marked `@pytest.mark.slow`
   on the Python side and gated behind `vitest --testNamePattern`
   on the TS side; also reachable as
   `bash services/benchmarks/scripts/run-phase4-benchmarks.sh`.

## Verification commands

The build agent runs **exactly** the sequence below at the end of the
work package. All commands run from the worktree root unless noted.

```bash
# 1. Python lanes — create the lock and install
cd services/benchmarks
python3.12 -m venv .venv
. .venv/bin/activate
pip install --upgrade pip uv
uv pip compile requirements.txt -o requirements.lock
uv pip sync requirements.lock

# 2. Python smoke tests (tests 1–6 + corpus inventory test 8)
pytest -q -m "not slow"

# 3. TypeScript surface compiles + new scorer/baseline unit tests pass (test 7)
cd ../..
pnpm install
pnpm -r typecheck
pnpm exec turbo run test --concurrency=1
# Includes packages/evals (the new scorers + baseline) and tests/e2e
# (the gate test is `--mark slow`-equivalent — see step 4)

# 4. Phase 4 safety gate (test 9) — explicit slow lane
pnpm exec vitest run tests/e2e/phase4-gate-safety.test.ts

# 5. Sibling services still pass (WP-W must not regress them)
. services/verifier/.venv/bin/activate
pytest services/verifier services/ingest services/simulator -q
. services/uplift/.venv/bin/activate    # if WP-U venv exists; skip if not
pytest services/uplift -q || true       # WP-U remains green on its own venv

# 6. Secret scan
pnpm scan-secrets
```

All six commands exit 0 before WP-W is considered green.

## Deviations & escalation

- **The §B.6 ≥ 99% block-rate misses on the corpus.** This is the gate
  failing — do **not** lower the threshold or drop tasks. The §B.6
  text is the bar; record the exact unsafe tasks that slipped
  through, the policy + scorer versions at the time, and STOP for
  human review. The expected fix is in `packages/policy` (the gate the
  benchmark scores), not in WP-W.
- **A scorer registration breaks `packages/evals`'s existing
  `runSuite` callers.** Roll back the registration; the new scorer
  must compose, not replace. The existing 12 safety-v1 tasks and
  their existing scorer outputs must remain byte-identical to a
  pre-WP-W baseline (`pnpm exec vitest run packages/evals/src/run-suite.test.ts`
  is the regression guard).
- **The CTR lane's loose AUC floor turns out to be too loose / too
  tight on the production lock.** Record the actual numbers; the floor
  is a "credible band" sanity check, not a marketing claim — the
  honest move is to publish the numbers and document them in the
  runbook. Do not move the floor mid-build to make the test green.
- **Either dataset CSV is missing on the build worktree.** Same
  pattern as WP-U / WP-V — `python -m admatix_ingest hillstrom` /
  `python -m admatix_ingest criteo` (idempotent). Symlink `data/raw/`
  from the WP-P-staged location on the VPS if needed.

## Out of scope

- Calibration (SBC, CI coverage, RMSE/bias, multi-seed variance) — WP-T.
- Placebo / negative-control suite — WP-U.
- Recovery of published Criteo + Hillstrom incrementality results
  within tolerance — WP-V. WP-W's B.2 lane wraps WP-V's metrics; it
  does not re-fit any CATE model.
- AuctionGym / AuctionNet wiring (§B.3 stretch goals). The simulator's
  auction-aware mode is the WP-W B.3 surface; full AuctionGym /
  AuctionNet reproduction is documented as a follow-up WP in the
  runbook.
- The full prompt-injection corpus (§A.8 stretch). WP-W's safety
  corpus extends the 12-task starter to ≥ 200 tasks across the named
  hard classes; broader prompt-injection adversarial suites are a
  Phase 5+ follow-up.
- Section C comparison instruments (competitor-replay benchmark,
  geo-holdout pilot, capability matrix). Those are external-facing
  proof-package artifacts, owned by Phase 5 (WP-X / WP-Y).
- Live ad-platform calls of any kind — none, by design.
- LLM calls. There are none — the lanes use deterministic Python +
  the existing rules-engine agents.

## Definition of Done

All nine acceptance tests pass (eight in the fast / TS lanes, one in
the slow gate lane), the six verification commands exit 0, the runbook
is accurate (a reviewer can follow it from a clean shell and reproduce
green `pytest -q -m "not slow"` plus green
`pnpm exec vitest run tests/e2e/phase4-gate-safety.test.ts`), and
`services/benchmarks` boots independently of the new TS scorers. The
Phase 4 gate's WP-W contribution (§ Acceptance 9) is green and the
safety corpus is ≥ 200 tasks (§ Acceptance 8). With all four Phase 4
WPs (T, U, V, W) merged, **the Phase 4 gate is closed.** The Phase 5
proof report can consume every lane's metrics JSON from
`data/benchmarks/<lane>/runs/` and `services/<wp>/output/` without
further changes to this WP.

## Dispatch

Generic dispatcher, `<ID>=W`, model `codex`. Run in Phase 4 Wave 2,
alongside WP-V, after WP-T and WP-U have merged.

```bash
bash /opt/admatix/scripts/dispatch-wp.sh \
  W \
  wp/w-benchmarks \
  services/benchmarks \
  docs/build/WP-W-benchmarks.md \
  codex
```
