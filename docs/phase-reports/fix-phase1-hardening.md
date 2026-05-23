# Phase 1 Hardening — Fix Report

**Branch:** `fix/phase1-hardening`
**Base:** `main`
**Scope:** all CRITICAL and HIGH findings from
`docs/phase-reports/QA-phase1-review.md` (on branch `qa/phase1-review`).

The QA review's "must-do" list (#1, #2, #3, #4, #5, #6, #8, #10, #11, #12,
#13, #26) is covered. Findings #7 (HIGH — API auth + tenant isolation) and
#9 (HIGH — `live:` refs) are also covered. MEDIUM and LOW findings were
left for later WP-K-style hardening work, except where co-located with a
CRITICAL/HIGH fix (#24 was fixed in passing while patching #9).

For every fix below, the test added/strengthened is described in
**Coverage test**. Each test was written so a *future* regression of the
underlying contract would fail it — not as a tautological re-check.

---

## #1 [CRITICAL] MCP `activate_dry_run` skips PolicyGuard

**Fix.** `apps/mcp-server/src/tools/activate-dry-run.ts` now calls
`evaluateAction()` after `PlatformAdapter.translate()`. PolicyGuard's
verdict gates diff construction:

- `result === "block"` → `blockedEnvelope` with `policy_block:<reasons>`;
  no diff persisted.
- `result === "needs_approval"` → only honoured when the supplied
  `ApprovalReceipt` has a verified HMAC signature (see #5).
- `result === "allow"` → diff built and persisted along with the
  `PolicyDecision`.

The fix is fail-closed: there is no longer a code path that yields an
ExecutionDiff without PolicyGuard having seen the action.

**Coverage test.** `apps/mcp-server/src/server.test.ts` — *"F1: blocks
an unsafe budget_shift packet via PolicyGuard"*. The test plants a
packet with `params.delta_pct: 80` against a 20% cap and asserts the
MCP envelope returns `status: "blocked"` containing `"policy_block"`
and the cap message. Before the fix this produced an `ExecutionDiff`.
Companion test *"F1: rejects approval receipts whose HMAC signature
does not verify"* exercises the second leg.

---

## #2 [CRITICAL] EvidenceLedger does not verify refs

**Fix.** `packages/policy/src/evidence-ledger.ts` now exposes an
`EvidenceResolver` interface and a `verifyEvidenceWithResolver` async
variant alongside the legacy structural `verifyEvidence`.

The resolver:
- parses every `ref` against a list of allowed patterns
  (`metric:campaign_daily:<account>:<campaign>:<date>`, `campaign:...`,
  `metric:creative_daily:<creative>`, `trust:...`, `action:...`, etc.);
- looks up the referenced row through a caller-supplied lookup
  (`campaignDailyMetric`, `campaign`, `creativeDaily`);
- compares the recomputed `sha256(row)` against `ref.hash` byte-for-byte
  when both are present.

`createEvidenceResolver({...})` produces a resolver wired against any
concrete lookup. The orchestrator now constructs one from the live
fixture data and passes it to `makeEvidenceLedgerAgent({resolver})`,
so a fabricated ref like `{source: "x", ref: "y"}` no longer slips
through the gate.

**Coverage test.** `packages/policy/src/evidence-ledger.test.ts`,
`describe("verifyEvidenceWithResolver — provenance check (QA finding
#2)", ...)` — four new tests:
1. Unrecognised ref pattern → `unrecognized_pattern`.
2. Pattern OK but no row → `unresolved`.
3. Hash matches → ok.
4. Hash mismatches → `hash:mismatch`.

---

## #3 [CRITICAL] Production `buildH0Packets` produces packets PolicyGuard rejects

**Fix.** `packages/evidence/src/h0-builder.ts` now emits
`params: { delta_pct: -20, dry_run_reason }` for budget findings.
PolicyGuard's `budget_cap` rule reads `params.delta_pct` directly, so
the production pipeline now reaches `needs_approval` (not `block`).

The CLI's `normalizePacketProposal`/`normalizeActionForCli` workaround,
the demo's `rewriteProposalForDemo`, and the web fallback's
`max_reduction_pct` are all removed. The web preview now reads
`params.delta_pct` straight.

**Coverage test.** `packages/evidence/src/acceptance.test.ts` — new test
*"F3: production pipeline produces ≥1 budget_shift that PolicyGuard
accepts as needs_approval"*. It runs the full
`runAudit → buildH0Packets → evaluateAction` chain on the demo fixture
and asserts at least one budget_shift packet reaches `needs_approval`
and zero packets are blocked. Before the fix, every budget_shift came
back as `result: "block"` with reason
`missing a numeric params.delta_pct`. Recommendation #26 (integration
test through production builder) is satisfied by this test.

---

## #4 [CRITICAL] Guardrail unit mismatch (0.2 vs 25)

**Fix.** Percent points is now the single unit for
`max_daily_budget_delta_pct`. Changes:

- `packages/schemas/src/h0-packet.ts` documents the unit in the
  `Guardrails` Zod schema docstring and requires `nonnegative()`.
- `packages/evidence/src/h0-builder.ts` writes `20` (not `0.2`).
- `apps/cli/src/support.ts` — `withCliDemoId` no longer multiplies
  `*100` when value ≤ 1. The conditional is gone.
- `scripts/demo.ts` — same fractional-vs-percent hack removed.
- `apps/web/src/lib/fixtures-fallback.ts` — both fallback packets fixed.
- `apps/mcp-server/src/server.test.ts` — fixture packet uses `20`.

**Coverage test.** Covered by the #3 acceptance test (the assertion
"PolicyGuard accepts as needs_approval, not blocks" only holds when
the unit is right) and by the existing `policy-guard.test.ts` AT-1
("breach exceeds the 20% cap").

