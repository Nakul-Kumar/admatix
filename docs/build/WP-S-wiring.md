# WP-S — Wire `MeasurementScientistAgent` → verifier; add `admatix.verify` MCP tool

**Owns:** `packages/agents/src/verifier-client.ts`,
edits to `packages/agents/src/agents/measurement-scientist-agent.ts`,
edits to `packages/agents/src/orchestrator.ts`,
edits to `packages/agents/src/index.ts`,
`apps/mcp-server/src/tools/verify.ts`,
edits to `apps/mcp-server/src/server.ts`,
`tests/e2e/phase3-gate.test.ts`,
`docs/runbooks/measurement-to-verifier.md`
**Branch:** `wp/s-wiring` · **Phase:** 3 · **Wave:** 3
**Depends on:** WP-R (`services/verifier`) merged on `main`. Also depends on the
Phase 2 data layer (WP-L migrations, WP-M Store on Supabase) and the Phase 3
Wave 1 simulator (WP-Q), all already on `main`.
**Suggested agent:** Claude Code Opus 4.7 · **Size:** medium

## Why this exists

WP-R built the independent verifier as a standalone FastAPI service; WP-S is the
work package that **uses** it. It teaches `MeasurementScientistAgent` to call the
verifier over HTTP, persists the returned `{estimate, ci_low, ci_high, method,
causal_status, verdict, confounders}` into `app.outcome_measurements`, emits a
matching tamper-evident `ledger.action_events` row of type `measurement`, and
adds the read-shaped `admatix.verify` MCP tool so any agent (Claude, Codex,
Gemini, a custom LangGraph agent) can fetch that verdict through the MCP
surface. The Phase 3 gate — *a simulated agent proposes a change → AdMatix
gates it → logs it → the verifier independently grades it* — is the named
acceptance test in this WP.

## Required reading (in this order)

1. `docs/build/WP-R-verifier.md` — the verifier's public surface (HTTP routes,
   `VerifyRequest`/`VerifyResponse` shape, the seven canonical fields). WP-S
   consumes this contract; it does not extend it.
2. `docs/architecture/PROOF-WAVE-MASTER-PLAN.md` §4.2 (the polyglot boundary —
   the TS side talks to the Python side **only** through `/verify` JSON and the
   Postgres database), §4.3 (the MCP tool catalog: `admatix.verify` is in the
   read class), §6.2 (the verifier mandate). The Phase 3 gate is the table row
   at the end of §9.
3. `docs/architecture/SIMULATION-VERIFICATION.md` §2.7 — the FastAPI request /
   response shape WP-S round-trips.
4. `docs/architecture/ARCHITECTURE-DEEP.md` §3 (`@admatix/agents` public
   surface), §6 (the 9-agent runtime; `MeasurementScientistAgent` is the only
   measurement-class agent and **cannot approve its own packets**), §7 (the
   H0 packet lifecycle: `measured` is the post-activate, pre-reflected state
   WP-S writes into).
5. `packages/agents/src/agents/measurement-scientist-agent.ts` — the current
   stub. WP-S extends it without changing the deterministic-rules-engine
   guarantee (still no LLM call required to run the demo).
6. `packages/agents/src/orchestrator.ts` lines ~200–235 — where
   `measurementScientist.review` is called today. WP-S threads the verifier
   client through `WorkflowDeps` and persists the verifier response at the
   `step: "measure"` event.
7. `apps/mcp-server/src/server.ts` and `apps/mcp-server/src/tools/show-h0-packet.ts`
   — the existing MCP tool registration pattern (read-only annotations,
   `ToolResultEnvelope`, `trace_id`, `source_refs`). WP-S mirrors this exactly
   for `verify`.
8. `docs/build/AUTONOMOUS-WAVE-PLAN.md` Phase 3 row — the WP-S one-line scope
   and the Phase 3 gate.
9. `AGENTS.md` — the ten golden rules. The two that bind WP-S: (6) `PolicyGuard`
   and `EvidenceLedger` are mandatory gates and the verifier never replaces
   them; (7) read tools and write tools are separate — `admatix.verify` is in
   the read class and may not directly mutate state. Side-effects (persistence
   into `app.outcome_measurements`, emit into `ledger.action_events`) happen
   inside the orchestrator workflow path, never inside the MCP tool handler.

