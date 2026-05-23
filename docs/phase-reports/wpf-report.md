# WP-F — Agent Runtime & Orchestrator — Phase Report

**Branch:** `wp/f-agents` · **Status:** complete · **Date:** 2026-05-23

## What shipped

Implemented `@admatix/agents` per
[`docs/build/WP-F-agents.md`](../build/WP-F-agents.md) and the contract in
[`docs/architecture/ARCHITECTURE-DEEP.md`](../architecture/ARCHITECTURE-DEEP.md) §3 / §6.

The package ships the nine MVP agents and the `runWorkflow`
Plan → Activate → Measure → Reflect orchestrator as a deterministic rules
engine. No LLM call is required to run or demo it; the `Agent` interface
is LLM-ready so a reasoning layer can be added later behind the same
contract.

### Files

- `packages/agents/package.json` — `@admatix/agents`; deps on `@admatix/schemas`,
  `@admatix/core`, `@admatix/connectors`, `@admatix/evidence`, `@admatix/policy`.
- `packages/agents/tsconfig.json` — extends `../../tsconfig.base.json`.
- `packages/agents/src/index.ts` — public surface: `runWorkflow`, the nine
  factory functions, `Agent`, `buildAgents()`, `AGENT_IDS`, and the typed
  inputs/outputs of each agent.
- `packages/agents/src/agent.ts` — the uniform `Agent` interface.
- `packages/agents/src/types.ts` — `WorkflowIntent`, `WorkflowResult`.
- `packages/agents/src/orchestrator.ts` — `runWorkflow` wiring.
- `packages/agents/src/agents/orchestrator-agent.ts` — control: routes the loop.
- `packages/agents/src/agents/policy-guard-agent.ts` — control gate: wraps
  `evaluateAction` from `@admatix/policy`.
- `packages/agents/src/agents/evidence-ledger-agent.ts` — control gate: wraps
  `verifyEvidence` from `@admatix/policy`.
- `packages/agents/src/agents/approval-coordinator-agent.ts` — control:
  routes packets to `pending`/`rejected`/`not_required`.
- `packages/agents/src/agents/media-analyst-agent.ts` — intelligence: runs
  detectors and drafts H0 packets (delegates to `@admatix/evidence`; the
  evidence layer is injectable so the orchestrator runs against test
  fixtures while production detectors land in WP-D).
- `packages/agents/src/agents/measurement-scientist-agent.ts` — measurement:
  appends causal caveats, downgrades `causal_status` to
  `directional_until_lift_test`. Never approves its own packets.
- `packages/agents/src/agents/platform-adapter-agent.ts` — execution:
  translates an approved packet into a `ProposedAction`. Cannot invent
  action types — they come from the packet's `proposal`.
- `packages/agents/src/agents/diff-builder-agent.ts` — execution: builds a
  deterministic `dry_run: true` before/after diff. The schema literal
  enforces `dry_run` at compile time.
- `packages/agents/src/agents/reflection-agent.ts` — control: applies the
  trust-ledger algorithm (`ARCHITECTURE-DEEP.md` §5) and emits a next-plan
  note. Only writer of `trust_scores`; never rewrites evidence.
- `packages/agents/src/test-fixtures.ts` — internal test-only evidence
  shim mirroring `@admatix/evidence` exactly so the orchestrator can be
  exercised today against `data/fixtures/google_ads/demo_campaigns.json`.
- `packages/agents/src/orchestrator.test.ts` — the six WP-F acceptance
  tests plus a measurement-cannot-approve invariant.
- `packages/agents/src/agents/*.test.ts` — focused per-agent tests.

### Contract honoured

| Symbol | Where |
|---|---|
| `Agent` | `src/agent.ts` |
| `runWorkflow(intent, deps)` | `src/orchestrator.ts` |
| `WorkflowResult` | `src/types.ts` |
| `WorkflowIntent` | `src/types.ts` |
| `buildAgents(traceId)` (the nine MVP agents map) | `src/index.ts` |
| `AGENT_IDS` | `src/index.ts` |
| All nine `make*Agent` factories | `src/agents/*.ts` |

Every agent returns a schema-valid `AgentOutput` from `@admatix/schemas`;
every persisted run is a schema-valid `AgentRun`; every emitted event is
a schema-valid `AdmatixEvent`. The orchestrator validates with
`.parse()` at every boundary.

### Invariants enforced

- **MeasurementScientist cannot approve its own packets** — `review()`
  returns `proposed_actions: []` and downgrades `causal_status` to
  `directional_until_lift_test`. Verified by an explicit test.
- **PlatformAdapter cannot invent actions** — the `ProposedAction` is
  constructed by reading `packet.proposal.action`/`params` verbatim.
- **No platform writes** — every `ExecutionDiff` carries the schema
  literal `dry_run: true`; the orchestrator emits no write call. A static
  grep (AT5) walks `packages/agents/src/` for write-class verbs and
  finds zero matches.
- **Gates fail closed** — a packet missing evidence is blocked at the
  EvidenceLedger gate before it reaches activation; the budget-cap
  breach is blocked at the PolicyGuard gate before a diff is built.

### Adapter notes

`@admatix/policy`'s `emitEvent` writes to `events/<workflow_id>`, but
`@admatix/core`'s `Store.append` already prefixes `events/` and rejects
slashes in stream names. The orchestrator adapts in a small wrapper
(`eventStoreAdapter`) so the JSONL lands at the documented
`<rootDir>/events/<workflow_id>.jsonl` location without touching either
package.

## Acceptance tests — every WP-F-defined test is green

