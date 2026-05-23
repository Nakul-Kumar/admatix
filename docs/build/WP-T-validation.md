# WP-T — Research-grade validation harness (`services/validation`)

**Owns:** `services/validation/**`, `docs/runbooks/validation.md`
**Branch:** `wp/t-validation` · **Phase:** 4 · **Wave:** 1
**Depends on:** `services/simulator` (WP-Q) and `services/verifier` (WP-R) — both
  merged on `main`. WP-T imports them as Python libraries; no HTTP hop is used
  in the batch harness.
**Suggested agent:** Claude Code Opus 4.7 · **Size:** large

## Why this exists

WP-R built the verifier as a per-call grader; WP-T is the harness that proves
the verifier is **correct, calibrated, and stable** at population scale. It is
the half of the Phase 4 gate that ships *before* placebo / back-tests / safety
benchmarks. Without it the verifier is "a thing that runs"; with it the
verifier is "a thing whose error bars and bias are measured and
release-blocking." The harness implements `SIMULATION-VERIFICATION.md` §3.1–3.6:
Simulation-Based Calibration, CI coverage curves, RMSE + bias tables, and a
multi-seed variance harness — every figure and metric persisted as a
reproducible artifact a technical reviewer can re-run from a clean shell.

The Phase 4 master-plan bullet WP-T owns is **"SBC ranks ~uniform; CI coverage
~nominal."** WP-U owns "placebo ~zero", WP-V owns "back-tests within
tolerance", WP-W owns "safety benchmark passes" (and the B.1–B.6 lanes). WP-T
is the *calibration* slice — the other three Phase 4 WPs build on top of it.

## Required reading (in this order)

1. `docs/architecture/PROOF-WAVE-MASTER-PLAN.md` §2 (what "research-grade" means
   — the eight-item bar: ground-truth recovery, SBC, CI coverage, RMSE/bias,
   Qini/AUUC, placebos, multi-seed, back-tests), §6.3 (`services/validation`'s
   mandate — figures + metrics + reproducible notebook).
2. `docs/architecture/SIMULATION-VERIFICATION.md` §3 — every pass threshold
   WP-T enforces. The exact bands:
   - §3.1 SBC — χ² uniformity p > 0.05 on ≥ 500 simulations; no systematic
     ∪/∩ shape;
   - §3.2 CI coverage — empirical 95% coverage ∈ **[0.93, 0.97]** on ≥ 1000
     simulated worlds. < 0.93 = release-blocking; > 0.98 = flag-for-review;
   - §3.3 RMSE + bias — `|mean(est − true)| ≤ 0.1·|true_lift|` on confounded
     worlds; RMSE ≤ `0.25·true_lift` at default `n_users`; consistency check
     as `n_users` grows;
   - §3.6 multi-seed — coefficient of variation of the ATE estimate ≤ 0.15;
     verdict label stable in ≥ 90% of seed pairs.
   - §4 — the pinned Python stack WP-T must extend (`simuk` for SBC, `arviz`
     for rank histograms, `pymc` for the Bayesian reference estimator the SBC
     loop runs against, the `numpy`/`pandas`/`scipy` numerics already pinned
     in `services/verifier`).
3. `docs/architecture/ARCHITECTURE-DEEP.md` §9 — the causal-lift discipline.
   WP-T must publish *every* metric with its claim limit; an SBC pass is a
   statement about the harness's reference Bayesian model, not about every
   verifier method.
4. `docs/build/AUTONOMOUS-WAVE-PLAN.md` Phase 4 row + gate — the four-WP split
   and the exact gate text. WP-T is Wave 1, opus.
5. `docs/build/WP-R-verifier.md` + `docs/phase-reports/R-report.md` — the
   verifier's actual on-disk shape WP-T calls. Important detail from the
   R-report: WP-R's BSTS layer is `statsmodels.UnobservedComponents`
   (frequentist Kalman state-space), **not** TF-Probability. SBC strictly
   applies to Bayesian estimators, so WP-T does **not** SBC the frequentist
   BSTS — instead it (a) implements a small PyMC reference Bayesian-CATE
   estimator inside `services/validation` and SBCs *that*, and (b) runs the
   standard frequentist CI-coverage test against every production method
   (BSTS, CATE-DML, geo synthetic-control, OPE).
