# MeasurementScientist → Verifier — operator runbook

**Scope:** WP-S wiring — how to boot the independent verifier locally,
let `MeasurementScientistAgent` call it inside `runWorkflow`, read the
persisted `OutcomeMeasurement` + the matching ledger event, drive the
`admatix.verify` MCP tool, and recover from a verifier outage.

The verifier itself (FastAPI service, five method modules) is owned by
WP-R; this runbook only covers the WP-S agent-side path.

---

## 1. One-time setup — the verifier's Python venv

The verifier ships its own pinned `requirements.lock`. Create the venv
once per machine:

```bash
cd services/verifier
python3.12 -m venv .venv
. .venv/bin/activate
pip install --upgrade pip
pip install -r requirements.lock
cd ../..
```

This venv is read by `scripts/start-verifier.sh` and the Phase 3 gate
E2E test (`tests/e2e/phase3-gate.test.ts`). It is **not** committed.

---

## 2. Boot the verifier

`scripts/start-verifier.sh` boots `uvicorn admatix_verifier.app:app`
against the venv above, polls `/healthz` until it answers 200, prints
the PID to stdout, and writes the PID to `/tmp/admatix-verifier.pid`.
It is idempotent — if the verifier is already up on the configured
port, it reuses the existing process.

```bash
# default: 127.0.0.1:8088
scripts/start-verifier.sh

# pick a different port (e.g. when running the E2E test alongside)
ADMATIX_VERIFIER_PORT=18088 scripts/start-verifier.sh

# confirm it is up
curl -s http://127.0.0.1:8088/healthz | jq
# → {"status":"ok","version":"0.1.0","libs":{...}}
```

Stop it with `scripts/stop-verifier.sh`. The script reads the PID from
the same `/tmp/admatix-verifier.pid` file and is also idempotent.

`ADMATIX_VERIFIER_LOG` (default `/tmp/admatix-verifier.log`) captures
uvicorn's stdout/stderr.

---

## 3. Wire the verifier into `runWorkflow`

```ts
import { createStore } from "@admatix/core";
import {
  createVerifierClient,
  runWorkflow,
} from "@admatix/agents";

const store = createStore("./data");
const verifierClient = createVerifierClient({
  baseUrl: "http://127.0.0.1:8088",
  timeoutMs: 30_000,
});

const result = await runWorkflow(
  {
    accountRef: "fixture:acc_demo",
    goal: "reduce_cac",
    tenantId: "tenant_demo",
  },
  {
    store,
    verifierClient,
    // Tell the orchestrator which post-period data URI each H0 packet
    // should be verified against. Return `null` to skip the verifier
    // for that packet — useful for "verify only the first packet" runs
    // or for packets whose entity has no associated post-period data.
    postPeriodDataUriFor: (packet) => ({
      data_uri: `file:///opt/admatix-wt/S/data/sim/${packet.proposal.target_entity_id}/events.csv`,
      hint: { design: "clean_ab" },
    }),
  },
);
```

When `verifierClient` and `postPeriodDataUriFor` are both supplied the
orchestrator:

1. Calls `MeasurementScientistAgent.review(...)` which forwards a
   `POST /verify` to the verifier.
2. Persists the response into `outcome_measurements` via
   `store.put("outcome_measurements", id, row)`.
3. Emits a `measurement.verified` event with the canonicalised
   verifier `payload_hash` — this is the row the ledger chain
   verifier (`scripts/db/verify-ledger-chain.ts`) checks when the
   Supabase store backend is wired in (WP-M).
4. Threads the verifier's `verdict` into `ReflectionAgent`:
   `lift_detected → "validated"`, `no_effect → "invalidated"`,
   `inconclusive →` no-op for the trust ledger.

Side effects only fire on the orchestrator-driven path. Calling the
MCP `verify` tool (§ 5) never writes to the store.

---

## 4. Read the persisted outcome + the ledger event

After a workflow run, the verifier response is recoverable from two
places:

**`outcome_measurements` (per packet):**

```ts
const measurements = await store.list<{
  observed_value: number;
  confidence_interval?: [number, number];
  notes: string[];
  passed: boolean;
  evidence: { source: string; ref: string; hash?: string }[];
}>("outcome_measurements");

// Recover the five round-trip fields from the persisted row:
//   verifier.estimate         → row.observed_value
//   [ci_low, ci_high]         → row.confidence_interval
//   verifier.method           → notes "method:<name>"
//   verifier.verdict          → notes "verdict:<name>"
//                                 (passed = verdict === "lift_detected")
//   verifier.causal_status    → notes "causal_status:<name>"
```

The `notes` array also carries `tx_id:<id>`, `ci_level:<n>`, and one
`confounder:<name>` entry per named confounder. The encoding is stable
so the Phase 3 gate test (`tests/e2e/phase3-gate.test.ts`) reconstructs
the verifier payload byte-identical to the one emitted into the event
stream.

**Event stream (per workflow):**

```bash
# events live under <store rootDir>/events/<workflow_id>.jsonl
jq 'select(.type == "measurement.verified")' \
  data/events/<workflow_id>.jsonl