## Public surface

The build agent implements **exactly** the signatures below.

### `packages/agents/src/verifier-client.ts` (new)

```ts
export interface VerifierClientOptions {
  /** Base URL of the verifier service, e.g. http://127.0.0.1:8088 */
  baseUrl: string;
  /** Optional fetch implementation; defaults to globalThis.fetch. */
  fetch?: typeof globalThis.fetch;
  /** Max ms before /verify is considered failed. Default 30_000. */
  timeoutMs?: number;
}

export interface VerifierClient {
  healthz(): Promise<{ status: "ok"; version: string; libs: Record<string, string> }>;
  verify(req: VerifyRequestPayload): Promise<VerifyResponsePayload>;
}

export function createVerifierClient(opts: VerifierClientOptions): VerifierClient;

/** TypeScript mirror of the Python Pydantic VerifyRequest from WP-R. */
export interface VerifyRequestPayload {
  packet: {
    packet_id: string;
    tenant_id: string;
    account_ref: string;
    goal: string;
    hypothesis: string;
    causal_status: "heuristic" | "directional_until_lift_test" | "experimental" | "causal";
    guardrails: Record<string, unknown>;
    evidence_refs: string[];
  };
  data_uri: string;
  metadata_uri?: string;
  action_log_uri?: string;
  hint?: { design?: string; [k: string]: unknown };
}

/** TypeScript mirror of the Python Pydantic VerifyResponse from WP-R. */
export interface VerifyResponsePayload {
  estimate: number | null;
  ci_low: number | null;
  ci_high: number | null;
  method:
    | "guardrail_only"
    | "bsts_synthetic_control"
    | "cate_meta_learner"
    | "geo_synthetic_control"
    | "ope_ips_snips_dr";
  causal_status:
    | "heuristic"
    | "directional_until_lift_test"
    | "experimental"
    | "causal"
    | "inconclusive";
  verdict: "lift_detected" | "no_effect" | "inconclusive";
  confounders: string[];
  ci_level: number;
  guardrail_proof: {
    all_pass: boolean;
    rules: { rule_id: string; predicate: string; inputs: Record<string, unknown>; pass: boolean }[];
  };
  diagnostics: Record<string, unknown>;
  rejected_methods: { method: string; reason: string }[];
  packet_id: string;
  tx_id: string;
}
```

The client validates inbound responses with Zod at the boundary (per
`AGENTS.md` rule on schema-validated cross-package types). The Zod schema is
defined in `verifier-client.ts` only — `packages/schemas/**` stays frozen.

### `packages/agents/src/agents/measurement-scientist-agent.ts` (edit)

```ts
export interface MeasurementScientistDeps {
  verifierClient?: VerifierClient;        // optional; absent → behaves as today
}

export interface MeasurementScientistInput {
  packet: H0Packet;
  metricsForEntity?: NormalizedMetrics;
  /** When supplied, the agent calls the verifier and threads the result
   *  through `output.warnings` + `result.verification`. Required for the
   *  Phase 3 gate path. */
  verifyInput?: {
    data_uri: string;
    metadata_uri?: string;
    action_log_uri?: string;
    hint?: { design?: string };
  };
}

export interface MeasurementScientistResult {
  output: AgentOutput;
  packet: H0Packet;
  caveats: string[];
  verification?: VerifyResponsePayload;   // present iff verifierClient + verifyInput were both supplied
}

export function makeMeasurementScientistAgent(opts: {
  traceId: string;
  deps?: MeasurementScientistDeps;        // NEW
}): {
  agent: Agent;
  review(input: MeasurementScientistInput): Promise<MeasurementScientistResult>;
};
```

Behaviour added:
- When `opts.deps.verifierClient` AND `input.verifyInput` are both present, the
  agent calls `verifierClient.verify(...)` exactly once. The returned
  `causal_status` overrides the packet's downgrade rule (`inconclusive` from
  the verifier maps to `directional_until_lift_test` on the packet — the
  packet schema's allowed values are unchanged; the verifier's verdict is
  carried in `result.verification`, not by mutating the packet beyond the
  existing rule).