6. `docs/build/WP-S-wiring.md` + `docs/phase-reports/S-report.md` — confirms
   the verifier is available on `main` and the WP-S e2e test boots it the
   same way WP-T's reports will reference.
7. `services/simulator/src/admatix_simulator/__init__.py` — the
   `SimulationConfig`, `WorldType`, `generate_world(config, output_dir)`, and
   `SimulatedWorld.ground_truth` shape WP-T iterates over. The four world
   types — `clean_ab`, `geo_structured`, `confounded`, `zero_lift_placebo` —
   are the parameter grid WP-T scans.
8. `services/verifier/src/admatix_verifier/` — the entry points WP-T calls:
   `admatix_verifier.methods.{guardrail, bsts, cate, geo, ope}.run(req,
   events)`, `admatix_verifier.select.select_method`, and
   `admatix_verifier.loaders.{load_events, load_metadata}`. WP-T uses these
   directly — it does **not** spin up a uvicorn process per call. The
   FastAPI surface is invoked only as a smoke test (§ Acceptance test 6).
9. `AGENTS.md` — the ten golden rules. The two that bind WP-T: (4) every
   claim carries source refs (every figure WP-T writes embeds its seed,
   config hash, and verifier git sha); (8) determinism — same seed grid +
   same code → byte-identical metrics tables. SBC and coverage runs accept
   a CLI flag for seed range and write JSON metrics deterministically.

## Public surface

The build agent implements **exactly** the signatures below. There is no
network call inside the harness — every verifier call is a direct Python
import.

### Top-level package (`services/validation/src/admatix_validation/__init__.py`)

```python
__version__ = "0.1.0"
__all__ = [
    "run_sbc", "SbcResult",
    "run_coverage", "CoverageResult",
    "run_rmse_bias", "RmseBiasResult",
    "run_multiseed_variance", "MultiSeedResult",
    "ValidationConfig",
]
```

### Shared types (`src/admatix_validation/types.py`)

```python
@dataclass(frozen=True)
class ValidationConfig:
    """Outer config for one harness run. Persisted alongside every result."""
    output_dir: Path           # absolute path; the harness writes JSON+PNG here
    n_simulations: int         # number of simulator worlds to draw (see method-specific minima)
    seeds: list[int]           # explicit seed grid — full enumeration, no RNG behind it
    world_grid: list[dict]     # list of SimulationConfig kwargs to scan (params × seeds = total runs)
    verifier_method: Literal["auto", "cate_meta_learner", "bsts_synthetic_control",
                             "geo_synthetic_control", "ope_ips_snips_dr"] = "auto"
    ci_level: float = 0.95     # nominal CI level — coverage band centres on this

@dataclass(frozen=True)
class WorldRun:
    """One (config, seed) iteration: the simulator-emitted ground truth + the
    verifier's response, both raw. Persisted as JSONL for replay."""
    config_hash: str
    seed: int
    world_id: str
    world_type: str
    ground_truth_ate: float
    estimate: float | None
    ci_low: float | None
    ci_high: float | None
    method: str
    verdict: str
    diagnostics: dict[str, Any]
```

### SBC harness (`src/admatix_validation/sbc.py`)