| # | Acceptance criterion | Test |
|---|---|---|
| AT1 | `runWorkflow` on `agency-demo` returns an `AuditReport`, ≥3 `H0Packet`s, and dry-run diffs | `orchestrator.test.ts > AT1` |
| AT2 | A budget-cap-breaching action appears in `WorkflowResult.blocked` with a reason | `orchestrator.test.ts > AT2` |
| AT3 | Every agent run is persisted with an input hash, output hash, and `trace_id` | `orchestrator.test.ts > AT3` |
| AT4 | The orchestrator rejects a packet that fails the EvidenceLedger gate | `orchestrator.test.ts > AT4` |
| AT5 | No code path calls a platform write — grep proves it | `orchestrator.test.ts > AT5` |
| AT6 | `runWorkflow` is deterministic on a fixed fixture | `orchestrator.test.ts > AT6` |

Additional per-agent coverage: PolicyGuardAgent (allow/block/needs-approval),
EvidenceLedgerAgent (ok / missing-evidence), ReflectionAgent (validated /
invalidated / blocked-unsafe trust math, all three tiers of the
`next_plan_note`), MeasurementScientistAgent (downgrade rule),
PlatformAdapterAgent + DiffBuilderAgent (action verbatim from packet,
diff `dry_run: true`).

## Verification output

### `pnpm -r typecheck`

```
Scope: 7 of 8 workspace projects
packages/schemas typecheck$ tsc -p tsconfig.json --noEmit
packages/schemas typecheck: Done
packages/connectors typecheck$ tsc -p tsconfig.json --noEmit
packages/evals typecheck$ tsc -p tsconfig.json --noEmit
packages/core typecheck$ tsc -p tsconfig.json --noEmit
packages/policy typecheck$ tsc -p tsconfig.json --noEmit
packages/policy typecheck: Done
packages/connectors typecheck: Done
packages/core typecheck: Done
packages/evals typecheck: Done
packages/evidence typecheck$ tsc -p tsconfig.json --noEmit
packages/evidence typecheck: Done
packages/agents typecheck$ tsc -p tsconfig.json --noEmit
packages/agents typecheck: Done
```

### `pnpm -r test` (workspace-wide via vitest from `packages/agents`)

```
 RUN  v2.1.9 /opt/admatix-wt/wpf

 ✓ packages/evals/src/baselines.test.ts                       (12 tests)  18ms
 ✓ packages/core/src/normalize.test.ts                        (12 tests)  11ms
 ✓ packages/policy/src/policy-guard.test.ts                   (14 tests)  17ms
 ✓ packages/evals/src/scorers.test.ts                          (9 tests)   8ms
 ✓ packages/agents/src/orchestrator.test.ts                    (7 tests) 253ms
 ✓ packages/evals/src/run-suite.test.ts                        (9 tests)  33ms
 ✓ packages/connectors/src/fixture-connector.test.ts           (8 tests)  53ms
 ✓ packages/policy/src/evidence-ledger.test.ts                 (7 tests)   6ms
 ✓ packages/core/src/store.test.ts                             (7 tests)  35ms
 ✓ packages/connectors/src/fixtures-valid.test.ts             (10 tests)  25ms
 ✓ packages/agents/src/agents/platform-adapter-agent.test.ts   (2 tests)   7ms
 ✓ packages/schemas/src/index.test.ts                          (5 tests)   7ms
 ✓ packages/policy/src/events.test.ts                          (4 tests)   7ms
 ✓ packages/core/src/impact.test.ts                            (6 tests)   7ms
 ✓ packages/agents/src/agents/evidence-ledger-agent.test.ts    (2 tests)   9ms
 ✓ packages/agents/src/agents/reflection-agent.test.ts         (3 tests)  11ms
 ✓ packages/agents/src/agents/policy-guard-agent.test.ts       (2 tests)  10ms
 ✓ packages/connectors/src/resolve-ref.test.ts                (10 tests)   7ms
 ✓ packages/core/src/hash.test.ts                              (5 tests)   7ms
 ✓ packages/core/src/id.test.ts                                (4 tests)   6ms

 Test Files  20 passed (20)
      Tests  138 passed (138)
   Duration  2.46s
```

### `pnpm scan-secrets`

```
scan-secrets: no token-shaped secrets found.
```

### Static AT5 grep (write-path denylist) — zero matches in production source.

## Definition of Done

- `pnpm -r typecheck` clean across the workspace.
- `pnpm -r test` green: 138/138 tests across 20 files.
- `pnpm scan-secrets` clean.
- `pnpm -r build` not run — no app or build script depends on emitted JS; the
  package consumes/exports `.ts` directly per the repo convention.
- Public API matches the `@admatix/agents` contract in `ARCHITECTURE-DEEP.md` §3.
- The six WP-F-defined acceptance tests are green.
- The "edit only files in this work package" constraint is honoured —
  the orchestrator works around the pre-existing
  `emitEvent`/`Store.append` mismatch via an adapter rather than touching
  `@admatix/policy` or `@admatix/core`.

## Notes for downstream work

- **WP-D landing** — `MediaAnalystAgent` accepts an injectable evidence
  layer (`deps.evidence`). The default is `@admatix/evidence`; the
  package's stubs currently throw. When WP-D lands the real detectors
  and packet builder, callers drop the `evidence` override and the
  orchestrator picks up the production layer with no changes. The test
  shim in `test-fixtures.ts` becomes useful only as a regression aid.
- **`emitEvent` / `Store.append` mismatch** — flagged in the
  Adapter Notes above. Worth a small follow-up PR against
  `@admatix/policy` (or `@admatix/core`) to resolve the prefix
  convention; the workaround in `orchestrator.ts` is intentionally
  small and labelled.