- The verifier call **never** approves a packet, never bypasses
  `PolicyGuard`/`EvidenceLedger`, and never produces a `ProposedAction`. It
  only annotates.
- Network/timeout failures append a `verifier_unavailable:<reason>` caveat
  and the agent returns its existing pre-verifier output. The workflow does
  not crash on a verifier outage.

### `packages/agents/src/orchestrator.ts` (edit)

```ts
export interface WorkflowDeps {
  store: Store;
  connector?: Connector;
  evidence?: MediaAnalystDeps;
  /** When supplied, MeasurementScientist calls the verifier, the response is
   *  persisted into the `outcome_measurements` collection, and an
   *  `AdmatixEvent` of type `measurement.verified` is appended with the
   *  payload hash. */
  verifierClient?: VerifierClient;        // NEW
  /** When supplied, the orchestrator passes this URI as the verifier's
   *  `data_uri` for each H0 packet. Used by the Phase 3 E2E test to point at
   *  a simulator world without forcing a connector dep. */
  postPeriodDataUriFor?: (packet: H0Packet) => {
    data_uri: string;
    metadata_uri?: string;
    action_log_uri?: string;
    hint?: { design?: string };
  } | null;                               // NEW
}
```

After the existing `measurementScientist.review` call at the `step: "measure"`
point in the loop, when `verifierClient` is set the orchestrator:

1. Maps the verifier response into an `OutcomeMeasurement` row (the schema
   already exists in `@admatix/schemas` — re-use; do not extend).
2. Persists it via `store.put("outcome_measurements", measurement_id, row)`.
3. Emits a `measurement.verified` event with the canonicalised verifier
   payload hash, so the ledger chain (Phase 2) extends by one row.
4. Threads the verifier's `verdict` into the `ReflectionAgent` outcome —
   `lift_detected → "validated"`, `no_effect → "invalidated"`, `inconclusive →`
   no trust update (a no-op for the trust ledger).

### `apps/mcp-server/src/tools/verify.ts` (new)

```ts
import { z } from "@admatix/schemas";
import {
  getPacketOrThrow, okEnvelope, refsFromEvidence, traceFor,
  type ToolContext, type ToolResultEnvelope,
} from "./common.js";
import type { VerifierClient, VerifyResponsePayload } from "@admatix/agents";

export const VerifyInputSchema = z.object({
  packet_id: z.string(),
  data_uri: z.string(),
  metadata_uri: z.string().optional(),
  action_log_uri: z.string().optional(),
  hint: z.object({ design: z.string().optional() }).partial().optional(),
}).strict();
export type VerifyInput = z.infer<typeof VerifyInputSchema>;

export async function verifyTool(
  input: VerifyInput,
  ctx: ToolContext & { verifierClient: VerifierClient },
): Promise<ToolResultEnvelope<VerifyResponsePayload>> {
  const parsed = VerifyInputSchema.parse(input);
  const packet = await getPacketOrThrow(ctx.store, parsed.packet_id);
  const response = await ctx.verifierClient.verify({
    packet: {
      packet_id: packet.packet_id,
      tenant_id: packet.tenant_id,
      account_ref: packet.account_ref,
      goal: packet.goal,
      hypothesis: packet.hypothesis,
      causal_status: packet.causal_status,
      guardrails: packet.guardrails ?? {},
      evidence_refs: packet.evidence.map((e) => `${e.source}:${e.ref}`),
    },
    data_uri: parsed.data_uri,
    metadata_uri: parsed.metadata_uri,
    action_log_uri: parsed.action_log_uri,
    hint: parsed.hint,
  });
  return okEnvelope({
    trace_id: packet.trace_id || traceFor("verify", parsed),
    source_refs: refsFromEvidence(packet.evidence),
    risk_level: "low",
    data: response,
  });
}
```

The tool is **read-shaped**:
- It does not write to the store.
- It does not emit a `ledger.action_events` row.
- It does not move a packet through its lifecycle.
- The verifier's persistence side-effects only happen on the
  orchestrator-driven path (`runWorkflow`), never on a direct MCP call.