```

The `payload_hash` field is `sha256` of the canonical verifier payload
(sorted keys, the seven canonical fields plus `tx_id`, `ci_level`,
`packet_id`, `confounders`). When the Supabase `Store` backend is
selected (WP-M, `ADMATIX_STORE=supabase`) this event lands as a row in
`ledger.action_events` with `event_type = "measurement"`.

The documented event order for a successful packet is:

```
evidence.ok → policy.allow (or policy.needs_approval) → diff.built → measurement.verified
```

---

## 5. Drive `admatix.verify` from the MCP server

`apps/mcp-server` registers the read-shaped `verify` tool only when
`deps.verifierClient` is supplied — Phase 1 demos that never boot the
verifier stay unaffected.

```ts
import { createAdmatixMcpServer } from "@admatix/mcp-server";
import { createVerifierClient } from "@admatix/agents";

const server = createAdmatixMcpServer({
  dataDir: "./data",
  verifierClient: createVerifierClient({
    baseUrl: "http://127.0.0.1:8088",
  }),
});
```

The tool is **read-shaped by construction**:

- It does not write to the store.
- It does not emit a `ledger.action_events` row.
- It does not move a packet through its lifecycle.

Calling it with an `approval_receipt` (or any other write-class field)
is rejected by Zod's `.strict()` schema with a clear "Unrecognized key"
error. A `packet_id` that does not resolve in the store throws
`"H0 packet '...' not found in store"`.

Direct handler call:

```ts
import { verifyTool } from "@admatix/mcp-server/tools/verify.js";

const envelope = await verifyTool(
  {
    packet_id: "h0_…",
    data_uri: "file:///opt/admatix-wt/S/data/sim/world_x/events.csv",
    hint: { design: "clean_ab" },
  },
  { store, connector, verifierClient },
);
// envelope.data is a VerifyResponsePayload — the seven canonical fields.
```

MCP-protocol call (e.g. from Claude Code):

```jsonc
{
  "jsonrpc": "2.0",
  "method": "tools/call",
  "params": {
    "name": "verify",
    "arguments": {
      "packet_id": "h0_…",
      "data_uri": "file:///opt/admatix-wt/S/data/sim/world_x/events.csv"
    }
  }
}
```

---

## 6. Recover from a verifier outage

`MeasurementScientistAgent` degrades gracefully when the verifier is
unreachable. On any network / timeout / 5xx / bad-JSON failure the
client surfaces a typed `VerifierError` whose `.reason` is one of:

- `network` — the verifier process is not listening on `baseUrl`.
- `timeout` — the request exceeded `timeoutMs` (default 30 000 ms).
- `http_5xx` — the verifier returned a 5xx response.
- `http_4xx` — the verifier returned a 4xx response (e.g. bad payload).
- `bad_response` — the response failed Zod boundary validation.

The agent catches the error, appends `verifier_unavailable:<reason>`
to `result.caveats`, and returns its pre-verifier output unchanged
(no `verification` field on the result, no `measurement.verified`
event, no `OutcomeMeasurement` row). The workflow keeps running; the
packet remains in `pending_approval`.

To recover:

```bash
# 1. Confirm the verifier is down
curl -fsS http://127.0.0.1:8088/healthz   # → exit code != 0

# 2. Read the most recent uvicorn log for the failure mode
tail -100 /tmp/admatix-verifier.log

# 3. Restart
scripts/stop-verifier.sh && scripts/start-verifier.sh

# 4. Re-run the workflow OR call admatix.verify directly to refresh
#    the OutcomeMeasurement for the affected packet.
```

The verifier never approves a packet, never bypasses `PolicyGuard` /
`EvidenceLedger`, and never produces a `ProposedAction` — losing it
temporarily cannot weaken any gate. The worst case is a stale
measurement, which the next successful `runWorkflow` will overwrite.

---

## 7. End-to-end: Phase 3 gate

The Phase 3 gate test runs everything above end-to-end:

```bash
# Boots the real verifier, materialises a clean_ab world via /simulate,
# runs runWorkflow, asserts the persisted OutcomeMeasurement +
# ledger event payload_hash + ci_low ≤ 0.04 ≤ ci_high.
pnpm exec vitest run tests/e2e/phase3-gate.test.ts
```

A reviewer who follows this runbook from a clean shell should be able
to start the verifier, run that test, and read the persisted
`OutcomeMeasurement` + matching ledger row without any further setup.