```python
@dataclass(frozen=True)
class SbcResult:
    n_simulations: int
    rank_histogram: list[int]                  # counts per bin, length = n_bins
    n_bins: int                                # default 20
    chi2_statistic: float
    chi2_p_value: float                        # > 0.05 = uniform = pass
    shape_diagnostic: Literal["uniform", "u_shaped", "n_shaped", "skewed"]
    passes_uniformity: bool                    # True iff chi2_p_value > 0.05 AND shape == "uniform"
    rank_plot_path: Path                       # PNG produced by arviz
    metrics_path: Path                         # JSON dump of this dataclass
    reference_model: str                       # e.g. "pymc_bayesian_cate_v0_1"

def run_sbc(
    config: ValidationConfig,
    *,
    reference_model: Literal["pymc_bayesian_cate"] = "pymc_bayesian_cate",
) -> SbcResult:
    """Simulation-Based Calibration per Talts et al. 2018 (arXiv:1804.06788),
    implemented with `simuk` over a PyMC reference Bayesian CATE estimator
    declared in `src/admatix_validation/reference_models/pymc_cate.py`.

    The loop, for i in 1..config.n_simulations:
      1. Draw prior parameters θ_i from the reference model's prior.
      2. Simulate a small ad-campaign world consistent with θ_i, using
         services.simulator.generate_world (the world's true ATE = θ_i).
      3. Fit the reference Bayesian CATE estimator on the world.
      4. Record the rank of θ_i among posterior draws of the ATE.

    Returns an `SbcResult` whose `passes_uniformity` is True iff the rank
    histogram is uniform — χ² goodness-of-fit p > 0.05 *and* no systematic
    ∪/∩ shape (the ∪/∩ check uses a sign-of-differenced-counts heuristic
    documented in the runbook).

    Side effects (deterministic under `config.seeds`):
      - writes `output_dir/sbc/rank_histogram.png` (arviz)
      - writes `output_dir/sbc/metrics.json` (this dataclass, json-serialised)
      - writes `output_dir/sbc/draws.jsonl` (one row per simulation: seed,
        prior_draw, rank, posterior_mean)
    """
```

### CI-coverage harness (`src/admatix_validation/coverage.py`)

```python
@dataclass(frozen=True)
class CoverageResult:
    n_worlds: int
    ci_level: float                            # nominal — 0.95 by default
    empirical_coverage: float                  # fraction whose CI contained truth
    lower_band: float = 0.93                   # release-blocking floor (§3.2)
    upper_band: float = 0.97                   # flag-for-review ceiling (§3.2)
    passes_nominal: bool                       # lower_band ≤ empirical ≤ upper_band
    flagged_for_review: bool                   # empirical > upper_band (CIs too wide)
    per_method: dict[str, dict[str, float]]    # {method: {n, coverage, mean_width}}
    runs_path: Path                            # JSONL of WorldRun rows
    metrics_path: Path

def run_coverage(config: ValidationConfig) -> CoverageResult:
    """Empirical 95% CI coverage on ≥ config.n_simulations simulated worlds
    (require ≥ 1000 for the gate; the harness errors out below that). For
    each (world_grid × seeds) cell:
      1. Materialise the world via services.simulator.generate_world.
      2. Build a VerifyRequest with hint.design set per world_type
         (so the selector picks the documented method per §2.6).
      3. Call the verifier method DIRECTLY (Python import, not HTTP) —
         `admatix_verifier.methods.<m>.run(req, events_df)`.
      4. Record whether ci_low ≤ ground_truth.ate ≤ ci_high.

    Returns a CoverageResult whose passes_nominal is True iff the §3.2 band
    holds on every per_method breakdown that has ≥ 200 worlds; methods
    with < 200 worlds report coverage but do not gate.

    Side effects:
      - writes `output_dir/coverage/runs.jsonl` (one WorldRun per cell)
      - writes `output_dir/coverage/coverage_curve.png` (coverage vs. n_users
        or vs. confounder_strength — the world_grid axis the caller varied)
      - writes `output_dir/coverage/metrics.json`
    """
```

### RMSE + bias harness (`src/admatix_validation/rmse_bias.py`)