---

## #5 [CRITICAL] API approval endpoint accepts forged identities

**Fix.** Bearer-token auth + HMAC-signed receipts.

- `apps/api/src/auth.ts` — a `onRequest` hook resolves `req.identity`
  from `Authorization: Bearer <tok>` against a token table loaded from
  `ADMATIX_API_TOKENS` (dev defaults: `tok_demo_media_manager`,
  `tok_demo_viewer`, `tok_demo_finance_director`).
- `apps/api/src/routes/approvals.ts` — `decided_by` and `role` are
  taken from the verified identity, never the body. The endpoint
  enforces `role ∈ {media_manager, finance_director}` and rejects with
  403 otherwise.
- `apps/api/src/server.ts` — default Fastify logger redacts
  `req.headers.authorization` and `req.headers.cookie`. Covers
  finding #21.
- `packages/policy/src/approval-signing.ts` — `signApprovalReceipt`
  (HMAC-SHA256 of `packet_id|action_id|decided_by|decided_at|decision`)
  and `verifyApprovalReceipt`. Secret read from
  `ADMATIX_APPROVAL_SECRET`.
- `packages/schemas/src/actions.ts` — `ApprovalReceipt.signature`
  (optional in the schema so CLI demo receipts compile, but required
  by `verifyApprovalReceipt`).
- `apps/mcp-server/src/tools/activate-dry-run.ts` — verifies the
  receipt's signature before policy + diff (closes #1's second leg).
- Every approval/rejection now emits an `AdmatixEvent` to the JSONL
  ledger (`approval.approved` / `approval.rejected`).

**Coverage tests.** `apps/api/src/server.test.ts`,
`describe("F5: approvals cannot forge identity", ...)`:
1. No `Authorization` header → 401.
2. Body-supplied `role: finance_director` is ignored; the receipt
   records the token's role (`media_manager`) — exactly the attack the
   QA review described.
3. Viewer-role token → 403.

Plus `packages/policy/src/approval-signing.test.ts` (5 tests for
sign/verify/tamper/wrong-key).

---

## #6 [HIGH] Orchestrator builds diff for `needs_approval` packets

**Fix.** `packages/agents/src/orchestrator.ts` now halts after
`ApprovalCoordinator` when `decision.result === "needs_approval"`:
the packet is persisted in `acceptedPackets` (so the cockpit can see
it), an `approval.pending` event is emitted, and DiffBuilder is
skipped.

