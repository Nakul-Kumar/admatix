# CX-4 Backtests / Benchmarks Phase Report

Date: 2026-05-23
Branch: `codex/cx4-backtests-benchmarks`
Worker: CX-4 backtests/benchmarks

## Scope

Implemented the public-dataset backtest readiness track under
`services/backtests/**`, plus the backtest runbook and output ignore boundary.
No raw datasets were committed.

## Changed Files

- `.gitignore`
- `services/backtests/**`
- `docs/runbooks/backtests.md`
- `docs/phase-reports/cx4-backtests-benchmarks.md`

## Dataset Staging Used

- Hillstrom staged at `data/datasets/hillstrom/hillstrom.csv`.
  - Rows: 64,000 data rows.
  - CSV SHA256: `0e5893329d8b93cefecc571777672028290ab69865718020c78c7284f291aece`.
- Criteo Uplift v2.1 staged at
  `data/datasets/criteo_uplift_v2.1/criteo-uplift-v2.1.csv`.
  - Full CSV rows: 13,979,592 data rows.
  - CSV SHA256: `e4d7c710ca1f38e523309d0f8a0745d1b53e7392d51f20d1088b6cfeaef222ef`.
  - Smoke path uses a deterministic 200,000-row treated/control sample because
    the CSV is ordered and a naive head sample contains no control rows.

## Implementation Notes

- Added `admatix_backtests` package with Hillstrom and Criteo runners, CLI,
  config loading, reference registry, deterministic bootstrap CIs, PNG plots,
  and JSON metrics serialization.
- Metrics JSON embeds dataset SHA, row counts, source references, license notes,
  seed/config, tolerances, and claim limits.
- The Criteo full gate remains available via the slow pytest marker and
  `configs/phase4-gate.json`.
- Backtests use local read-only loaders and metric helpers to avoid importing
  WP-U package root in environments where WP-U's placebo TestClient dependency
  (`httpx`) is not installed. The schema and dataset paths match WP-U/WP-P.

## Current Smoke Metrics

Hillstrom default run:

- Rows: 64,000.
- Mens email visit ATE: `0.07658956365153125`; CI
  `[0.06996832282545, 0.0830195368057]`.
- Womens email visit ATE: `0.045233106587052985`; CI
  `[0.039239265590999994, 0.05142302521895]`.
- Readiness result: `passes=true`.

Criteo 200k sample run:

- Rows loaded: 200,000.
- Train/test rows: 100,564 / 99,436.
- Propensity AUC: `0.5`.
- Visit ATE: `0.0027698489965807573`; CI
  `[0.0006549655077000004, 0.004641732919224999]`.
- Visit Qini: `-31.24281232750305`.
- Visit AUUC: `0.0016762406926638823`.
- Readiness result: `passes=true`.

## Full Criteo Gate

Deferred locally. The full 13.98M-row Criteo gate was not run in this session.

Exact command:

```powershell
cd services/backtests
$env:PYTHONPATH='src;..\uplift\src;..\ingest\src'
python -m pytest -q -m slow tests\test_phase4_gate_backtests.py
```

Do not treat the Criteo full-dataset tolerance gate as passed until that command
exits 0 and the resulting `output/criteo/metrics.json` reports
`criteo_sample_rows=null` and `rows_total=13979592`.

## Verification

Completed:

- `python -m pytest -q -m "not slow"` from `services/backtests`: 9 passed.
- `python -m pytest -q -m "not slow"` from `services/uplift`: 11 passed.
- `pnpm -r typecheck`: passed after `pnpm install` restored missing
  `node_modules`.
- `pnpm scan-secrets`: passed; no token-shaped secrets found.

Notes:

- A combined root-level pytest invocation over both Python services hits a
  duplicate `tests.conftest` import-path collision, so the services were
  verified separately.
- Full Criteo gate was deferred; see the exact command above.