```python
@dataclass(frozen=True)
class RmseBiasResult:
    n_worlds: int
    per_world_type: dict[str, dict[str, float]]    # {world_type: {bias, rmse, n}}
    bias_threshold_rel: float = 0.10               # §3.3 — ≤ 10% relative on confounded
    rmse_threshold_rel: float = 0.25               # §3.3 — ≤ 0.25·true_lift at default n
    consistency_ok: bool                            # RMSE shrinks toward floor as n_users grows
    passes_bias: bool                               # per §3.3 on confounded + clean_ab
    passes_rmse: bool
    metrics_path: Path
    table_path: Path                                # Markdown table for the proof report

def run_rmse_bias(config: ValidationConfig) -> RmseBiasResult:
    """Point-estimate RMSE and bias per §3.3.
    For each world_type in {clean_ab, confounded, geo_structured}:
      - Compute bias = mean(est − true), RMSE = sqrt(mean((est − true)^2))
        across all (config × seed) cells of that world_type.
      - Confounded worlds gate on |bias| ≤ 0.1·|true_lift|.
      - Clean_ab worlds gate on bias ≈ 0 (|bias| ≤ 0.05·|true_lift|).
      - RMSE gates on ≤ 0.25·true_lift at the default n_users; with a
        consistency check (RMSE at n_users=4·default < RMSE at default).
    """
```

### Multi-seed variance harness (`src/admatix_validation/multiseed.py`)

```python
@dataclass(frozen=True)
class MultiSeedResult:
    n_configs: int
    seeds_per_config: int                          # ≥ 20 per §3.6
    cv_of_estimate: dict[str, float]                # {config_hash: coefficient_of_variation}
    verdict_stability: dict[str, float]             # {config_hash: fraction_of_seed_pairs_with_same_verdict}
    cv_threshold: float = 0.15                     # §3.6 — pass if all CVs ≤ 0.15
    stability_threshold: float = 0.90              # §3.6 — pass if all stability ≥ 0.90
    passes: bool
    metrics_path: Path

def run_multiseed_variance(config: ValidationConfig) -> MultiSeedResult:
    """For each config in config.world_grid, re-run on ≥ 20 seeds; compute
    CV(estimate) and the pairwise verdict-stability fraction. Pass iff every
    config meets both thresholds."""
```

### Reference Bayesian estimator (`src/admatix_validation/reference_models/pymc_cate.py`)

```python
def build_pymc_cate_model(events: pd.DataFrame, *, n_draws: int = 1000,
                          n_tune: int = 1000, random_seed: int = 17) -> az.InferenceData:
    """A small, well-specified Bayesian model of (W, X) → Y used as the SBC
    reference estimator. Specification documented inline:
      Y ~ Bernoulli(p)
      logit(p) = α + γ·W + β·X (X = recency, frequency, prior_conversions)
      γ ~ Normal(0, 0.05)         # prior on the ATE on logit scale
      α ~ Normal(0, 1)
      β ~ Normal(0, 0.5)
    Returns an arviz InferenceData with posterior samples of γ — the
    Bayesian-ATE proxy SBC ranks the true value within.
    This is **not** a production verifier method; it is the reference model
    SBC validates. Caveat documented in the runbook."""
```

### CLI launcher (`src/admatix_validation/__main__.py`)

```python
# `python -m admatix_validation sbc       --config configs/sbc-default.json`
# `python -m admatix_validation coverage  --config configs/coverage-default.json`
# `python -m admatix_validation rmse-bias --config configs/rmse-default.json`
# `python -m admatix_validation multiseed --config configs/multiseed-default.json`
# `python -m admatix_validation all       --config configs/phase4-gate.json`
# Each subcommand reads a JSON ValidationConfig from --config, runs the
# corresponding harness, prints the result summary as JSON to stdout, and
# exits 0 iff the harness's pass flag is True.
```

## Files this WP creates

- `services/validation/pyproject.toml` — package metadata; PEP-621
  `admatix-validation`; entry point
  `admatix-validation = admatix_validation.__main__:main`.
- `services/validation/requirements.txt` — top-level pins (see § Pinned stack).
- `services/validation/requirements.lock` — full transitive lock produced by
  `uv pip compile`. CI installs from the lock.
