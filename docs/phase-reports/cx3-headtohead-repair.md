# CX3 Head-to-Head Benchmark Repair

Date: 2026-05-23
Branch: `codex/cx3-headtohead-repair`
Scope: `services/benchmark/**` plus this report.

## Summary

Imported `services/benchmark/**` from `origin/wp/headtohead-benchmark` as the
input branch, then repaired the audit-failed proof surfaces:

- Added future-data leakage guards for buyer-visible snapshots and LLM prompts.
- Added tests that reject future-named fields and impossible future windows.
- Added explicit LLM lane accounting for real LLM, deterministic fallback,
  failed, skipped, and policy rows.
- Added a hard `proof_readiness` gate. Phase 5 proof claims require
  `real_llm_rows > 0`; fallback/skipped rows cannot satisfy the gate.
- No-data arms and unpaired head-to-head comparisons serialize as `null`,
  not `0.0`, so missing evidence cannot be misread as measured zero effect.
- Kept claim limits narrow: calibrated simulator/public RCT proof only, no live
  spend lift claim.

## Local Result

The local regenerated `services/benchmark/results/scorecard.json` is
`BLOCKED`, not proof-ready:

- `real_llm_rows`: 0
- `deterministic_fallback_rows`: 1
- `failed_llm_rows`: 0
- `skipped_llm_rows`: 0
- `proof_readiness.status`: `BLOCKED`
- Blocking reason: `requires_nonzero_real_llm_rows`

This means a real provider-authenticated LLM row still requires operator
credentials/access in the local environment.

## Verification

Commands run:

```powershell
$env:PYTHONPATH='services/benchmark/src;services/simulator/src'
services\benchmark\.venv\Scripts\python.exe -m pytest services\benchmark\tests -q
```

Result: `42 passed`.

```powershell
pnpm -r typecheck
```

Result: all 11 workspace project typechecks completed successfully.

```powershell
pnpm scan-secrets
```

Result: `scan-secrets: no token-shaped secrets found.`