### `apps/mcp-server/src/server.ts` (edit)

Add `"verify"` to `APPROVED_TOOL_NAMES`. Extend `AdmatixMcpDeps` with an
optional `verifierClient?: VerifierClient`. When that dep is set, register the
`verify` tool with the same read-only annotations and envelope pattern the
other tools use; when it is absent, the tool is **not** registered (the MCP
server stays fully functional without a verifier present — this keeps Phase 1
demos unaffected).

### Build-time helper (`scripts/`)

- `scripts/start-verifier.sh` — boots the verifier from
  `services/verifier` (`uvicorn admatix_verifier.app:app --port 8088
  --host 127.0.0.1 &`), polls `/healthz` until ready, prints the PID to
  stdout, and writes it to `/tmp/admatix-verifier.pid`. Used by the E2E test
  setup and by the runbook.
- `scripts/stop-verifier.sh` — kills the PID at `/tmp/admatix-verifier.pid`.

## Files this WP creates

- `packages/agents/src/verifier-client.ts` — the HTTP client + Zod boundary
  validator described above.
- `packages/agents/src/verifier-client.test.ts` — unit tests for the client
  (HTTP mocked via `msw` or a small in-process `fetch` stub; the WP must not
  pull in heavyweight HTTP mocking deps unnecessarily).
- `apps/mcp-server/src/tools/verify.ts` — the MCP tool handler.
- `apps/mcp-server/src/tools/verify.test.ts` — unit tests for the handler
  (verifier client mocked).
- `tests/e2e/phase3-gate.test.ts` — the named Phase 3 gate test (§ Acceptance
  test 8 below).
- `tests/e2e/fixtures/phase3-world/` — placeholder directory; the test
  materialises a `clean_ab` world there at runtime via
  `services/simulator` (no committed binary data).
- `scripts/start-verifier.sh`, `scripts/stop-verifier.sh` — the boot helpers.
- `docs/runbooks/measurement-to-verifier.md` — operator runbook: how to start
  the verifier locally (`scripts/start-verifier.sh`), how `runWorkflow`
  picks it up via `WorkflowDeps.verifierClient`, how to call `admatix.verify`
  from the MCP server, how to read the persisted `OutcomeMeasurement` row +
  the matching `ledger.action_events` entry, and how to recover from a
  verifier outage.

## Files this WP edits (small, targeted)

- `packages/agents/src/agents/measurement-scientist-agent.ts` — add the
  optional `verifierClient` dep and the call path described in § Public
  surface.
- `packages/agents/src/orchestrator.ts` — add `verifierClient` +
  `postPeriodDataUriFor` to `WorkflowDeps`; thread the verifier call,
  persistence, event emit, and reflection mapping at the existing
  `step: "measure"` point.
- `packages/agents/src/index.ts` — export `createVerifierClient`, the
  `VerifierClient` type, `VerifyRequestPayload`, and `VerifyResponsePayload`.
- `apps/mcp-server/src/server.ts` — add `"verify"` to `APPROVED_TOOL_NAMES`,
  extend `AdmatixMcpDeps`, and register the new tool when
  `deps.verifierClient` is present.

## Files this WP MUST NOT touch

- `packages/schemas/**` — the frozen contract. The existing `H0Packet`,
  `OutcomeMeasurement`, `AgentOutput`, `ProposedAction`, `PolicyDecision`,
  `ApprovalReceipt`, and `RiskLevel` schemas already cover this work. If a
  field truly does not exist, open a schemas PR before this WP — do not
  redefine a type locally.
- `services/verifier/**`, `services/simulator/**`, `services/ingest/**` —
  owned by WP-R / WP-Q / WP-P. WP-S boots the verifier from this directory
  (`scripts/start-verifier.sh`) but never edits its source.
- `warehouse/**` — the data layer is finished in Phase 2. WP-S writes into
  `app.outcome_measurements` and `ledger.action_events` through the existing
  `Store` interface; it does not add migrations, dbt models, or marts.
