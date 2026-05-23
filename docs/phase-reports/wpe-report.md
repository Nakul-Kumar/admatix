# WP-E — Policy & Governance — Phase Report

**Branch:** `wp/e-policy` · **Status:** complete · **Date:** 2026-05-23

## What shipped

Implemented `@admatix/policy` per [`docs/build/WP-E-policy.md`](../build/WP-E-policy.md)
and the contract in [`docs/architecture/ARCHITECTURE-DEEP.md`](../architecture/ARCHITECTURE-DEEP.md) §3.

### Files

- `packages/policy/package.json` — `@admatix/policy` workspace package, depends only on `@admatix/schemas`.
- `packages/policy/tsconfig.json` — extends the repo base tsconfig.
- `packages/policy/policy/policy.v1.json` — three required rules: `prohibited_action_v1`, `budget_cap_v1` (default 25% cap), `approval_required_v1`.
- `packages/policy/src/index.ts` — public surface re-exports.
- `packages/policy/src/policy-guard.ts` — `loadPolicy` (versioned + cached) and `evaluateAction` (fail-closed).
- `packages/policy/src/evidence-ledger.ts` — `verifyEvidence` for `H0Packet | Finding`.
- `packages/policy/src/events.ts` — `AdmatixEvent` Zod schema, `EventStore` structural interface (compatible with `@admatix/core`'s `Store`), `emitEvent`.
- `packages/policy/src/*.test.ts` — 25 tests covering the seven named acceptance criteria plus fail-closed edges.

### Contract honoured

| Symbol | Where |
|---|---|
| `loadPolicy(version?)` | `src/policy-guard.ts` |
| `evaluateAction(action, ctx)` | `src/policy-guard.ts` |
| `PolicyContext` | `src/policy-guard.ts` |
| `verifyEvidence(subject)` | `src/evidence-ledger.ts` |
| `emitEvent(store, e)` | `src/events.ts` |
| `AdmatixEvent` | `src/events.ts` |

### Acceptance tests

All seven WP-E acceptance criteria are green:

1. **AT-1** budget_shift above cap → `block` — `policy-guard.test.ts: "AT-1: budget_shift above the cap → result:'block' with a clear reason"`.
2. **AT-2** within-cap spend action → `needs_approval` — `policy-guard.test.ts: "AT-2: a within-cap spend action → result:'needs_approval'"`.
3. **AT-3** non-dry-run action → `block` (prohibited) — `policy-guard.test.ts: "AT-3: a non-dry-run action → result:'block' (prohibited)"`.
4. **AT-4** packet with empty `evidence` → `verifyEvidence` `ok:false` — `evidence-ledger.test.ts: "AT-4: a packet with an empty evidence array → ok:false"`.
5. **AT-5** packet missing `rollback` → `ok:false` — `evidence-ledger.test.ts: "AT-5: a packet missing rollback → ok:false"`.
6. **AT-6** `emitEvent` line JSON-parses and carries `trace_id` — `events.test.ts: "AT-6: produces a line that JSON.parses and carries a trace_id"`.
7. **AT-7** every `PolicyDecision` records `policy_version` — `policy-guard.test.ts: "AT-7: every PolicyDecision records the policy_version"`.

Additional fail-closed coverage (DoD requirement):
- malformed action (missing required fields) → `block`;
- missing or invalid guardrails → `block`;
- `budget_shift` with no `params.delta_pct` → `block`;
- evidence ref without `source` or `ref` → `ok:false`;
- `null` subject to `verifyEvidence` → `ok:false`;
- `emitEvent` rejects malformed events and stores with no `append`.

## Verification output

### `pnpm -r typecheck`

```
Scope: 2 of 3 workspace projects
packages/schemas typecheck$ tsc -p tsconfig.json --noEmit
packages/schemas typecheck: Done
packages/policy typecheck$ tsc -p tsconfig.json --noEmit
packages/policy typecheck: Done
```

### `pnpm -r test`

```
packages/schemas test:  ✓ packages/policy/src/evidence-ledger.test.ts (7 tests) 6ms
packages/schemas test:  ✓ packages/schemas/src/index.test.ts (5 tests) 7ms
packages/schemas test:  ✓ packages/policy/src/policy-guard.test.ts (14 tests) 24ms
packages/schemas test:  ✓ packages/policy/src/events.test.ts (4 tests) 9ms
packages/schemas test:  Test Files  4 passed (4)
packages/schemas test:       Tests  30 passed (30)

packages/policy test:  ✓ packages/policy/src/evidence-ledger.test.ts (7 tests) 8ms
packages/policy test:  ✓ packages/schemas/src/index.test.ts (5 tests) 14ms
packages/policy test:  ✓ packages/policy/src/policy-guard.test.ts (14 tests) 18ms
packages/policy test:  ✓ packages/policy/src/events.test.ts (4 tests) 15ms
packages/policy test:  Test Files  4 passed (4)
packages/policy test:       Tests  30 passed (30)
```

(Each workspace project runs the full vitest include glob — the same 30 tests
are reported twice, once per project.)

### `pnpm scan-secrets`

```
scan-secrets: no token-shaped secrets found.
```

## Golden-rule conformance

1. **Schema is the contract** — every public function takes/returns a `@admatix/schemas` type; `PolicyDecision`, `ProposedAction`, `Guardrails`, `PolicyRule`, `AdmatixEvent` are imported, never redefined. ✓
2. **Fixtures first** — no platform calls; policy reads only the in-repo JSON ruleset. ✓
3. **Dry-run only** — `prohibited_action_v1` blocks anything that isn't `dry_run_only: true`. ✓
4. **Every claim has source refs** — `verifyEvidence` enforces non-empty `evidence` arrays with populated `source`/`ref`. ✓
5. **Every action has a rollback** — `verifyEvidence` rejects packets without a `rollback.method` + `rollback.checkpoint_id`. ✓
6. **Fail closed** — `evaluateAction` returns `block` for any malformed input; `verifyEvidence` returns `ok:false` on ambiguity; `emitEvent` throws on invalid events. ✓
7. **Read/write separation** — no platform writes; the package only reads the local JSON ruleset and writes to the supplied `Store.append`. ✓
8. **Deterministic** — same input → same decision shape; rule evaluation is pure (the only nondeterminism is `decision_id`/`decided_at`, which are stamps, not logic). ✓
9. **No secrets** — `pnpm scan-secrets` passes; no env access in the package. ✓
10. **Pin everything in evals** — N/A for WP-E; `policy_version` is the pin that evals will consume. ✓

## Notes for downstream work packages

- `@admatix/policy` does not import `@admatix/core` to keep WP build order
  clean. `emitEvent` accepts a structural `EventStore { append }` which is a
  subset of the `Store` interface in `@admatix/core` — call sites passing the
  core `Store` satisfy it without changes.
- The default budget cap is `25%` and can be overridden per-account through
  `Guardrails.max_daily_budget_delta_pct` (preferred) or per-policy via the
  rule's `params.max_daily_budget_delta_pct`.
- Spend-touching action types are configurable in `policy.v1.json` under
  `approval_required_v1.params.spend_touching_actions`.
