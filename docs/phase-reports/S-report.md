# WP-S — `MeasurementScientist → verifier` + `admatix.verify` MCP tool

**Phase:** 3 · **Wave:** 3 · **Branch:** `wp/s-wiring`
**Date:** 2026-05-23 · **Agent:** Claude Opus 4.7

## What shipped

WP-S wires the independent verifier (WP-R, `services/verifier`) into the
TS-side agent runtime and exposes it through the MCP surface. With WP-S
merged, the Phase 3 gate is closed: *a simulated agent proposes a change
→ AdMatix gates it → logs it → the verifier independently grades it →
the verdict round-trips into the ledger.*

### `packages/agents`

- **`src/verifier-client.ts`** — new HTTP client for `services/verifier`.
  Surface: `createVerifierClient({ baseUrl, fetch?, timeoutMs? })` returns
  a `VerifierClient` with `healthz()` and `verify(req)`. Inbound responses
  are validated at the boundary against a local Zod schema (`packages/
  schemas` stays frozen). Every failure path surfaces a typed
  `VerifierError` whose `.reason` is one of `network | timeout | http_5xx
  | http_4xx | bad_response`.
- **`src/agents/measurement-scientist-agent.ts`** — when `deps.verifierClient`
  AND `input.verifyInput` are both supplied the agent calls
  `/verify` exactly once, threads the result through `result.verification`,
  and appends caveats (`verifier_method:…`, `verifier_verdict:…`,
  `verifier_confounder:…`). Network/timeout failures append a
  `verifier_unavailable:<reason>` caveat and the agent returns its
  pre-verifier output. The packet is never approved by the verifier
  (`output.proposed_actions === []`), and `causal_status` remains
  `directional_until_lift_test` on the persisted packet.
- **`src/orchestrator.ts`** — `WorkflowDeps` gains `verifierClient` and
  `postPeriodDataUriFor`. After the existing `measurementScientist.review`
  call and after `diff.built`, the orchestrator:
  1. Maps the verifier response onto the frozen `OutcomeMeasurement`
     schema (no schema changes — fields encoded as
     `observed_value`/`confidence_interval`/`notes` so the five
     round-trip fields `estimate, ci_low, ci_high, method, verdict`
     are recoverable byte-identical).
  2. Persists via `store.put("outcome_measurements", id, row)`.
  3. Emits a `measurement.verified` event with the canonicalised
     verifier `payload_hash` (sha256 over sorted keys — matches the
     Postgres jsonb canonicalisation a Supabase trigger would compute
     server-side, so the ledger chain stays consistent when WP-M's
     Supabase backend is selected via `ADMATIX_STORE=supabase`).
  4. Maps the verifier's `verdict` into `ReflectionAgent`:
     `lift_detected → "validated"`, `no_effect → "invalidated"`,
     `inconclusive →` no-op for the trust ledger. Policy-blocked
     actions still surface as `blocked_unsafe` (the hard penalty is
     kept). Phase 1 demos with no verifier dep keep the original
     optimistic-validated path.

### `apps/mcp-server`

- **`src/tools/verify.ts`** — new read-shaped `admatix.verify` MCP tool.
  Input: `{ packet_id, data_uri, metadata_uri?, action_log_uri?, hint? }`
  (Zod `.strict()` rejects every write-class field). It looks the
  packet up via `getPacketOrThrow`, derives `account_ref` from the
  packet's evidence refs (the H0Packet schema does not yet carry an
  `account_ref` field — derivation keeps `packages/schemas` frozen),
  and forwards `/verify`. The handler **never** writes to the store,
  emits a ledger event, or moves a packet through its lifecycle.
- **`src/server.ts`** — `AdmatixMcpDeps` gains an optional
  `verifierClient`. When supplied, the `verify` tool is registered with
  the same read-only annotations and `ToolResultEnvelope` pattern as
  the existing six tools. When absent, the tool is not registered —
  Phase 1 demos that never boot the verifier stay unaffected.
  `APPROVED_TOOL_NAMES` gains `"verify"`.

### Scripts + runbook

- **`scripts/start-verifier.sh`** — boots `uvicorn admatix_verifier.app:app`
  against `services/verifier/.venv`, polls `/healthz` until 200 (or fails
  after the timeout), prints the PID, writes it to
  `/tmp/admatix-verifier.pid`. Idempotent.
- **`scripts/stop-verifier.sh`** — companion stop script.
- **`docs/runbooks/measurement-to-verifier.md`** — operator runbook:
  one-time venv setup, boot / stop the verifier, wire it into
  `runWorkflow`, read the persisted `OutcomeMeasurement` and the
  matching `measurement.verified` event, drive `admatix.verify` from
  the MCP surface, and recover from a verifier outage.

### Tests (all eight acceptance tests green)