- `packages/core/**`, `packages/connectors/**`, `packages/evidence/**`,
  `packages/policy/**`, `packages/evals/**`, `packages/ui/**`,
  `apps/cli/**`, `apps/api/**`, `apps/web/**` — unchanged. The only TS edits
  WP-S makes are the four files listed under § Files this WP edits.
- `/opt/admatix/.build/secrets.env` — never read from the e2e test or the
  MCP tool path. The verifier base URL is supplied via dependency injection
  (`createVerifierClient({ baseUrl })`), not from a global env var.

## Acceptance tests

Each test is named, and the last item is the Phase 3 gate contribution. All
tests run under `pnpm exec turbo run test --concurrency=1` (the existing
serial harness).

1. **`verifier-client.test.ts` — happy path.** With a stub `fetch` that returns
   a well-formed `VerifyResponse`, `createVerifierClient({...}).verify(req)`
   resolves to a value whose seven canonical fields are typed correctly. A
   missing required field on the wire causes the Zod boundary validator to
   throw with a clear, actionable error (rule: errors say what failed and
   how to fix it).
2. **`verifier-client.test.ts` — outage.** With a `fetch` that throws / times
   out / returns 500, the client surfaces a typed `VerifierError` whose
   `.reason` is one of `network` | `timeout` | `http_5xx` | `bad_response`.
3. **`measurement-scientist-agent.test.ts` — verifier annotates, does not
   approve.** With `verifierClient` supplied and a `verifyInput` pointing at a
   `clean_ab` simulator world, `review(...)` returns a `MeasurementScientistResult`
   whose `verification.verdict === "lift_detected"` and `verification.ci_low ≤
   ground_truth.ate ≤ verification.ci_high`. The returned `packet.state` is
   unchanged (no implicit approval); `output.proposed_actions === []`;
   `output.blocked_actions === []`.
4. **`measurement-scientist-agent.test.ts` — placebo round-trip.** Same shape
   on a `zero_lift_placebo` world; asserts
   `verification.verdict in {"no_effect","inconclusive"}` and the agent's
   `caveats` include the verifier's verdict tag.
5. **`measurement-scientist-agent.test.ts` — verifier outage degrades
   gracefully.** With a `verifierClient` that throws, the agent returns its
   pre-verifier output unchanged plus a `verifier_unavailable:<reason>`
   caveat. The orchestrator path (mocked) does not crash and the H0 packet
   remains in `pending_approval`.
6. **`verify.test.ts` (MCP tool).** A `TestClient` of the MCP server with a
   mocked `verifierClient` calls the `verify` tool with `{packet_id, data_uri}`,
   receives a `ToolResultEnvelope` with `status === "ok"`, `risk_level === "low"`,
   `source_refs` populated from the persisted packet's evidence refs, and a
   `data` field whose seven canonical fields match the mocked response. A
   second call asserts: the tool **did not** call `store.put` on any
   collection, did not call `store.append` on the event stream, and the
   ledger row count is unchanged — proving the tool is read-shaped.
7. **`verify.test.ts` (MCP tool) — capability gate.** Calling the tool with
   an `approval_receipt` field (or any other write-class field) is rejected
   by Zod with a strict-mode error. The tool also rejects a `packet_id` that
   does not resolve in the store.
8. **`phase3-gate.test.ts` (Phase 3 gate contribution).** End-to-end:
   - Boot the real `services/verifier` via `scripts/start-verifier.sh`;
     assert `GET /healthz` returns 200.
   - Materialise a `clean_ab` world with `services/simulator`
     (`n_users=2000, true_lift=0.04, seed=17, noise_sd=0.0`).
   - Construct a `WorkflowIntent` against a fixture account; call
     `runWorkflow(intent, { store, verifierClient,
     postPeriodDataUriFor: () => ({ data_uri: <world file URI> }) })`.
   - Assert: at least one H0 packet was produced, EvidenceLedger and
     PolicyGuard both ran (their events are in the workflow's event stream
     in the documented order: `evidence.ok` → `policy.allow` →
     `diff.built` → `measurement.verified`), the `ExecutionDiff` is
     `dry_run: true` (no mutation), and exactly one
     `OutcomeMeasurement` row was persisted whose `estimate, ci_low,
     ci_high, method, verdict` round-trip the verifier's response
     unchanged.
   - Assert: `ledger.action_events` (as exposed by the `Store`) has a new
     row of `event_type = "measurement"` whose `payload_hash` matches the
     canonicalised `OutcomeMeasurement`. The chain extends by exactly one
     `seq`. `scripts/db/verify-ledger-chain.ts` exits 0 after the test.
   - Assert: `verdict === "lift_detected"` and `ci_low ≤ 0.04 ≤ ci_high`
     on the recorded `OutcomeMeasurement` row.
   - Cleanup runs `scripts/stop-verifier.sh` regardless of test outcome.
   - **This is the named Phase 3 gate test.** When green, the Phase 3 gate
     is closed: the simulator emits worlds with hidden known truth, the
     verifier returns estimate + CI + method + verdict over HTTP, and the
     end-to-end loop — *simulated agent proposes → AdMatix gates → logs →
     verifier independently grades → verdict round-trips into the
     ledger* — runs.