- `services/validation/src/admatix_validation/__init__.py` — version + public
  re-exports.
- `services/validation/src/admatix_validation/__main__.py` — CLI subcommands.
- `services/validation/src/admatix_validation/types.py` — `ValidationConfig`,
  `WorldRun`.
- `services/validation/src/admatix_validation/sbc.py` — § Public surface.
- `services/validation/src/admatix_validation/coverage.py` — § Public surface.
- `services/validation/src/admatix_validation/rmse_bias.py` — § Public surface.
- `services/validation/src/admatix_validation/multiseed.py` — § Public surface.
- `services/validation/src/admatix_validation/reference_models/__init__.py`
- `services/validation/src/admatix_validation/reference_models/pymc_cate.py`
- `services/validation/src/admatix_validation/grids.py` — helpers for
  enumerating `(world_grid × seeds)` and turning a `SimulatedWorld` into a
  `VerifyRequest` the verifier methods accept.
- `services/validation/configs/sbc-default.json` — 500-simulation SBC config
  (default `world_type=clean_ab`, `n_users=2000`, `noise_sd=0.0`).
- `services/validation/configs/coverage-default.json` — 1000-world coverage
  config scanning `(n_users ∈ {2000, 4000, 8000}) × (world_type ∈
  {clean_ab, confounded, geo_structured}) × 20 seeds` ≈ 180 cells × 6 ≈ 1080
  worlds; uses `hint.design` per world type.
- `services/validation/configs/rmse-default.json` — RMSE/bias grid (clean_ab
  + confounded + geo_structured × `n_users ∈ {2000, 8000}` × 20 seeds).
- `services/validation/configs/multiseed-default.json` — 5 configs × 20
  seeds each.
- `services/validation/configs/phase4-gate.json` — the bundled config the
  Phase 4 gate test (§ Acceptance test 7) runs end-to-end; loose-but-binding
  cell counts so the test finishes in ≤ 10 minutes on the VPS.
- `services/validation/tests/__init__.py`
- `services/validation/tests/conftest.py` — pytest fixtures that materialise
  one `clean_ab` and one `confounded` world via `admatix_simulator.generate_world`
  under `tmp_path`; pinned seed, `n_users=2000`, `noise_sd=0.0`.
- `services/validation/tests/test_sbc_smoke.py` — § Acceptance test 1.
- `services/validation/tests/test_coverage_smoke.py` — § Acceptance test 2.
- `services/validation/tests/test_rmse_bias_smoke.py` — § Acceptance test 3.
- `services/validation/tests/test_multiseed_smoke.py` — § Acceptance test 4.
- `services/validation/tests/test_determinism.py` — § Acceptance test 5.
- `services/validation/tests/test_cli.py` — § Acceptance test 6.
- `services/validation/tests/test_phase4_gate_calibration.py` — § Acceptance
  test 7 (the Phase 4 gate contribution).
- `services/validation/scripts/run-phase4-calibration.sh` — bash wrapper that
  invokes `python -m admatix_validation all --config configs/phase4-gate.json`
  and exits 0 on green. Quoted from the runbook.
- `docs/runbooks/validation.md` — operator runbook: how to install
  (`python3.12 -m venv .venv && pip install -r requirements.lock`), how to
  run each harness, what each output JSON / PNG means, where the
  released-blocking bands live, how to interpret a §3.1 shape diagnostic
  (∪/∩ vs uniform), and the honest caveat that SBC validates the PyMC
  reference estimator only — the frequentist production methods are
  validated by CI coverage instead.

### Pinned stack (extends `services/verifier`'s, per SIMULATION-VERIFICATION §4)

