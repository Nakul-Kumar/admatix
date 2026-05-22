# WP-E — Policy & governance

**Owns:** `packages/policy/**`
**Branch:** `wp/e-policy` · **Wave:** 1 · **Depends on:** `@admatix/schemas`
**Suggested agent:** Codex · **Size:** medium

## Goal
The two mandatory gates — PolicyGuard and EvidenceLedger — plus the policy config and
the append-only observability event log. These fail closed: on error or ambiguity they
block, never allow.

## Files to create
- `packages/policy/package.json` — `@admatix/policy`, dep `@admatix/schemas`.
- `packages/policy/tsconfig.json`.
- `packages/policy/src/index.ts` — public surface.
- `packages/policy/src/policy-guard.ts` — `loadPolicy()`, `evaluateAction()`.
- `packages/policy/src/evidence-ledger.ts` — `verifyEvidence()`.
- `packages/policy/src/events.ts` — `emitEvent()` + the `AdmatixEvent` type.
- `packages/policy/policy/policy.v1.json` — the rule set.
- `packages/policy/src/*.test.ts`.

## Contract
Implement the `@admatix/policy` surface in `ARCHITECTURE-DEEP.md` §3. `policy.v1.json`
rules at minimum:
- `budget_cap` — block when a `budget_shift` exceeds `max_daily_budget_delta_pct`.
- `approval_required` — any spend-touching action returns `needs_approval`.
- `prohibited_action` — any non-dry-run / write action is blocked outright.
`evaluateAction` returns a `PolicyDecision` with `result`, `matched_rules`, `reasons`,
`risk_level`, and the `policy_version`. `verifyEvidence` returns `ok:false` with the
list of `missing` refs when a packet/finding has an unresolvable or empty evidence ref,
or when an `H0Packet` lacks a `rollback`. `emitEvent` appends one JSON line per event.

## Acceptance tests
1. A `budget_shift` above the cap → `result:"block"` with a clear reason.
2. A within-cap spend action → `result:"needs_approval"`.
3. A non-dry-run action → `result:"block"` (prohibited).
4. A packet with an empty `evidence` array → `verifyEvidence` `ok:false`.
5. A packet missing `rollback` → `verifyEvidence` `ok:false`.
6. `emitEvent` produces a line that `JSON.parse`s and carries a `trace_id`.
7. Every `PolicyDecision` records the `policy_version`.

## Definition of Done
Acceptance tests pass + global DoD. Gates fail closed — verified by a test that feeds
malformed input and asserts `block`.

## Dispatch
Generic dispatch prompt, `<ID>=E`.
