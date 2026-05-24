# CX-3 Head-to-Head Benchmark Repair

Date: 2026-05-23
Branch: `codex/cx3-headtohead-repair`
Final artifact: `docs/proof/artifacts/cx3-headtohead-summary.json`

## Summary

The original repair branch imported `services/benchmark/**` from
`origin/wp/headtohead-benchmark` and fixed the audit-failed proof surfaces:

- Added future-data leakage guards for buyer-visible snapshots and LLM prompts.
- Added tests that reject future-named fields and impossible future windows.
- Added explicit lane accounting for real LLM, deterministic fallback, failed,
  skipped, and policy rows.
- Added a hard `proof_readiness` gate. Fallback/skipped rows cannot satisfy the
  proof gate.
- Kept claim limits narrow: simulated benchmark evidence only, no live spend
  lift claim.

## Superseded Local Block

The first local branch run was correctly `BLOCKED` because it had
`real_llm_rows=0`. That was an input/environment block, not an accepted proof
result. It is superseded by the final real-LLM artifact below.

## Final Accepted Artifact

The accepted aggregate artifact is:

- Artifact id: `cx3_headtohead_real_llm`
- Source commit: `b8028a03aca6d46a6f582733fe0deb39635a43d3`
- Run id: `bench_2dfb070dd106`
- Status: `READY`
- Rows: `168`
- Decisions: `672`
- Real LLM rows: `28`
- Deterministic fallback rows: `0`
- Failed LLM rows: `0`
- Skipped LLM rows: `0`
- Proof readiness: `READY`
- Scale-up proposals: `1082`
- Scale-ups blocked by gate: `359`
- False scale-ups prevented: `189`

Head-to-head aggregate deltas:

| Comparison | Paired worlds | Mean net incremental value delta | Mean wasted spend delta | Mean true iROAS delta | Win rate |
| --- | ---: | ---: | ---: | ---: | ---: |
| B vs A | 42 | 1511.978955 | -1499.15 | 0.065039 | 0.738095 |
| D vs C | 42 | 401.616021 | -425.333333 | 0.020704 | 0.714286 |

## Claim Limit

This is real Claude subscription buyer evidence inside a simulated paid-media
benchmark. It is not live account proof and must not be described as proven
live spend lift.

## Verification Recorded During Branch Repair

```powershell
$env:PYTHONPATH='services/benchmark/src;services/simulator/src'
services\benchmark\.venv\Scripts\python.exe -m pytest services\benchmark\tests -q
```

Result: `42 passed`.

```powershell
pnpm -r typecheck
pnpm scan-secrets
```

Result: workspace typechecks completed and secret scan reported no
token-shaped secrets.