```
# requirements.txt — top-level only; resolve to requirements.lock via uv pip compile
numpy==2.1.*                            # same as verifier
pandas==2.2.*                           # same as verifier
scipy>=1.14,<1.17                       # same band as verifier (R-report deviation #1)
statsmodels==0.14.*                     # same as verifier
pymc==5.*                               # Bayesian backend for the SBC reference model
arviz==0.20.*                           # posterior diagnostics + rank histograms
simuk                                   # SBC engine (ArviZ-devs); pin exact at lock time
matplotlib==3.9.*                       # PNG output for arviz plots
pytest==8.3.*
admatix-simulator @ {root:uri}/../simulator   # editable install of the sibling package
admatix-verifier  @ {root:uri}/../verifier    # editable install of the sibling package
```

The `admatix-simulator` / `admatix-verifier` lines bind WP-T to the actual
on-disk siblings (no network install). The runbook documents the fallback
incantation if `uv pip compile` cannot resolve the local-path requirement on
a given operator's box.

## Files this WP MUST NOT touch

- `services/simulator/**`, `services/verifier/**`, `services/ingest/**` —
  owned by WP-Q / WP-R / WP-P. WP-T **imports** them; it does not edit a
  byte of their source.
- `packages/schemas/**` — the frozen contract. WP-T persists metrics as
  JSON under `output_dir`; it does not extend any TS schema.
- `packages/core/**`, `packages/connectors/**`, `packages/evidence/**`,
  `packages/policy/**`, `packages/agents/**`, `packages/evals/**`,
  `packages/ui/**`, `apps/**` — the entire TypeScript monorepo is untouched
  by WP-T.
- `warehouse/**` — the data layer is finished in Phase 2; WP-T does not
  add migrations, dbt models, or marts. Validation artifacts live under
  `services/validation/output/` (gitignored), not in the warehouse.
- `data/datasets/**`, `data/raw/**` — WP-T runs entirely on simulator
  output and does not require WP-P's landed datasets. (WP-U / WP-V are
  the WPs that consume Hillstrom and Criteo Uplift.)
- `/opt/admatix/.build/secrets.env` — never read by this WP. The harness
  takes its inputs from `--config` JSON only.
- `ledger.*` / `app.*` (Supabase) — WP-T has zero database writes.

## Acceptance tests

Each test runs under `cd services/validation && pytest -q`. The numbered tests
match the test files in § Files this WP creates. Cell counts in the *smoke*
tests are deliberately small (so the suite finishes in ≤ 60 s); the *gate*
test (§ Acceptance 7) uses production cell counts and is the slow path.

1. **SBC smoke — `test_sbc_smoke.py`.** Calls `run_sbc(config)` with
   `n_simulations=30`, `seeds=range(101, 131)`,
   `world_grid=[{world_type: "clean_ab", n_users: 2000, noise_sd: 0.0}]`.
   Asserts: an `SbcResult` is returned; `result.rank_histogram` sums to 30
   and has `result.n_bins` entries; `result.chi2_p_value` is a float in
   `[0, 1]`; `result.shape_diagnostic ∈ {"uniform","u_shaped","n_shaped","skewed"}`;
   `result.rank_plot_path` exists and is a non-empty PNG;
   `result.metrics_path` exists and parses as JSON equal to the dataclass.
   The `reference_model` field is `"pymc_bayesian_cate_v0_1"`. (The 30-sim
   smoke is too small to gate uniformity — `passes_uniformity` is not
   asserted; that is the gate test.)

2. **Coverage smoke — `test_coverage_smoke.py`.** Calls `run_coverage(config)`
   with 60 worlds (3 grid cells × 20 seeds), `world_type=clean_ab`,
   `n_users=2000`, `true_lift=0.04`, `noise_sd=0.0`. Asserts: a
   `CoverageResult` is returned; `result.n_worlds == 60`;
   `result.empirical_coverage ∈ [0.0, 1.0]`; `result.per_method` has at
   least one entry; `result.runs_path` is a JSONL whose line count equals
   `n_worlds`; `result.metrics_path` parses to JSON equal to the dataclass.
   The `coverage_curve.png` artifact exists and is non-empty. (60 worlds is
   too small to gate the §3.2 band — `passes_nominal` is reported but not
   asserted; that is the gate test.)

