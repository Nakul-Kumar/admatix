# Runbook: `services/validation` (WP-T)

The validation harness measures whether the simulator and verifier are
calibrated, stable, and reproducible at population scale. Every harness writes
JSON, JSONL, and PNG artifacts that a reviewer can rerun from a clean shell.

## What Lives Here

- `src/admatix_validation/sbc.py`: Simulation-Based Calibration for the PyMC reference Bayesian CATE model.
- `src/admatix_validation/coverage.py`: empirical 95% CI coverage.
- `src/admatix_validation/rmse_bias.py`: point-estimate RMSE and bias.
- `src/admatix_validation/multiseed.py`: multi-seed variance and verdict stability.
- `src/admatix_validation/grids.py`: simulator materialisation plus the in-process production verifier call.
- `src/admatix_validation/reference_models/pymc_cate.py`: the reference Bayesian model used for SBC only. It is not a production verifier method.

Coverage, RMSE/bias, and multi-seed call `admatix_verifier.app.verify(req)`
directly. They do not duplicate the verifier selector or method dispatch.

## Install

Linux/macOS:

```bash
cd services/validation
python3.12 -m venv .venv
. .venv/bin/activate
pip install --upgrade pip uv
uv pip compile requirements.txt -o requirements.lock
uv pip sync requirements.lock
pip install -e ../simulator -e ../verifier
```

Windows PowerShell from the repo root:

```powershell
py -3.12 -m venv services\validation\.venv
services\validation\.venv\Scripts\python -m pip install --upgrade pip
services\validation\.venv\Scripts\python -m pip install `
  -r services\validation\requirements.lock `
  -r services\verifier\requirements.txt
$env:PYTHONPATH = "services/validation/src;services/simulator/src;services/verifier/src"
services\validation\.venv\Scripts\python -m pytest services/validation/tests -q -m "not slow"
```

Do not install the verifier top-level requirements together with an older
validation lock in a single resolver transaction. The committed lock is
Windows-safe and uses plain `uvicorn` so the proof gate does not attempt to
build Linux-only `uvloop` on Windows.

If dependency resolution changes, record the exact resolved versions in the
phase report. Do not change the WP-T thresholds to make a local run pass.

## Run

```bash
# Fast lane: smoke, determinism, production-path, and config-contract tests.
pytest -q -m "not slow"

# Slow gate path.
pytest -q -m slow tests/test_phase4_gate_calibration.py
bash scripts/run-phase4-calibration.sh

# Direct CLI use.
python -m admatix_validation sbc       --config configs/sbc-default.json
python -m admatix_validation coverage  --config configs/coverage-default.json
python -m admatix_validation rmse-bias --config configs/rmse-default.json
python -m admatix_validation multiseed --config configs/multiseed-default.json
python -m admatix_validation all       --config configs/phase4-gate.json
```

Each subcommand prints JSON to stdout. Exit code is 0 only when the harness
pass flag is true. `verifier_method` must stay `"auto"` for production-path
validation; forced method overrides are rejected because they bypass the
production selector.

## Artifacts

| Path | Meaning |
| --- | --- |
| `<output_dir>/sbc/metrics.json` | `SbcResult`: rank histogram, chi-square p-value, shape diagnostic, pass flag, reference model, config hash. |
| `<output_dir>/sbc/rank_histogram.png` | Rank histogram with a uniform reference band. |
| `<output_dir>/sbc/draws.jsonl` | One row per SBC simulation. |
| `<output_dir>/coverage/metrics.json` | `CoverageResult`: empirical coverage, the `[0.93, 0.97]` band, pass flag, per-method breakdown. |
| `<output_dir>/coverage/runs.jsonl` | One `WorldRun` per simulator config and seed. |
| `<output_dir>/coverage/coverage_curve.png` | Coverage by world type. |
| `<output_dir>/rmse_bias/metrics.json` | `RmseBiasResult`: bias, RMSE, true lift mean, and pass flags per world type. |
| `<output_dir>/rmse_bias/table.md` | Markdown table for the proof report. |
| `<output_dir>/multiseed/metrics.json` | `MultiSeedResult`: CV and verdict-stability by config hash. |

Coverage, RMSE/bias, and multi-seed `runs.jsonl` rows include
`diagnostics.verifier_entrypoint == "admatix_verifier.app.verify"`.

Artifacts live under `services/validation/output/` by default and are
gitignored. The harness does not write to the warehouse or database.

## Gate Thresholds

| Harness | Pass band |
| --- | --- |
| SBC | chi-square uniformity p-value `> 0.05` on at least 500 simulations, with no systematic U-shaped or inverted-U shape. |
| CI coverage | empirical 95% coverage in `[0.93, 0.97]` on at least 1000 worlds; `< 0.93` is release-blocking and `> 0.98` is flagged for review. |
| RMSE and bias | confounded bias within `0.10 * abs(true_lift)`, clean A/B bias within `0.05 * abs(true_lift)`, and RMSE within `0.25 * true_lift` at default `n_users`. |
| Multi-seed | coefficient of variation `<= 0.15` and verdict stability `>= 0.90`. |

## World Coverage

The default coverage config and Phase 4 gate config cover all simulator world
families present on `main`: `clean_ab`, `confounded`, `geo_structured`,
`zero_lift_placebo`, `non_stationary`, `cross_campaign_interference`, and
`adversarial_misspecified`. Robustness worlds are measured, not silently
excluded; failures remain visible in the output metrics.

## SBC Caveat

SBC applies to Bayesian estimators. The production verifier uses frequentist
methods for BSTS/CATE/OPE/geo paths, so WP-T SBC validates the PyMC reference
Bayesian CATE model only. The reference model uses a model-consistent generator
inside `reference_models/pymc_cate.py`.

Coverage, RMSE/bias, and multi-seed use `admatix_simulator.generate_world()`
unchanged and then call the production verifier entry point.

## Determinism

`tests/test_determinism.py` verifies byte-identical `metrics.json` and
`runs.jsonl` for repeated coverage, RMSE/bias, and multi-seed runs with the
same `ValidationConfig`. PyMC SBC is seeded, but platform-level floating point
rounding can vary in the last digits; the gate tests uniformity rather than
byte-identical posterior samples.
