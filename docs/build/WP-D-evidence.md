# WP-D — Evidence & detectors

**Owns:** `packages/evidence/**`
**Branch:** `wp/d-evidence` · **Wave:** 2 · **Depends on:** `@admatix/schemas`, `@admatix/core`
**Suggested agent:** Claude Code · **Size:** large

## Goal
The detectors that find paid-media problems, the H0 packet builder, and the audit
report. This is the heart of the "Plan" step. Every finding carries evidence refs and
an honest causal status.

## Files to create
- `packages/evidence/package.json` — `@admatix/evidence`, deps `@admatix/schemas`, `@admatix/core`.
- `packages/evidence/tsconfig.json`.
- `packages/evidence/src/index.ts` — public surface.
- `packages/evidence/src/detectors/tracking.ts` — missing UTM / sudden conversion drop.
- `packages/evidence/src/detectors/pacing.ts` — spend drift vs daily budget.
- `packages/evidence/src/detectors/budget-waste.ts` — spend spike with no conversion lift; high CAC.
- `packages/evidence/src/detectors/creative-fatigue.ts` — age / frequency / CTR-CVR decay.
- `packages/evidence/src/detectors/supply-path.ts` — MFA / low-viewability programmatic flags.
- `packages/evidence/src/h0-builder.ts` — `buildH0Packets()`.
- `packages/evidence/src/report.ts` — `runAudit()`.
- `packages/evidence/src/**/*.test.ts`.

## Contract
Implement the `@admatix/evidence` surface in `ARCHITECTURE-DEEP.md` §3. Hard rules:
- Each `Detector` is **pure**: `DetectorInput -> Finding[]`. No I/O.
- Every `Finding` carries at least one `EvidenceRef` and `causal_status:
  "directional_until_lift_test"` (platform attribution is never causal).
- `runAudit` aggregates findings, sums `total_estimated_waste`, and always appends the
  caveat: "Platform-reported metrics are directional, not causal."
- `buildH0Packets` emits one `H0Packet` per high/medium finding. Each packet has a
  hypothesis, a null hypothesis, guardrails, a `dry_run_only:true` proposal, a
  mandatory `rollback` block, and `approval.status:"pending"`.
- A detector may **never** emit an action or packet directly — it emits findings only.

## Acceptance tests
1. Each detector has one positive fixture and one negative fixture test.
2. `budget-waste` flags Campaign A in `agency-demo` (spend spike from 2026-05-18, flat conversions).
3. Every `Finding` from every detector has a non-empty `evidence` array.
4. `runAudit` on `agency-demo` yields 3-5 findings and a non-zero `total_estimated_waste`.
5. Every packet from `buildH0Packets` passes `H0Packet.parse` and contains a `rollback`.
6. No detector output mutates its input.

## Definition of Done
Acceptance tests pass + global DoD.

## Dispatch
Generic dispatch prompt, `<ID>=D`. Start once WP-B's `src/index.ts` is published.