3. **RMSE + bias smoke — `test_rmse_bias_smoke.py`.** Calls `run_rmse_bias`
   on 40 worlds (2 cells × 20 seeds — one `clean_ab`, one `confounded`),
   `true_lift=0.04`. Asserts: an `RmseBiasResult` is returned;
   `per_world_type` has entries for both `clean_ab` and `confounded`, each
   with non-NaN `bias` and `rmse`; the `table_path` Markdown exists and
   contains at minimum the strings `"clean_ab"`, `"confounded"`, `"bias"`,
   `"rmse"`. The §3.3 gate bands (`passes_bias`, `passes_rmse`) are
   reported but not asserted at this cell count.

4. **Multi-seed variance smoke — `test_multiseed_smoke.py`.** Calls
   `run_multiseed_variance` with 2 configs × 20 seeds. Asserts: a
   `MultiSeedResult` is returned; `cv_of_estimate` and `verdict_stability`
   each have 2 entries (one per config); each CV is a float ≥ 0; each
   stability is a float in `[0, 1]`. The §3.6 gate (`passes`) is reported
   but not asserted at this cell count.

5. **Determinism — `test_determinism.py`.** Re-runs `run_coverage` twice
   with the **same** `ValidationConfig` (same seeds, same world_grid).
   Asserts the two `metrics_path` JSON files are byte-identical and the
   two `runs.jsonl` files are byte-identical. Same check for
   `run_rmse_bias` and `run_multiseed_variance`. This is the harness's
   reproducibility floor (PROOF-WAVE-MASTER-PLAN §2 + AGENTS.md rule 8).

6. **CLI surface — `test_cli.py`.** Invokes
   `python -m admatix_validation sbc --config tests/fixtures/sbc-tiny.json`
   via `subprocess.run`. Asserts: exit code 0; stdout parses as JSON; the
   JSON contains `n_simulations`, `chi2_p_value`, and `metrics_path`
   keys. Repeats for `coverage`, `rmse-bias`, and `multiseed` subcommands
   with tiny fixture configs (≤ 60 worlds total each). Asserts the FastAPI
   verifier service itself (boots via the WP-R `scripts/smoke_uvicorn.sh`
   sibling — invoked in `setup_module` and torn down in `teardown_module`)
   answers `GET /healthz` while the CLI runs — proving the WP-R surface is
   intact for callers that prefer HTTP, even though the harness uses
   in-process imports.

7. **Phase 4 gate — calibration slice — `test_phase4_gate_calibration.py`
   (Phase 4 gate contribution).** The single test that closes WP-T's
   contribution to the Phase 4 gate. Loads
   `services/validation/configs/phase4-gate.json`. Asserts:
   - SBC: `run_sbc` returns `passes_uniformity is True` —
     `chi2_p_value > 0.05` and `shape_diagnostic == "uniform"` on
     **≥ 500 simulations** of the PyMC reference Bayesian-CATE estimator.
   - CI coverage: `run_coverage` returns `passes_nominal is True` —
     `empirical_coverage ∈ [0.93, 0.97]` on **≥ 1000 simulated worlds**;
     each `per_method` entry with `n ≥ 200` also lies inside the band.
   - The full metrics bundle (`output_dir/sbc/metrics.json`,
     `output_dir/coverage/metrics.json`,
     `output_dir/coverage/runs.jsonl`,
     `output_dir/sbc/rank_histogram.png`,
     `output_dir/coverage/coverage_curve.png`) exists and is non-empty
     on disk after the test.
   - **This is the Phase 4 gate bullet WP-T owns.** When green, the
     gate's "SBC ranks ~uniform; CI coverage ~nominal" line is closed.
     WP-U / WP-V / WP-W contribute the other three bullets (placebo
     ~zero; back-tests within tolerance; safety benchmark passes).

   The test runs ~10 minutes on the VPS; it is marked
   `@pytest.mark.slow` and is also reachable as
   `bash scripts/run-phase4-calibration.sh`.

