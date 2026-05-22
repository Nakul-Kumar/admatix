# WP-F — Agent runtime & orchestrator

**Owns:** `packages/agents/**`
**Branch:** `wp/f-agents` · **Wave:** 2 · **Depends on:** schemas, core, evidence, policy, connectors
**Suggested agent:** Claude Code · **Size:** large

## Goal
The 9 MVP agents and the orchestrator that runs the Plan → Activate → Measure →
Reflect loop. The runtime is a **deterministic rules engine** — no LLM call is
required to build or demo. The `Agent` interface is LLM-ready for later.

## Files to create
- `packages/agents/package.json` — `@admatix/agents`, deps: schemas, core, connectors, evidence, policy.
- `packages/agents/tsconfig.json`.
- `packages/agents/src/index.ts` — public surface.
- `packages/agents/src/orchestrator.ts` — `runWorkflow()`.
- `packages/agents/src/agents/` — nine files: `orchestrator-agent.ts`, `policy-guard-agent.ts`,
  `evidence-ledger-agent.ts`, `approval-coordinator-agent.ts`, `media-analyst-agent.ts`,
  `measurement-scientist-agent.ts`, `platform-adapter-agent.ts`, `diff-builder-agent.ts`,
  `reflection-agent.ts`.
- `packages/agents/src/**/*.test.ts`.

## Contract
Implement the `@admatix/agents` surface in `ARCHITECTURE-DEEP.md` §3 and §6. Each
agent returns a schema-valid `AgentOutput`. The orchestrator:
1. Resolves the account via a `Connector`, normalizes via `@admatix/core`.
2. `MediaAnalystAgent` runs `runAudit` + `buildH0Packets`.
3. For each packet: `EvidenceLedgerAgent` gate → `MeasurementScientistAgent` adds
   causal caveats → `PolicyGuardAgent` gate → `DiffBuilderAgent` + `PlatformAdapterAgent`
   produce a dry-run `ExecutionDiff`.
4. `ReflectionAgent` updates `TrustScore` per the algorithm in `ARCHITECTURE-DEEP.md` §5.
5. Persist an `AgentRun` for every agent run; `emitEvent` for every step.
Enforced invariants: measurement agents cannot approve their own packets; adapter
agents cannot invent actions; nothing writes to a platform.

## Acceptance tests
1. `runWorkflow` on `agency-demo` returns an `AuditReport`, ≥3 `H0Packet`s, and dry-run diffs.
2. A budget-cap-breaching action appears in `WorkflowResult.blocked` with a reason.
3. Every agent run is persisted with an input hash, output hash, and `trace_id`.
4. The orchestrator rejects a packet that fails the EvidenceLedger gate.
5. No code path calls a platform write — grep proves it.
6. `runWorkflow` is deterministic on a fixed fixture.

## Definition of Done
Acceptance tests pass + global DoD.

## Dispatch
Generic dispatch prompt, `<ID>=F`. Start against published interfaces; implement as B/C/D/E land.
