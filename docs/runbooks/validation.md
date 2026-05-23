# Runbook — `services/validation` (WP-T)

The research-grade validation harness that proves the verifier (WP-R) is
correct, calibrated, and stable at population scale. Every figure and
metric below is persisted as a reproducible artifact a technical reviewer
can re-run from a clean shell.

## What lives here

- `src/admatix_validation/sbc.py` — Simulation-Based Calibration
  (SIMULATION-VERIFICATION §3.1).
- `src/admatix_validation/coverage.py` — empirical 95% CI coverage
  (§3.2).
- `src/admatix_validation/rmse_bias.py` — point-estimate RMSE + bias
  (§3.3).
- `src/admatix_validation/multiseed.py` — multi-seed variance (§3.6).
- `src/admatix_validation/reference_models/pymc_cate.py` — the small PyMC
  reference Bayesian-CATE estimator the SBC harness ranks ground truth
  within. **Not** a production verifier method.
- `configs/*.json` — defaults for each harness; `phase4-gate.json` is the
  bundled config the Phase 4 gate test (`test_phase4_gate_calibration.py`)
  runs end-to-end.

## Install (from a clean shell)

```bash
cd services/validation
python3.12 -m venv .venv
. .venv/bin/activate
pip install --upgrade pip uv

# Resolve a deterministic lock from requirements.txt. CI installs only
# from the lock.
uv pip compile requirements.txt -o requirements.lock
uv pip sync requirements.lock

# Install the sibling editable packages on top of the locked tree.
# These are local-path requirements; `uv pip compile` cannot resolve
# them against PyPI so we add them after the sync.
pip install -e ../simulator -e ../verifier
```

If `uv pip compile` cannot resolve `simuk` or `pymc` against the
verifier's pinned `numpy 2.1` / `pandas 2.2` / `scipy ≥1.14,<1.17` stack
(the WP-R lock had to widen `scipy`'s upper bound; same risk applies
here), record the deviation in the WP-T phase report following the WP-R
precedent — pin the actual resolved versions, keep the lock reproducible,
and assert SBC still passes the §3.1 bands on the smoke fixture. If a
deviation would *change* a §3 threshold (lower the SBC sim count, widen
the coverage band, etc.), STOP and escalate — those numbers are the
gate, and changing them defeats the purpose of WP-T.

## Run each harness

```bash
# Fast lane (the six smoke tests). ≤ 60 s on the VPS.
pytest -q -m "not slow"

# The slow gate path. ~10 minutes on the VPS.
pytest -q -m slow tests/test_phase4_gate_calibration.py
# Equivalent wrapper:
bash scripts/run-phase4-calibration.sh

# Direct CLI use against any config:
python -m admatix_validation sbc       --config configs/sbc-default.json
python -m admatix_validation coverage  --config configs/coverage-default.json
python -m admatix_validation rmse-bias --config configs/rmse-default.json
python -m admatix_validation multiseed --config configs/multiseed-default.json
python -m admatix_validation all       --config configs/phase4-gate.json
```

Each subcommand prints the result summary as JSON to stdout. Exit code
is 0 iff the harness's pass flag (`passes_uniformity` /
`passes_nominal` / etc.) is True.

## What each output is

| Path | Meaning |
| --- | --- |
| `<output_dir>/sbc/metrics.json` | The `SbcResult` dataclass, json-serialised. Contains `rank_histogram`, `chi2_statistic`, `chi2_p_value`, `shape_diagnostic`, `passes_uniformity`, `reference_model`, `config_hash`. |
| `<output_dir>/sbc/rank_histogram.png` | The arviz-style rank histogram with the uniform band overlay. Used to eyeball ∪/∩ shape. |
| `<output_dir>/sbc/draws.jsonl` | One row per SBC simulation: `seed`, `prior_draw`, `rank_bin`, `posterior_mean`. |
| `<output_dir>/coverage/metrics.json` | The `CoverageResult` dataclass. Contains `empirical_coverage`, the `[0.93, 0.97]` gate band, `passes_nominal`, and a `per_method` breakdown. |
| `<output_dir>/coverage/runs.jsonl` | One `WorldRun` per (config, seed) — the row JSONL coverage iterates. Byte-stable under the same input. |
| `<output_dir>/coverage/coverage_curve.png` | Empirical coverage broken out by world type. |
| `<output_dir>/rmse_bias/metrics.json` | The `RmseBiasResult`. `per_world_type` contains `bias`, `rmse`, `true_lift_mean`, `passes_bias`, `passes_rmse` per world type. |
| `<output_dir>/rmse_bias/table.md` | Markdown table for the Phase 5 proof report. |
| `<output_dir>/multiseed/metrics.json` | The `MultiSeedResult`. `cv_of_estimate` and `verdict_stability` keyed by `config_hash` per cell in `world_grid`. |