## Verification commands

The build agent runs **exactly** the sequence below at the end of the work
package. All commands run from the worktree root unless noted.

```bash
# 1. Create the lock and install
cd services/validation
python3.12 -m venv .venv
. .venv/bin/activate
pip install --upgrade pip uv
uv pip compile requirements.txt -o requirements.lock
uv pip sync requirements.lock

# 2. Run the validation test suite (smoke tests 1–6; gate test 7 excluded by default)
pytest -q -m "not slow"

# 3. Run the Phase 4 gate slice explicitly (the slow path; ~10 min)
pytest -q -m slow tests/test_phase4_gate_calibration.py

# 4. Confirm the sibling Python services still pass (WP-T must not regress them)
cd ../..
. services/verifier/.venv/bin/activate
pytest services/verifier services/ingest services/simulator -q

# 5. Confirm the TypeScript monorepo is untouched
pnpm -r typecheck
pnpm exec turbo run test --concurrency=1

# 6. Secret scan
pnpm scan-secrets
```

All six commands exit 0 before WP-T is considered green.

## Deviations & escalation

If `simuk` or `pymc` cannot be resolved on the verifier's pinned `numpy 2.1`
/ `pandas 2.2` / `scipy ≥1.14,<1.17` stack (the WP-R lock had to widen
`scipy`'s upper bound; same risk applies here), the build agent records the
deviation in the phase report following the WP-R precedent — pin the actual
resolved versions, keep the lock reproducible, and assert SBC still passes
the §3.1 bands on the smoke fixture. If a deviation would *change* a §3
threshold (lower the SBC sim count, widen the coverage band, etc.), STOP
and escalate — those numbers are the gate, and changing them defeats the
purpose of WP-T.

## Out of scope

- Placebo / negative-control suite — that is WP-U (§3.5), Wave 1, codex.
- Qini / AUUC — also WP-U (§3.4). WP-T's coverage runs may incidentally
  surface a Qini value via `diagnostics["qini"]` (WP-R already emits it),
  but the Qini-pass gate (`Qini ≥ 0.5·oracle`) is asserted in WP-U, not
  here.
- Criteo Uplift v2.1 + Hillstrom back-tests — WP-V (§3.7), Wave 2, opus.
- B.1–B.6 benchmark lanes + safety benchmark — WP-W, Wave 2, codex.
- Live ad-platform calls of any kind — there are none, by design.
- New TypeScript code. The validation surface is read-only from the
  TS side; the Phase 5 proof report will reference WP-T's JSON metrics
  directly.
- A web cockpit view of validation results. The proof artifact is the
  JSON metrics + PNG figures bundle under `services/validation/output/`;
  the cockpit can pick them up in a later wave.
- Authentication on the CLI. The harness runs only on the VPS by an
  operator with shell access; cross-host auth is post-Phase-5 work.
- LLM calls. There are none — the harness is pure simulator + verifier +
  numpy / pymc.

## Definition of Done

All seven acceptance tests pass (six in the fast lane, one in the slow
lane), the six verification commands exit 0, the runbook is accurate (a
reviewer can follow it from a clean shell and reproduce green
`pytest -q -m "not slow"` plus a green
`bash scripts/run-phase4-calibration.sh`), and `services/validation` boots
independently of any TypeScript code. The Phase 4 gate's WP-T contribution
(§ Acceptance 7) is green and the metrics bundle on disk is reproducible
byte-for-byte from `configs/phase4-gate.json`. WP-V (back-tests) and the
Phase 5 proof report can now consume the validation metrics bundle without
further changes to this WP.

## Dispatch

Generic dispatcher, `<ID>=T`, model `opus`. Run in Phase 4 Wave 1, after
WP-R and WP-S have closed the Phase 3 gate.

```bash
bash /opt/admatix/scripts/dispatch-wp.sh \
  T \
  wp/t-validation \
  services/validation \
  docs/build/WP-T-validation.md \
  opus
```
