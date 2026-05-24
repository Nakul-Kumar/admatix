# CX-4 Backtests / Benchmarks Phase Report

Date: 2026-05-23
Branch: `codex/cx4-backtests-benchmarks`
Final artifact: `docs/proof/artifacts/cx4-backtests-summary.json`

## Scope

Implemented the public-dataset backtest track under `services/backtests/**`,
plus the backtest runbook and output ignore boundary. No raw datasets were
committed.

## Dataset Staging Used

- Hillstrom staged at `data/datasets/hillstrom/hillstrom.csv`.
  - Rows: 64,000 data rows.
  - CSV SHA-256: `0e5893329d8b93cefecc571777672028290ab69865718020c78c7284f291aece`.
- Criteo Uplift v2.1 staged at
  `data/datasets/criteo_uplift_v2.1/criteo-uplift-v2.1.csv`.
  - Full CSV rows: 13,979,592 data rows.
  - CSV SHA-256: `e4d7c710ca1f38e523309d0f8a0745d1b53e7392d51f20d1088b6cfeaef222ef`.

## Implementation Notes

- Added the `admatix_backtests` package with Hillstrom and Criteo runners, CLI,
  config loading, reference registry, deterministic bootstrap CIs, PNG plots,
  and JSON metrics serialization.
- Metrics JSON embeds dataset SHA, row counts, source references, license notes,
  seed/config, tolerances, and claim limits.
- Qini/AUUC values are deterministic in-harness references unless a later
  published-reference tolerance gate is added.
- Backtests use local read-only loaders and metric helpers. Raw data remains
  gitignored.

## Superseded Deferred Note

The initial branch report said the full Criteo gate was deferred. That is no
longer the accepted state. The final proof run completed the full Criteo and
Hillstrom gates and produced the artifact summarized below.

## Final Accepted Artifact

- Artifact id: `cx4_public_rct_backtests`
- Source commit: `7f9a185e1711e39b673d3008c7b8fb5a93549502`
- Status: `PASS`
- Slow pytest exit code: `0`
- Slow pytest completed at: `2026-05-23T22:20:01-04:00`

### Criteo Uplift v2.1

| Metric | Value |
| --- | ---: |
| Rows total | 13,979,592 |
| Sample rows | null, full dataset |
| Train rows | 6,989,911 |
| Test rows | 6,989,681 |
| Propensity AUC | 0.5 |

| Outcome | ATE estimate | 95% CI | AUUC | Qini | Status |
| --- | ---: | --- | ---: | ---: | --- |
| Visit | 0.010210954645717828 | [0.009799662796724999, 0.01059181874985] | 0.007486227057151881 | -14252.13734089829 | PASS |
| Conversion | 0.001139932268972325 | [0.00104124808775, 0.001237334597525] | 0.0016086782884141668 | -683.4170877879599 | PASS |

### Hillstrom

| Metric | Value |
| --- | ---: |
| Rows | 64,000 |
| Pooled AUUC | 0.06936074595323202 |

| Arm | ATE estimate | 95% CI | AUUC | Status |
| --- | ---: | --- | ---: | --- |
| Mens email | 0.07658956365153125 | [0.06996832282545, 0.0830195368057] | 0.08373360323310469 | PASS |
| Womens email | 0.045233106587052985 | [0.039239265590999994, 0.05142302521895] | 0.05498788867335935 | PASS |

## Claim Limit

This is aggregate public RCT/backtest evidence. It does not prove live spend
lift, and raw Criteo/Hillstrom rows must not be redistributed through the repo.