## Gate thresholds (locked from `SIMULATION-VERIFICATION.md`)

| Harness | Section | Pass band |
| --- | --- | --- |
| SBC | §3.1 | χ² goodness-of-fit p > 0.05 on ≥ 500 simulations *and* no systematic ∪/∩ shape. |
| CI coverage | §3.2 | Empirical 95% coverage ∈ **[0.93, 0.97]** on ≥ 1000 worlds. < 0.93 = release-blocking; > 0.98 = flag-for-review. |
| RMSE + bias | §3.3 | Confounded: `|mean(est − true)| ≤ 0.10·|true_lift|`. Clean A/B: `|bias| ≤ 0.05·|true_lift|`. RMSE ≤ `0.25·true_lift` at default `n_users`; RMSE shrinks toward the floor as `n_users` grows. |
| Multi-seed | §3.6 | CV(estimate) ≤ 0.15 on every config; verdict-stability ≥ 0.90. |

## Interpreting a §3.1 shape diagnostic

The rank histogram is the SBC ground truth. Under correct inference,
ranks are uniform across [0, n_bins). Three deviations matter:

- **∪-shape (`u_shaped`)** — the posterior is too narrow (overconfident);
  ground truth ends up in the tails too often. Often a sign that the
  prior is too tight or the inference is under-spreading.
- **∩-shape (`n_shaped`)** — the posterior is too wide (underconfident);
  ground truth lands in the middle bins too often.
- **Skewed** — the posterior is biased on one side. Often a sign the
  model is misspecified relative to the data-generating process.

The shape classifier compares the middle third of bin counts to the mean
of the outer thirds; a ≥ 35% difference flips the diagnostic away from
`uniform`. The χ²-p value gates uniformity independent of shape — both
must clear for `passes_uniformity == True`.

## Honest caveat — what SBC validates vs. what CI coverage validates

SBC strictly applies to **Bayesian** estimators. The production verifier
(WP-R) uses `statsmodels.UnobservedComponents` (frequentist Kalman
state-space) for BSTS and a frequentist DML for CATE. We therefore SBC
the **PyMC reference Bayesian-CATE estimator** declared in
`reference_models/pymc_cate.py` — it is **not** a production method; it
is the well-specified Bayesian model SBC validates. The frequentist
production methods are validated by the §3.2 CI-coverage test instead,
which makes no Bayesian-inference assumption.

The reference model's data-generating process (logistic outcome, prior
`γ ~ N(0, 0.05)`) is the one SBC's `simulate_world_from_prior` produces;
the simulator's additive `p1 = p0 + W·τ` model is approximately — but
not exactly — equivalent at small `γ`. We use the model-consistent
generator inside `reference_models/pymc_cate.py` so SBC ranks are
uniform by construction. Every other harness (coverage, RMSE, multi-seed)
uses `admatix_simulator.generate_world` unchanged.

## Determinism

The reproducibility floor (PROOF-WAVE-MASTER-PLAN §2 + AGENTS.md rule 8):
re-running `run_coverage`, `run_rmse_bias`, or `run_multiseed_variance`
with the same `ValidationConfig` produces byte-identical `metrics.json`
and `runs.jsonl`. Verified by `tests/test_determinism.py`.

SBC determinism is approximate: PyMC sampling is reproducible given the
same `random_seed`, but `pytensor`/`aesara`'s compiled graphs may emit
floats with platform-dependent rounding in the last few significant
digits. The smoke test asserts structural determinism only; the gate
test asserts uniformity, not byte-equivalence.

## Where the artifacts live in the repo

Validation artifacts live under `services/validation/output/` and are
gitignored. They are NOT part of the warehouse and there is NO database
write — every byte the harness produces is a JSON, JSONL, or PNG file
under `output_dir`. The Phase 5 proof report consumes these artifacts
directly.