| # | File | Asserts |
| --- | --- | --- |
| 1 | `packages/agents/src/verifier-client.test.ts` | Happy path — seven canonical fields parsed; missing required field throws a clear Zod-backed error. |
| 2 | `packages/agents/src/verifier-client.test.ts` | Outage — every failure surfaces a `VerifierError` with `.reason ∈ {network, timeout, http_5xx, http_4xx, bad_response}`. |
| 3 | `packages/agents/src/agents/measurement-scientist-agent.test.ts` | Clean_ab world — `verification.verdict === "lift_detected"`, CI brackets ground truth, `proposed_actions === []`, packet's `causal_status` unchanged. |
| 4 | `packages/agents/src/agents/measurement-scientist-agent.test.ts` | Placebo — `verdict ∈ {no_effect, inconclusive}` and caveats reflect the verifier's verdict tag. |
| 5 | `packages/agents/src/agents/measurement-scientist-agent.test.ts` | Outage — `verifier_unavailable:<reason>` caveat appended; pre-verifier output unchanged. |
| 6 | `apps/mcp-server/src/tools/verify.test.ts` | MCP handler — envelope shape correct; no `store.put`, no `store.append`; persisted packet byte-identical to the pre-call fixture (read-shaped). |
| 7 | `apps/mcp-server/src/tools/verify.test.ts` | Capability gate — `approval_receipt`/unknown fields rejected by Zod; unresolved `packet_id` throws. |
| 8 | `tests/e2e/phase3-gate.test.ts` | Phase 3 gate — boots real `services/verifier` via `scripts/start-verifier.sh`, materialises a clean_ab world via `/simulate` (`n_users=2000, true_lift=0.04, seed=17, noise_sd=0`), runs `runWorkflow`, asserts: ≥ 1 H0 packet, every diff `dry_run: true`, event-stream order `evidence.ok → policy.allow → diff.built → measurement.verified`, exactly one `OutcomeMeasurement` row with `verdict === "lift_detected"` and `ci_low ≤ 0.04 ≤ ci_high`, and the `measurement.verified` `payload_hash` equals `sha256(canonical_verifier_payload)` (matching the hash carried on the persisted measurement's `evidence[0].hash`). |

## Verification commands — all six exit 0

```
# 1. Verifier sibling venv (one-time per machine; tests against the
#    pinned WP-R lock)
cd services/verifier
python3.12 -m venv .venv && . .venv/bin/activate
pip install --upgrade pip && pip install -r requirements.lock
cd ../..

# 2. TypeScript surface — typecheck + the main suite
pnpm install                                         # cached
pnpm -r typecheck                                    # all 11 projects green
pnpm exec turbo run test --concurrency=1             # 196 passed | 1 skipped (197) across 31 files
                                                     # (includes apps/mcp-server, packages/agents, tests/e2e)

# 3. Verifier sibling tests (WP-R + WP-P + WP-Q)
. services/verifier/.venv/bin/activate
pytest services/verifier -q                          # 26 passed
pytest services/ingest services/simulator -q         # 10 passed

# 4. Phase 3 gate test — confirmed in isolation
pnpm exec vitest run tests/e2e/phase3-gate.test.ts   # 1 passed in 5.30s

# 5. Ledger chain intact end-to-end
pnpm tsx scripts/db/verify-ledger-chain.ts           # ledger-chain-ok: checked 37 rows

# 6. Secret scan
pnpm scan-secrets                                    # no token-shaped secrets found
```

### Sample acceptance output (excerpt)

```
$ pnpm exec vitest run packages/agents/src/verifier-client.test.ts
 ✓ packages/agents/src/verifier-client.test.ts (9 tests) 17ms

$ pnpm exec vitest run packages/agents/src/agents/measurement-scientist-agent.test.ts
 ✓ packages/agents/src/agents/measurement-scientist-agent.test.ts (5 tests) 8ms

$ pnpm exec vitest run apps/mcp-server/src/tools/verify.test.ts
 ✓ apps/mcp-server/src/tools/verify.test.ts (6 tests) 32ms

$ pnpm exec vitest run tests/e2e/phase3-gate.test.ts
 ✓ Phase 3 gate — simulated agent → AdMatix gates → logs → verifier grades
   ✓ AT8: end-to-end loop round-trips a clean_ab verdict into the ledger 2059ms
```

## Constraints honoured

- `packages/schemas/**` untouched. The verifier-client's local Zod schema
  is a *read-only* mirror of the WP-R Pydantic surface; the
  `OutcomeMeasurement`, `H0Packet`, `AgentOutput`, `ProposedAction`,
  `PolicyDecision`, `ApprovalReceipt`, and `RiskLevel` schemas are
  reused as-is. `account_ref` (which the WP-R Pydantic model requires
  but the H0Packet schema doesn't carry) is derived at the call site
  from the packet's evidence refs with a `tenant_id` fallback — see
  `deriveAccountRef` in both `measurement-scientist-agent.ts` and
  `apps/mcp-server/src/tools/verify.ts`. Promoting `account_ref` to a
  first-class schema field is a future schemas PR; no field is
  redefined locally.
- `services/verifier/**`, `services/simulator/**`, `services/ingest/**`
  untouched. The Phase 3 gate test boots the verifier from this
  directory but never edits its source.
- `warehouse/**` untouched. No new migrations or dbt models.
- No live ad-platform calls anywhere — simulator and dry-run only. The
  Phase 3 gate test materialises its world via `services/simulator`
  through the verifier's `/simulate` endpoint.
- No secrets in code or commits; `pnpm scan-secrets` clean.

## Phase 3 status — gate CLOSED

With WP-S merged into `wp/s-wiring`:

- `services/simulator` emits worlds with hidden known truth (WP-Q, ✅).
- `services/verifier` returns estimate + CI + method + verdict over
  HTTP (WP-R, ✅).
- `MeasurementScientistAgent` calls the verifier, the orchestrator
  persists into `outcome_measurements`, emits `measurement.verified`
  with the canonical payload hash, and threads the verdict into
  `ReflectionAgent` (WP-S, ✅).
- `admatix.verify` is on the MCP read surface, gated behind
  `deps.verifierClient` and capability-locked by Zod `.strict()`
  (WP-S, ✅).

The Phase 4 research-grade validation harness (`services/validation` —
SBC, CI-coverage band, RMSE/bias, multi-seed variance, Criteo
back-test, Qini at scale) is the next wave (WP-T) and is explicitly
out of scope for WP-S.