A new public entry point `runActivation({packet_id, tenant_id,
receipt}, deps)`:
- looks up the packet,
- verifies tenant + receipt + signature,
- re-runs `PlatformAdapter.translate` and `evaluateAction`,
- builds and persists the diff only if the verdict allows.

Exported from `packages/agents/src/index.ts`.

**Coverage tests.** `packages/agents/src/orchestrator.test.ts`,
`describe("F6: runWorkflow stops at needs_approval", ...)`:
1. *"does NOT build a diff for budget_shift packets that need
   approval"* — asserts every `needs_approval` action_id is absent
   from `result.diffs`. Before the fix, diffs appeared for those.
2. *"runActivation builds a diff once a signed receipt is supplied"*.
3. *"runActivation refuses an unsigned receipt"*.

---

## #7 [HIGH] Audit/Packets APIs have no authentication or tenant isolation

**Fix.** Same auth hook as #5 is global. Each route uses
`req.identity.tenant_id`:

- `POST /api/v1/audit` — tenant comes from the token, not the body.
  `tenantId` is removed from the request schema.
- `GET /api/v1/packets` and `GET /api/v1/packets/:packetId` — filter
  by `tenant_id` matching the caller.
- `GET /api/v1/approvals` — joins receipts to their packets and
  drops anything not in the caller's tenant.
- `POST /api/v1/approvals` — rejects with 403 if `packet.tenant_id`
  doesn't match the caller.

**Coverage test.** `apps/api/src/server.test.ts`, *"F7: /api/v1/packets
filters by the caller's tenant"*. The test plants an `h0_foreign_tenant`
packet (`tenant_id: "tenant_other"`) directly into the store and
asserts the demo-tenant token does not see it in the listing.

---

## #8 [HIGH] `ADMATIX_MODE=fixtures` never enforced

**Fix.** A small `fixtures-mode.ts` in each of the three entry-point
packages asserts the env var. Wired into:

- `apps/cli/src/index.ts` → `runCli`
- `apps/api/src/server.ts` → `buildServer`
- `apps/mcp-server/src/server.ts` → `createAdmatixMcpServer`

The default if unset remains `fixtures` (so existing dev flows are
unaffected). Any other value is a fatal startup error.

**Coverage tests.** One per entry point:
- `apps/cli/src/index.test.ts` — *"F8: refuses to start if ADMATIX_MODE
  != fixtures"*.
- `apps/api/src/server.test.ts` — *"F8: API entry point enforces
  ADMATIX_MODE=fixtures"*.
- `apps/mcp-server/src/server.test.ts` — *"F8: MCP entry point enforces
  ADMATIX_MODE=fixtures"*.

---

## #9 [HIGH] `live:` account refs accepted, silently treated as fixture

