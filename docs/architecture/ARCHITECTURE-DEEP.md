# AdMatix Deep Architecture

This is the integration backbone. It fixes the **contract between packages** so 4-6
agents can build in parallel without colliding. If a work package needs a contract
not defined here, it must be added here first (one PR, reviewed) — never invented
locally.

Companion docs: [`00-BUILD-ORCHESTRATION.md`](../build/00-BUILD-ORCHESTRATION.md),
[`/AGENTS.md`](../../AGENTS.md). The strategic rationale lives in the master plan
(`.handoff/clean-slate/reports/admatix_master_plan_2026-05-22.md`).

---

## 1. Principles

1. **The agent is untrusted.** It proposes; deterministic code disposes. No LLM output
   reaches a platform without passing PolicyGuard and EvidenceLedger.
2. **Few types, many runs.** ~9 agent *types* in the MVP. Scale is parallel *runs*, not
   more types. The evidence/policy layer is deterministic code, never an LLM.
3. **Everything is replayable.** Same fixture + same code + same policy → same output.
   Every run records input hash, output hash, and source refs.
4. **Fail closed.** PolicyGuard and EvidenceLedger are mandatory gates. On error or
   ambiguity they block, never allow.

---

## 2. The four-step loop and its artifacts

```
PLAN      account state ──> AuditReport ──> H0Packet[]            (evidence + agents)
ACTIVATE  H0Packet ──> ProposedAction ──> PolicyDecision ──> ExecutionDiff (dry-run)
MEASURE   H0Packet + new metrics ──> OutcomeMeasurement
REFLECT   OutcomeMeasurement ──> TrustScore update ──> next-plan note
```

Every artifact is a schema type from `@admatix/schemas`. No step may emit an
un-validated object; boundary functions call `.parse()` on input and output.

---

## 3. Package contract map

Each package exposes exactly the surface below from its `src/index.ts`. The
**interface-first commit** (Orchestration §3) publishes these signatures with stub
bodies so dependents typecheck immediately.

### `@admatix/core` — WP-B

```ts
// Persistence abstraction. MVP impl writes JSON/JSONL under data/. Swappable for Postgres.
export interface Store {
  put<T>(collection: string, id: string, value: T): Promise<void>;
  get<T>(collection: string, id: string): Promise<T | null>;
  list<T>(collection: string, filter?: Record<string, unknown>): Promise<T[]>;
  append(stream: string, record: unknown): Promise<void>; // JSONL event/trace streams
}
export function createStore(rootDir?: string): Store;

export function normalizeMetrics(
  rows: CampaignDailyMetric[],
  firstParty?: FirstPartyRevenueDaily[],
  opts?: { scope: "account" | "campaign"; window: string },
): NormalizedMetrics[];

export function computeImpact(current: NormalizedMetrics, baseline: NormalizedMetrics): {
  cac_delta_pct: number | null; recovered_waste: number; margin_adjusted_value: number;
};

export function sha256(value: unknown): string;       // stable hash of any JSON value
export function newId(prefix: string): string;        // e.g. newId("h0") -> "h0_<ulid>"
export function nowIso(): string;
```

### `@admatix/connectors` — WP-C

```ts
// All connectors are READ-ONLY in the MVP. No write methods exist.
export interface Connector {
  platform: Platform;
  listAccounts(): Promise<PlatformAccount[]>;
  getCampaigns(accountId: string): Promise<Campaign[]>;
  getCampaignDailyMetrics(accountId: string, window: string): Promise<CampaignDailyMetric[]>;
  getCreativeDailyMetrics(accountId: string, window: string): Promise<CreativeDailyMetric[]>;
  getFirstPartyRevenue(accountId: string, window: string): Promise<FirstPartyRevenueDaily[]>;
  healthCheck(): Promise<{ ok: boolean; detail: string }>;
}
export function fixtureConnector(platform?: Platform): Connector; // reads data/fixtures/
export function resolveAccountRef(ref: string): { kind: "fixture" | "live"; id: string };
```

### `@admatix/evidence` — WP-D

```ts
export interface DetectorInput {
  account: PlatformAccount;
  campaigns: Campaign[];
  metrics: NormalizedMetrics[];
  daily: CampaignDailyMetric[];
  firstParty: FirstPartyRevenueDaily[];
}
export type Detector = (input: DetectorInput) => Finding[];
export const detectors: Record<string, Detector>; // tracking, pacing, budgetWaste, creativeFatigue, supplyPath

export function runAudit(input: DetectorInput, window: string): AuditReport;
export function buildH0Packets(report: AuditReport, goal: string, tenantId: string): H0Packet[];
```

### `@admatix/policy` — WP-E

```ts
export function loadPolicy(version?: string): { version: string; rules: PolicyRule[] };
export function evaluateAction(action: ProposedAction, ctx: PolicyContext): PolicyDecision;
export interface PolicyContext { campaign?: Campaign; metrics?: NormalizedMetrics; guardrails: Guardrails; }

// EvidenceLedger: a packet/finding is only valid if every claim has a resolvable ref.
export function verifyEvidence(subject: H0Packet | Finding): { ok: boolean; missing: string[] };

// Observability — append-only trace; one JSONL stream per workflow.
export function emitEvent(store: Store, e: AdmatixEvent): Promise<void>;
export interface AdmatixEvent {
  ts: string; trace_id: string; workflow_id: string; step: WorkflowStep;
  agent_id: string; type: string; payload_hash: string; level: "info" | "warn" | "error";
}
```

### `@admatix/agents` — WP-F

