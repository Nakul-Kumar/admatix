# CX-2 Validation Redo Report

Date: 2026-05-23
Branch: `codex/cx2-validation-redo`
Scope: `services/validation/**`, `docs/runbooks/validation.md`, and this report.

## Summary

The WP-T validation harness was re-imported from `origin/wp/t-validation` as an
audit-failed input, then patched so the production validation paths call the
production verifier entry point in-process: `admatix_verifier.app.verify(req)`.
Coverage, RMSE/bias, and multi-seed now record
`diagnostics.verifier_entrypoint` in every JSONL row.

## Audit Findings

- The old coverage, RMSE/bias, and multi-seed code duplicated verifier method
  dispatch over `admatix_verifier.methods.*`, bypassing `verify()`.
- The SBC path used a bespoke model-consistent simulator-shaped CSV generator.
  This remains documented as reference Bayesian SBC only; it is not claimed as
  production simulator-to-verifier validation.
- The old default/gate coverage grids omitted `zero_lift_placebo` and the
  robustness worlds currently present on `main`.
- No hidden pytest skips or xfails were present. A new contract test guards that.

## Changes

- Added `run_production_verifier()` in `services/validation/src/admatix_validation/grids.py`.
- Patched coverage, RMSE/bias, and multi-seed to materialize worlds through
  `admatix_simulator.generate_world()` and verify through
  `admatix_verifier.app.verify()`.
- Normalized validation request paths as absolute paths for the verifier loader,
  avoiding a Windows `file:///%3F...` long-path URI failure.
- Expanded `coverage-default.json` and `phase4-gate.json` to include
  `clean_ab`, `confounded`, `geo_structured`, `zero_lift_placebo`,
  `non_stationary`, `cross_campaign_interference`, and
  `adversarial_misspecified`.
- Added `test_production_integration.py` and `test_config_contract.py`.

## Verification

| Command | Result |
| --- | --- |
| `py -3.12 -m venv services\validation\.venv` | Pass |
| `services\validation\.venv\Scripts\python -m pip install -r services\validation\requirements.txt -r services\verifier\requirements.txt` | Pass |
| `$env:PYTHONPATH='services/validation/src;services/simulator/src;services/verifier/src'; services\validation\.venv\Scripts\python -m pytest services/validation/tests/test_config_contract.py services/validation/tests/test_production_integration.py -q` | Pass: 5 passed |
| `$env:PYTHONPATH='services/validation/src;services/simulator/src;services/verifier/src'; services\validation\.venv\Scripts\python -m pytest services/validation/tests -q -m "not slow"` | Pass: 16 passed |
| `$env:PYTHONPATH='services/simulator/src;services/verifier/src;services/ingest/src'; services\validation\.venv\Scripts\python -m pytest services/verifier/tests services/ingest/tests services/simulator/tests -q` | Pass: 83 passed |
| `pnpm install --frozen-lockfile` | Pass; needed because `node_modules` was absent |
| `pnpm -r typecheck` | Pass |
| `pnpm scan-secrets` | Pass: no token-shaped secrets found |
| `$env:PYTHONPATH='services/validation/src;services/simulator/src;services/verifier/src'; services\validation\.venv\Scripts\python -m pytest services/validation/tests/test_phase4_gate_calibration.py -q -m slow` | Blocked locally: timed out after 904 seconds |

## Machine-Readable Smoke Artifacts

These artifacts are gitignored under `services/validation/output/`.

| Harness | Artifact | Result |
| --- | --- | --- |
| Coverage tiny | `services/validation/output/cli-coverage-tiny/coverage/metrics.json` | `n_worlds=5`, `empirical_coverage=0.8`, `passes_nominal=false`, `per_method.cate_meta_learner.coverage=0.8` |
| RMSE/bias tiny | `services/validation/output/cli-rmse-tiny/rmse_bias/metrics.json` | `n_worlds=10`, `passes_bias=false`, `passes_rmse=false`; clean_ab bias `-0.0090924173`, RMSE `0.021866434`; confounded bias `-0.0095119728`, RMSE `0.018230114` |
| Multi-seed tiny | `services/validation/output/cli-multiseed-tiny/multiseed/metrics.json` | `n_configs=1`, `passes=false`, CV `0.4352667557`, verdict stability `0.4` |

These smoke artifacts intentionally report failures where the configured
threshold is not met. No threshold was lowered and no pass flag was forced.

## Limitations

- The slow Phase 4 gate did not complete in this local Windows worktree within
  15 minutes after robustness worlds were included. It must be rerun on the
  intended VPS/Linux environment with enough wall-clock budget before WP-T is
  called green.
- The tiny artifacts prove machine-readable output and the production verifier
  path, but they do not satisfy the >=1000-world coverage gate or
  >=500-simulation SBC gate.
- SBC remains a reference Bayesian-model validation path. Production verifier
  methods are assessed through coverage, RMSE/bias, and multi-seed runs.