## Verification commands

The build agent runs **exactly** the sequence below at the end of the work
package, from the worktree root.

```bash
# 1. Verifier is already merged on main; install its lock into a venv the
#    e2e test will boot from.
cd services/verifier
python3.12 -m venv .venv
. .venv/bin/activate
pip install --upgrade pip
pip install -r requirements.lock
cd ../..

# 2. TypeScript surface compiles and tests pass (this is the main suite)
pnpm install
pnpm -r typecheck
pnpm exec turbo run test --concurrency=1

# 3. Verifier sibling tests still pass (WP-S must not regress them)
. services/verifier/.venv/bin/activate
pytest services/verifier -q
pytest services/ingest services/simulator -q

# 4. Phase 3 gate test — run it in isolation to confirm the e2e path is green
pnpm exec vitest run tests/e2e/phase3-gate.test.ts

# 5. Ledger chain is intact end-to-end after the e2e write path
pnpm tsx scripts/db/verify-ledger-chain.ts

# 6. Secret scan
pnpm scan-secrets
```

All six commands exit 0 before WP-S is considered green.

## Out of scope

- New schemas. `H0Packet`, `OutcomeMeasurement`, and friends already exist in
  `packages/schemas`. If the verifier surfaces a field WP-S genuinely needs to
  persist that has no schema home, open a schemas PR before this WP — do not
  redefine a type locally.
- Authentication on the verifier's HTTP endpoints. The verifier runs on the
  same VPS network as the agent runtime; cross-host auth is post-application
  work.
- An LLM in the measurement loop. `MeasurementScientistAgent` stays a
  deterministic rules engine; the verifier is the deterministic-grader half
  of the gate.
- The Phase 4 research-grade validation harness (`services/validation`) — SBC,
  full CI-coverage band, RMSE/bias tables, multi-seed variance, Criteo
  back-test, Qini at scale. That is WP-T, dispatched after Phase 3 closes.
- Adding additional MCP tools beyond `admatix.verify` (e.g. `admatix.simulate`,
  `admatix.replay`). Those are future work and not part of the Phase 3 gate.
- A write-class tool that takes an approval receipt and triggers a real
  platform mutation. The MVP rule holds: read tools and write tools are
  separate, and there is **no** write tool in the codebase this wave.
- Cockpit / API changes. `apps/api` and `apps/web` may surface the new
  `OutcomeMeasurement` rows via existing read paths; no UI work is required
  by this WP.

## Definition of Done

All eight acceptance tests pass, the six verification commands exit 0, the
Phase 3 gate test (§ Acceptance 8) is green on `main` after merge, the runbook
is accurate (a reviewer can follow it from a clean shell, start the verifier,
run the workflow, and read the persisted `OutcomeMeasurement` + the matching
ledger row), and a fresh clone reproduces the end-to-end loop. With WP-S
merged, **the Phase 3 gate is closed.**

## Dispatch

Generic dispatcher, `<ID>=S`, model `opus`. Run in Phase 3 Wave 3, after WP-R
is merged to `main`.

```bash
bash /opt/admatix/scripts/dispatch-wp.sh \
  S \
  wp/s-wiring \
  packages/agents \
  docs/build/WP-S-wiring.md \
  opus
```