```ts
export interface Agent { id: string; version: string; run(input: unknown): Promise<AgentOutput>; }
export const agents: Record<string, Agent>; // the 9 MVP agents (see §6)

export interface WorkflowResult {
  workflow_id: string; trace_id: string;
  audit: AuditReport; packets: H0Packet[];
  diffs: ExecutionDiff[]; decisions: PolicyDecision[];
  blocked: { action_id: string; reason: string }[];
}
export function runWorkflow(intent: {
  accountRef: string; goal: string; tenantId: string;
}, deps: { store: Store }): Promise<WorkflowResult>;
```

### `@admatix/evals` — WP-I

```ts
export interface Scorer { id: string; score(task: BenchmarkTask, output: unknown): Partial<BenchmarkResult>; }
export const baselines: Record<string, (task: BenchmarkTask) => unknown>; // noop, agencyRule
export function runSuite(suite: string, deps: { store: Store }): Promise<BenchmarkRun>;
```

Apps (`cli`, `mcp-server`, `api`, `web`) consume the above and expose **no new domain
types** — they are thin surfaces over `runWorkflow`, `runAudit`, and `runSuite`.

---

## 4. The Store and the data layout

The MVP persists to the filesystem behind the `Store` interface so Postgres can be
dropped in later with zero call-site changes.

```
data/
  fixtures/        # bronze — immutable inputs, committed
  events/<workflow_id>.jsonl   # append-only trace (emitEvent)
  state/<collection>/<id>.json # gold — packets, diffs, receipts, runs, trust
  benchmarks/safety-v1/        # frozen benchmark tasks
```

Collections: `h0_packets`, `proposed_actions`, `execution_diffs`, `approval_receipts`,
`rollback_checkpoints`, `outcome_measurements`, `agent_runs`, `trust_scores`,
`audit_reports`, `benchmark_runs`.

---

## 5. The trust ledger algorithm

Trust is a number in `[0,1]` per agent/skill/connector, starting at `0.50`. It rises
slowly on validated outcomes and decays fast on invalidated ones — losing trust must
be cheaper than gaining it.

```
on VALIDATED outcome:    score := score + (1 - score) * 0.15
on INVALIDATED outcome:  score := score - score * 0.30
on a blocked unsafe act: score := score - score * 0.50   (hard penalty)
```

Autonomy tier derived from the score (MVP keeps a human on every spend action
regardless — the tier only controls how much review the cockpit demands):

| Score | Tier | Behaviour |
| --- | --- | --- |
| `< 0.40` | propose-only | findings shown, no action proposals surfaced |
| `0.40-0.75` | gated | proposes actions; full human review required |
| `> 0.75` | trusted | proposes actions; cockpit pre-fills approval, human still signs |

`ReflectionAgent` is the only writer of `trust_scores`. It may only append outcomes —
it can never rewrite historical evidence.

---

## 6. Agent execution model

The 9 MVP agents and their gate role:

| Agent | Layer | Can propose | Can execute | Notes |
| --- | --- | --- | --- | --- |
| `OrchestratorAgent` | control | no | no | routes Plan→Activate→Measure→Reflect |
| `PolicyGuardAgent` | control | no | no | mandatory gate; wraps `evaluateAction` |
| `EvidenceLedgerAgent` | control | no | no | mandatory gate; wraps `verifyEvidence` |
| `ApprovalCoordinatorAgent` | control | no | no | manages pending approvals |
| `MediaAnalystAgent` | intelligence | yes (H0) | no | runs detectors, drafts packets |
| `MeasurementScientistAgent` | measurement | no | no | validates evidence strength, causal caveats |
| `PlatformAdapterAgent` | execution | no | dry-run only | deterministic; builds the diff |
| `DiffBuilderAgent` | execution | no | no | deterministic before/after diff |
| `ReflectionAgent` | control | yes (next plan) | no | updates trust, appends outcomes |

Hard rules enforced by the orchestrator: channel/intelligence agents cannot execute;
measurement agents cannot approve their own hypotheses; adapter agents cannot invent
actions, only translate approved diffs; reflection cannot rewrite evidence.

MVP agents are a **deterministic rules engine** — no LLM call is required to build or
demo. The `Agent` interface is LLM-ready so reasoning can be added later behind the
same contract.

---

## 7. H0 packet lifecycle

```
draft ──verifyEvidence ok?──> validated ──> pending_approval
  │ (no/missing refs)             │              │ ApprovalReceipt
  └──> rejected_invalid           │         ┌────┴────┐
                                  │      approved   rejected
                                  │         │
                                  │   activate --dry-run
                                  │         │
                                  │   ExecutionDiff (dry_run: true)
                                  │         │
                                  └────> measured ──> reflected
```

A packet that fails `verifyEvidence` or lacks a `rollback` block never reaches
`pending_approval`. In the MVP every transition stops at `ExecutionDiff` — there is no
live mutation path in the codebase at all.

---

## 8. Security model

- **No raw PII to LLMs.** User-level identifiers are hashed (`sha256`) before any
  prompt. The MVP rules engine sends nothing to an LLM.
- **Tokens never logged.** OAuth tokens live only in `.env.local`, never in events,
  traces, or `raw` fields. `scan-secrets` runs in CI and pre-PR.
- **Provenance on every import.** Each fixture/import file is stored with source,
  timestamp, and content hash.
- **Least privilege.** Connectors expose read methods only; there is no write method
  on the `Connector` interface to call.
- **MCP is read-only.** Write-like tools return dry-run diffs; no tool can mutate a
  platform. Unknown tool fields are rejected by Zod.

---

## 9. What is explicitly out of scope for the MVP

Live platform writes; real OAuth connector flows; multi-tenant auth; an LLM in the
agent loop; Postgres; a queue; causal-lift claims. All are post-application work and
must not appear in the MVP code paths. The `Store` and `Agent` interfaces are designed
so each can be added later without breaking a contract above.
