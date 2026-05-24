# Public-Dataset Backtests Runbook

This runbook covers the CX-4 public RCT backtest readiness harness in
`services/backtests`.

## What This Proves

The harness checks that AdMatix can load the staged public randomized datasets,
compute deterministic RCT backtest metrics, and write audit-ready JSON/PNG
bundles with dataset SHA256, row counts, license notes, config, references, and
claim limits.

It does not prove production ad-account lift. The Criteo sample smoke run is a
readiness test. The full 13,979,592-row Criteo gate is wired, but should only be
claimed when `criteo_sample_rows` is `null` and the slow gate command has been
run to completion.

## Dataset Inputs

- Hillstrom: `data/datasets/hillstrom/hillstrom.csv`
  - Expected rows: 64,000 data rows.
  - Expected CSV SHA256: `0e5893329d8b93cefecc571777672028290ab69865718020c78c7284f291aece`.
  - License note: public challenge dataset; attribution to Kevin Hillstrom /
    MineThatData recommended.
- Criteo Uplift v2.1: `data/datasets/criteo_uplift_v2.1/criteo-uplift-v2.1.csv`
  - Expected rows: 13,979,592 data rows.
  - Expected CSV SHA256: `e4d7c710ca1f38e523309d0f8a0745d1b53e7392d51f20d1088b6cfeaef222ef`.
  - License note: CC BY-NC-SA 4.0; internal R&D / non-commercial benchmark use
    only; do not commit raw rows.

The local worktree already gitignores `data/datasets/` and
`services/backtests/output/`.

## Install

From the repo root:

```powershell
cd services/backtests
python -m pip install -e .
```

For no-install smoke work, set:

```powershell
$env:PYTHONPATH='src;..\uplift\src;..\ingest\src'
```

## Commands

Fast tests, excluding the full Criteo gate:

```powershell
cd services/backtests
python -m pytest -q -m "not slow"
```

Generate the Hillstrom metrics bundle:

```powershell
cd services/backtests
$env:PYTHONPATH='src;..\uplift\src;..\ingest\src'
python -m admatix_backtests hillstrom --config configs\hillstrom-default.json
```

Generate the Criteo 200k sample smoke metrics bundle:

```powershell
cd services/backtests
$env:PYTHONPATH='src;..\uplift\src;..\ingest\src'
python -m admatix_backtests criteo --config configs\criteo-sample.json
```

Full slow gate:

```powershell
cd services/backtests
$env:PYTHONPATH='src;..\uplift\src;..\ingest\src'
python -m pytest -q -m slow tests\test_phase4_gate_backtests.py
```

Do not claim the full Criteo gate passed unless the slow command exits 0.

## Output

Metrics and plots are written under `services/backtests/output/`:

- `hillstrom/metrics.json`
- `hillstrom/qini-mens_email.png`
- `hillstrom/qini-womens_email.png`
- `criteo/metrics.json`
- `criteo/qini-visit.png`
- `criteo/propensity-roc.png`

Each JSON includes:

- dataset SHA256
- row counts
- license note
- source reference URL and accessed date
- seed, bootstrap iterations, tolerances, sample setting
- claim limits

## Current Laptop Smoke Metrics

Generated on 2026-05-23 from this worktree.

Hillstrom default:

- Rows: 64,000.
- SHA256: `0e5893329d8b93cefecc571777672028290ab69865718020c78c7284f291aece`.
- Mens email visit ATE: `0.07658956365153125`; 95% bootstrap CI
  `[0.06996832282545, 0.0830195368057]`; CI excludes zero.
- Womens email visit ATE: `0.045233106587052985`; 95% bootstrap CI
  `[0.039239265590999994, 0.05142302521895]`; CI excludes zero.
- Result: `passes=true` for the readiness harness.

Criteo 200k deterministic treated/control smoke:

- Rows loaded: 200,000.
- Train/test rows: 100,564 / 99,436.
- SHA256: `e4d7c710ca1f38e523309d0f8a0745d1b53e7392d51f20d1088b6cfeaef222ef`.
- Propensity AUC: `0.5`.
- Visit ATE: `0.0027698489965807573`; 95% bootstrap CI
  `[0.0006549655077000004, 0.004641732919224999]`; CI excludes zero.
- Visit Qini estimate: `-31.24281232750305`; reference: same in-harness
  deterministic reference; relative delta `0.0`.
- Visit AUUC estimate: `0.0016762406926638823`; reference: same in-harness
  deterministic reference; relative delta `0.0`.
- Result: `passes=true` for the sample readiness harness.

## References

- Criteo Uplift v2.1 benchmark: https://arxiv.org/abs/2111.10106
- Hillstrom loader/schema reference:
  https://www.uplift-modeling.com/en/latest/api/datasets/fetch_hillstrom.html
- Dataset acquisition and license notes: `docs/build/DATASETS.md`
- Backtest criteria: `docs/architecture/SIMULATION-VERIFICATION.md` section 3.7
