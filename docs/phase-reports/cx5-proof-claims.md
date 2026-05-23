# CX-5 Proof Claims Report

Date: 2026-05-23
Branch: `codex/cx5-proof-claims`

## Scope

Added `docs/proof/CLAIMS-MATRIX.md`, a conservative claim-control artifact for
the proof package and YC narrative.

## Inputs Reviewed

- Local handoff: `AdMatix-Codex-Handoff-Plan.md`
- External audit: `admatix-deep-audit-2026-05-23.md`
- Architecture caveat: `docs/architecture/ARCHITECTURE-DEEP.md`
- Current local branches:
  - `codex/cx1-dashboard-live`
  - `codex/cx2-validation-redo`
  - `codex/cx3-headtohead-repair`
  - `codex/cx4-backtests-benchmarks`
  - `codex/cx7-prod-hygiene-ci`

## Decision

The allowed claim today is evidence-gated dry-run control plus simulator/public
dataset readiness. The project must not claim full Phase 4 proof, real LLM
buyer evidence, full Criteo recovery, or live spend lift yet.

## Verification

Commands run from the branch worktree:

```powershell
pnpm -r typecheck
pnpm scan-secrets
```

Both commands passed.