**Fix.** `packages/connectors/src/resolve-ref.ts` now throws when the
ref kind isn't `fixture`. The `AccountRef` type is narrowed to
`{kind: "fixture"; id: string}`. The orchestrator's `resolveAccount`
fallback (which returned `accounts[0]` on miss — finding #24) is also
removed: it now throws with an actionable error listing available
accounts.

**Coverage tests.**
- `packages/connectors/src/resolve-ref.test.ts` — *"F9: live: refs are
  rejected at the parse boundary"*.
- The existing acceptance tests still pass with `fixture:acc_demo`,
  confirming the happy path is untouched.

---

## #10 [HIGH] `runSuite` is non-deterministic

**Fix.** `packages/evals/src/run-suite.ts`:
- `run_id` is now `sha256({suite, pinned, results})` truncated to 16 hex
  chars. Same fixture + same code + same policy → same id, every run.
- `RunSuiteOptions` accepts an optional `clock: () => string`. Defaults
  to wall-clock, but tests pin it.

**Coverage test.** `packages/evals/src/run-suite.test.ts` — *"F10:
run_id is deterministic for the same suite + pins + results"*. Two
runs with a fixed clock produce identical `run_id`, identical
`created_at`, and byte-identical JSON.

---

## #11 [HIGH] Pacing detector divides by zero

**Fix.** `packages/evidence/src/detectors/pacing.ts` — guard expanded
from `budget === undefined` to `budget === undefined || budget <= 0`.

**Coverage test.** `packages/evidence/src/detectors/detectors.test.ts`
— *"F11: pacing skips campaigns whose daily_budget is 0 (no Infinity)"*.
Constructs a `DetectorInput` with `daily_budget: 0` and positive spend
on three days; asserts the detector returns `[]` and the description
never contains "NaN" or "Infinity".

---

## #12 [HIGH] PolicyGuard switch has no exhaustiveness check

**Fix.** `packages/policy/src/policy-guard.ts` — added a `default:` arm
to the `rule.kind` switch with an `assertNever`-style cast. On an
unknown kind the rule contributes `"policy_kind_unhandled"` to
`matched_rules` and forces `blocked = true`.

An internal `evaluateActionAgainstRules(action, ctx, policy)` is
exported (alongside `evaluateAction`) so the test can inject a fake
policy whose `kind` was never enumerated.

**Coverage test.** `packages/policy/src/policy-guard.test.ts` —
*"F12: an unknown PolicyRule.kind blocks the action (no silent
no-op)"*. Casts a `{kind: "future_kind_not_in_schema"}` rule into the
evaluator and asserts `result === "block"`. The original code path
would have produced `result === "allow"` because nothing in the
switch matched.

---

## #13 [HIGH] ReflectionAgent emits non-deterministic `evidence_refs`

**Fix.** `packages/agents/src/agents/reflection-agent.ts` — the trust
note suffix changed from `newId("note")` (ULID; clock + random) to a
deterministic 12-char `sha256({subject_type, subject_id, outcomes})`
prefix. Identical inputs now yield byte-identical `AgentOutput`.

**Coverage test.** `packages/agents/src/agents/reflection-agent.test.ts`
— *"F13: evidence_refs are deterministic across reruns on identical
input"*. Calls `reflect()` twice with the same input and asserts the
`evidence_refs` arrays are equal and the trust_note matches
`^trust_note:[0-9a-f]{12}$`.

---

## Notes on findings NOT addressed in this branch

The QA review's MEDIUM/LOW list is acknowledged but intentionally out of
scope for the "CRITICAL + HIGH" hardening pass:

- #14 (CLI cannot record rejection) — open as follow-up.
- #15 (receipt id collision in CLI) — open.
- #16 (`Guardrails: {}` permitted) — open. The orchestrator-side path
  in particular still falls back to a default 25% cap when guardrails
  are wholly missing; that's a separate refinement that benefits from
  being co-designed with the cockpit's "missing guardrail" UI affordance.
- #17 (BenchmarkRun written even when nothing changed) — substantially
  improved by the #10 deterministic id (rerunning produces the same id
  so the file is overwritten in place rather than accumulating) but the
  dedupe-by-content check is not in.
- #18 (finding dedupe) — open.
- #19 (low-severity dropped) — open.
- #20 (supply-path evidence slicing) — open.
- #21 (logger body redaction) — *fixed in passing* as part of #5.
- #22 (Store atomic write) — open.
- #23 (test fixture duplicates production schema) — partly mitigated:
  the unit divergence is gone and refs follow the canonical pattern.
  The test-only builder still exists; deleting it is a larger refactor
  recommended for the next WP.
- #24 (`resolveAccount` first-account fallback) — *fixed in passing*
  as part of #9.
- #25 (web app does not parse responses through schemas) — open.
- #26 (no integration test through production buildH0Packets) — *fixed*
  as part of #3.
- #27 (events stream name adapter) — open. The adapter is still
  fragile; the API approvals route had to inline the same workaround.
- #28 (Store sanitization at call site) — open.

---

## Verification

```
$ pnpm install
$ pnpm -r typecheck     # all 11 packages green
$ pnpm exec turbo run test --concurrency=1
   Test Files  28 passed (28)
        Tests  202 passed (202)
```

Pre-fix counts were 27 test files / 165 tests. The delta — +1 file
(`packages/policy/src/approval-signing.test.ts`) and +37 tests — is
the new coverage listed above.
