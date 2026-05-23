# Phase 1 QA Review — Adversarial Audit

**Branch:** `qa/phase1-review`
**Base:** `main` at `9b8f6aa`
**Reviewer:** adversarial QA pass against `AGENTS.md` (ten golden rules) and `docs/architecture/ARCHITECTURE-DEEP.md` (package contract).
**Scope:** review-only. No product code modified.

The harness reports 165 passing tests, but "passes" is not "correct." The
findings below are ordered by severity. Each lists the file, the problem, and a
concrete recommended fix. Verdict is at the end.

---

## Findings

### 1. [CRITICAL] MCP `activate_dry_run` skips PolicyGuard entirely

- **File:** `apps/mcp-server/src/tools/activate-dry-run.ts:19-70`
- **Problem:** The tool gates on a presence/shape check of `approval_receipt`
  but never calls `evaluateAction()`. It runs `PlatformAdapter → DiffBuilder`
  and persists the diff. `PolicyGuard` is a **mandatory gate** per
  AGENTS.md §6 and ARCHITECTURE-DEEP §1 ("PolicyGuard and EvidenceLedger are
  mandatory gates"). A budget_shift packet whose `delta_pct` exceeds the cap
  will produce a dry-run diff via this tool even though the orchestrator path
  would block it. Even though the diff is structurally dry-run, the system
  is now lying: the cockpit/agent thinks an "approved + activated" diff cleared
  policy when it didn't.
- **Fix:** Inside `activateDryRunTool`, after `getPacketOrThrow`, call
  `evaluateAction(action, { guardrails: packet.guardrails, campaign, metrics })`
  and return `blockedEnvelope({...reason: decision.reasons.join("; ")})` when
  `decision.result === "block"`. Also reject `needs_approval` unless an
  explicit allowance is documented.

### 2. [CRITICAL] EvidenceLedger does not actually verify refs

- **File:** `packages/policy/src/evidence-ledger.ts:14-59`
- **Problem:** `verifyEvidence` only checks that `evidence` is non-empty and
  each ref has non-empty `source` and `ref` *strings*. It never resolves a ref
  against the Store, the fixture, or any other source-of-truth. AGENTS.md §4
  says "Any metric, finding, or recommendation must carry `evidence_refs`
  pointing at concrete source rows. No source ref → it does not ship." A
  fabricated ref like `{source:"x", ref:"y"}` passes today.
- **Fix:** Inject a resolver (Store + fixture connector) into `verifyEvidence`
  and check that each ref's `ref` parses against a known pattern
  (`metric:campaign_daily:<account>:<campaign>:<date>` etc.) AND that the
  pointed-to row exists. If `hash` is supplied, recompute and compare. Move
  the resolver behind the `EvidenceLedgerAgent` so callers can't bypass it.

### 3. [CRITICAL] Production `buildH0Packets` produces packets that PolicyGuard
must reject on every budget_shift

- **Files:** `packages/evidence/src/h0-builder.ts:97`,
  `packages/policy/src/policy-guard.ts:194-217`,
  `apps/cli/src/support.ts:309-330`
- **Problem:** `h0-builder` writes `params: { max_reduction_pct: 0.2, ... }`
  for budget findings. `PolicyGuard.budget_cap` looks for `params.delta_pct`.
  When absent, it appends the rule to `matched` and sets `blocked = true`
  (severity is `"block"` in `policy.v1.json`). The two contracts disagree on
  the params shape. The CLI hides the bug with a workaround
  (`normalizePacketProposal` translates `max_reduction_pct → delta_pct`); the
  API/MCP/orchestrator paths do not. Tests pass only because the orchestrator
  acceptance tests use `packages/agents/src/test-fixtures.ts:173`
  (`params: { delta_pct: -10 }`) instead of the production builder.
- **Fix:** Change `h0-builder.ts:97` to emit
  `{ delta_pct: -20, dry_run_reason: finding.title }` (or whatever signed
  percent the proposal represents). Delete the CLI's
  `normalizePacketProposal`/`normalizeActionForCli` workaround. Add an
  integration test that runs `runAudit → buildH0Packets → PlatformAdapter →
  evaluateAction` end-to-end on the demo fixture and asserts that at least one
  budget_shift packet reaches `result: "needs_approval"` (not `"block"`).

### 4. [CRITICAL] Guardrail unit mismatch (`0.2` vs `25`)

- **File:** `packages/evidence/src/h0-builder.ts:25`
- **Problem:** The builder sets `max_daily_budget_delta_pct: 0.2`. PolicyGuard
  treats that value as a percent cap directly (`if (Math.abs(deltaPctRaw) > cap)`
  in `policy-guard.ts:210` with `cap` from the same field). So any budget
  shift whose absolute delta exceeds **0.2%** would fail. Combined with finding
  #3, the units conflict (`0.2` looks like a fraction, but is interpreted as a
  percent) — they were never reconciled, because the production path never
  reaches PolicyGuard's numeric comparison today. The CLI compensates
  (`support.ts:309-313`: "if <= 1, multiply by 100"), which is a runtime hack
  rather than a fix.
- **Fix:** Pick a unit (percent points, e.g. `20`) and use it consistently in
  the schema docstring, the h0-builder, all tests, and remove
  `withCliDemoId`'s `<= 1 ? *100 : ...` conditional. Document the unit in the
  `Guardrails` schema in `packages/schemas/src/h0-packet.ts:22-27`.

### 5. [CRITICAL] API approval endpoint accepts forged identities

- **File:** `apps/api/src/routes/approvals.ts:11-75`
- **Problem:** `POST /api/v1/approvals` accepts user-supplied `decidedBy` and
  `role` strings, persists an `ApprovalReceipt` and updates
  `packet.approval.status = "approved"` — with no authentication, no
  signature, no role check. AGENTS.md §7 ("Read tools and write tools are
  separate") and the approval lifecycle in ARCHITECTURE-DEEP §7 both presume a
  trustworthy receipt; here, anyone with network access to the API can
  manufacture an approval as `"finance_director"`. No `emitEvent()` is
  recorded for this state transition either, so there is no audit trail in the
  JSONL ledger.
- **Fix:** Add an auth middleware (token or signed header) and a role check
  before writing the receipt. Sign the receipt (HMAC of
  `{packet_id, action_id, decided_by, decided_at}` with a per-tenant secret),
  store the signature on `ApprovalReceipt`, and have `activate_dry_run`
  verify it. Emit an `AdmatixEvent` for every approval/rejection.

### 6. [HIGH] Orchestrator builds and stores a dry-run diff for
`needs_approval` packets — deviates from documented lifecycle

- **File:** `packages/agents/src/orchestrator.ts:293-330`
- **Problem:** The branch only halts diff construction when
  `decision.result === "block"`. `needs_approval` (the documented "human must
  sign" state) falls through to `DiffBuilder.build()` → `store.put(...,diff)`
  and the diff appears in `WorkflowResult.diffs`. ARCHITECTURE-DEEP §7's
  diagram requires `approved` before `ExecutionDiff`. There is no
  `ApprovalReceipt` lookup between PolicyGuard and DiffBuilder.
- **Fix:** Split the workflow: stop after `ApprovalCoordinator` when
  `approval.status === "pending"`, persist the packet, and require a separate
  `runActivation(packet_id, receipt)` entry point that re-evaluates policy
  with the receipt in hand before the diff is built.

### 7. [HIGH] Audit/Packets API endpoints have no authentication or tenant
isolation

- **Files:** `apps/api/src/server.ts:23-39`, `apps/api/src/routes/audit.ts:30-55`,
  `apps/api/src/routes/approvals.ts:77-80`, `apps/api/src/routes/packets.ts`
- **Problem:** `tenantId` is taken from the request body (`default
  "tenant_demo"`) and written through to `buildH0Packets`. No middleware
  authenticates the caller or constrains which tenant they may write/read.
  `GET /api/v1/audits` and `GET /api/v1/approvals` list every record on disk
  regardless of tenant. AGENTS.md §9 ("never raw PII", "least privilege" in
  ARCHITECTURE-DEEP §8) implies real auth before any of this ships beyond a
  local demo.
- **Fix:** Add a Fastify auth hook that resolves a `tenant_id` from a bearer
  token / session and overrides the request body; filter all `list()` queries
  by tenant; reject requests where body `tenantId` does not match the caller's
  tenant.

### 8. [HIGH] `ADMATIX_MODE=fixtures` is never enforced anywhere

- **File:** project-wide. The env var appears in `README.md`, `.env.example`,
  and `AGENTS.md` but is not read by any source file (grep
  `ADMATIX_MODE` returns only documentation hits).
- **Problem:** AGENTS.md §2 calls fixtures-mode "the only supported mode for
  the MVP." There is no runtime check that refuses to boot if `ADMATIX_MODE !=
  fixtures`. The connector defaults to fixture, but a future live connector
  could silently activate without anyone noticing the rule was violated.
- **Fix:** In the entry points (`apps/cli/src/index.ts`,
  `apps/api/src/server.ts`, `apps/mcp-server/src/server.ts`), assert
  `(process.env.ADMATIX_MODE ?? "fixtures") === "fixtures"` and exit with a
  clear error otherwise. Cover with a single test per entry point.

### 9. [HIGH] `live:` account refs are accepted but silently treated as fixture

- **Files:** `packages/connectors/src/resolve-ref.ts:11-28`,
  `packages/agents/src/orchestrator.ts:79-80,116-118`
- **Problem:** `resolveAccountRef` accepts both `fixture:` and `live:` kinds
  ("reserved for future connectors"). The orchestrator extracts `ref.id` and
  passes it to `fixtureConnector()` without checking `ref.kind`. A caller
  asking for `live:acc_demo` gets fixture data while believing they hit live.
  Combined with #8, this hides MVP-rule violations. The CLI does check
  (`support.ts:137-145`), but the orchestrator/API do not.
- **Fix:** In `runWorkflow` and every API/MCP entry, throw if
  `ref.kind !== "fixture"` until a live connector exists. Drop `live` from
  `resolveAccountRef`'s grammar until there is a connector to route it to.

### 10. [HIGH] `runSuite` is non-deterministic — violates "pin everything"

- **File:** `packages/evals/src/run-suite.ts:60,161-165`
- **Problem:** `BenchmarkRun.run_id` uses `Math.random()` and
  `new Date().toISOString()`; `BenchmarkRun.created_at` uses
  `new Date().toISOString()`. AGENTS.md §10 (pin everything in evals: fixture,
  code, policy, model) and §8 (deterministic where possible) together imply
  reruns should be byte-comparable given the same pins. Today, two runs against
  the same fixtures/policy produce different `run_id` and `created_at`, and
  the persisted `benchmark_runs/<id>.json` therefore changes every run.
- **Fix:** Use a deterministic id derived from the pinned tuple
  (`sha256({suite, pinned, fixture_hashes}).slice(0,16)`). For `created_at`,
  accept an injectable `clock` parameter on `runSuite` defaulting to `nowIso`
  so eval-harness tests can pin it.

### 11. [HIGH] Pacing detector divides by zero / produces Infinity findings

- **File:** `packages/evidence/src/detectors/pacing.ts:22-28`
- **Problem:** `if (!campaign || budget === undefined || rows.length < 3)`
  catches `undefined` but not `0`. The `Campaign` schema permits
  `daily_budget: 0` (`account.ts:38`: `z.number().nonnegative().optional()`).
  Line 26: `(recentSpend - budget) / budget` → `Infinity` or `NaN`. Line 35:
  `Math.abs(drift) >= 0.35 ? "high" : "medium"` → `Infinity >= 0.35` evaluates
  true; a 0-budget campaign with any positive spend gets a "high" pacing
  finding with `description: "...NaN%..."`.
- **Fix:** Add `|| budget <= 0` to the guard at line 23. Add a unit test for a
  zero-budget campaign with positive spend.

### 12. [HIGH] PolicyGuard rule-kind switch has no exhaustiveness check

- **File:** `packages/policy/src/policy-guard.ts:182-235`
- **Problem:** `brand_safety` and `platform_limit` rules fall through as no-ops
  with a comment "Not enforced by the MVP rules engine." There is no
  `default:` case. If a new rule kind is added to the `PolicyRule` schema and
  someone forgets to wire it here, the rule silently does nothing — fail-open
  by omission. AGENTS.md §6 says "Fail closed, never open."
- **Fix:** Add a TypeScript `assertNever`-style default that
  `throw new Error("policy_kind_unhandled:" + rule.kind)`. Add a test that
  feeds an unknown kind (via a fixture json that bypasses the Zod enum) and
  asserts the resulting decision is `"block"`.

### 13. [HIGH] Reflection agent's `evidence_refs` are non-deterministic

- **File:** `packages/agents/src/agents/reflection-agent.ts:84-87`
- **Problem:** The `evidence_refs` array includes
  `'trust_note:${newId("note")}'`. `newId` calls `ulid()` (random + clock). The
  enclosing `AgentOutput` is persisted via `persistRun` →
  `output_hash: sha256(output)` (orchestrator.ts:401). Re-running the workflow
  on identical inputs produces a different `output_hash` for the reflection
  run, which contradicts the comment in `orchestrator.ts:67-72` ("structural
  payloads and their `input_hash`/`output_hash` values are byte-identical").
- **Fix:** Replace the random note id with a deterministic one keyed off the
  input: `'trust_note:' + sha256({subject_id, outcomes}).slice(0, 12)`.

### 14. [MEDIUM] CLI `approve` cannot record a rejection

- **File:** `apps/cli/src/commands/approve.ts:5-19`,
  `apps/cli/src/support.ts:237-256`
- **Problem:** The command takes `--by` and `--note` only; the helper hardcodes
  `decision: "approved"`. There is no `admatix reject`. The CLI cannot record
  the rejected-by-human leg of the lifecycle in `ARCHITECTURE-DEEP.md §7`,
  meaning the trust ledger never sees `invalidated` outcomes from the CLI
  path.
- **Fix:** Add a `--decision <approved|rejected>` flag (default `approved`) or
  a sibling `admatix reject` command, and propagate the choice through
  `approvePacket`/`rollbackPacket`.

### 15. [MEDIUM] Approval receipt id collides with itself across edits

- **File:** `apps/cli/src/support.ts:244-256`
- **Problem:** `receipt_id` is hardcoded to `'approval_${packet.packet_id}'`.
  Approving the same packet twice (e.g. fixing a typo) silently overwrites the
  previous receipt under `data/state/approval_receipts/<id>.json`. The audit
  trail loses the original decision and `decided_at`.
- **Fix:** Use `newId("rec")` like the API route does
  (`apps/api/src/routes/approvals.ts:52`). Treat receipts as append-only.

### 16. [MEDIUM] `Guardrails` schema permits an empty object — no minimum
guardrail is required

- **File:** `packages/schemas/src/h0-packet.ts:22-27`,
  `packages/policy/src/policy-guard.ts:163-176`
- **Problem:** Every Guardrails field is optional. `guardrails: {}` parses.
  `evaluateAction` then falls back to `DEFAULT_BUDGET_CAP_PCT = 25` for
  budget_shift. AGENTS.md §6 wants fail-closed; per-account guardrails should
  be required, not defaulted.
- **Fix:** Require at least one of `max_daily_budget_delta_pct` /
  `max_cac` / `min_mer` via a Zod refinement, and remove the
  `DEFAULT_BUDGET_CAP_PCT` fallback (make missing → block).

### 17. [MEDIUM] `BenchmarkRun` written to disk on every run even though
nothing changed

- **File:** `packages/evals/src/run-suite.ts:54-63`
- **Problem:** Combined with #10, the run is stored under a randomized
  `run_id` and a wall-clock `created_at`. Running `pnpm benchmark` 10 times
  yields 10 different `benchmark_runs/*.json`. There is no dedup against the
  pinned tuple.
- **Fix:** Compute `run_id` from `sha256({suite, pinned, results})`. If a
  file with that id already exists, skip the write (or compare contents and
  fail if non-matching — that's a regression signal).

### 18. [MEDIUM] Detector findings are not deduped before they become packets

- **Files:** `packages/evidence/src/report.ts`,
  `packages/evidence/src/h0-builder.ts:11-50`
- **Problem:** `runAudit` concatenates detector outputs; nothing collapses two
  detectors flagging the same `(entity_id, reason)` into one finding. The h0
  builder then mints one packet per finding. Effects: duplicate packet ids
  (the id is `sha256({reportId, finding_id})` so different findings still
  produce different ids, but the underlying business issue is double-counted
  in `total_estimated_waste`) and inflated approval queues.
- **Fix:** In `report.ts`, dedupe by `(detector, entity_id, finding_id)` after
  sorting; recompute `total_estimated_waste` from the deduped set.

### 19. [MEDIUM] H0 builder silently drops `low`-severity findings

- **File:** `packages/evidence/src/h0-builder.ts:11-13`
- **Problem:** Only `high` and `medium` findings become packets. The audit
  report still contains the `low` finding, so a cockpit reader sees a finding
  with no corresponding packet and no rationale. The orchestrator test
  fixture (`test-fixtures.ts:101`) explicitly emits a `low`-severity tracking
  finding "so we have ≥3 packets" — but with the production builder, that
  finding would be discarded.
- **Fix:** Either include `low` (and let PolicyGuard / measurement scientist
  attach a "low-confidence" caveat) or emit a `Caveat` to the AuditReport
  explaining the drop, so the cockpit can render it.

### 20. [MEDIUM] Supply-path detector can emit fewer than the intended evidence
refs when `flagged` is small

- **File:** `packages/evidence/src/detectors/supply-path.ts:31-45`
- **Problem:** `evidence: flagged.slice(0, 3).map(...)`. When `flagged.length`
  is 1, the resulting evidence array has 1 element — which still satisfies
  `Finding.evidence.min(1)`, but the human-facing description claims
  "concentrated in low-quality supply paths" without showing the multi-row
  justification. Worse, the slice produces evidence rows that may not
  reference the most-illustrative row; for forensic value the `latest` flagged
  row should always be included.
- **Fix:** Always include `latest` plus up to two more, deduped:
  `evidence: dedupeBy(r => r.date, [latest, ...flagged.slice(-3)])`.

### 21. [MEDIUM] `apps/api/src/server.ts` logs request/response with fastify
default level "info" — no body redaction policy

- **File:** `apps/api/src/server.ts:25`
- **Problem:** Fastify's default logger logs `req`/`res` lines, which include
  URL and headers. AGENTS.md §9 forbids logging OAuth tokens. There is no
  `redact: ["req.headers.authorization", ...]` config and no policy
  documented. Today there are no tokens in flight (no auth middleware), but
  adding auth (recommended in #5/#7) would immediately leak them.
- **Fix:** Configure
  `logger: { level: "info", redact: ["req.headers.authorization", "req.headers.cookie"] }`
  in `buildServer`. Add a regression test that posts a fake `Authorization`
  header and asserts it never appears in captured log output.

### 22. [LOW] `Store.put` is not atomic and has no fsync

- **File:** `packages/core/src/store.ts:46-51`
- **Problem:** `writeFile` is a single non-atomic write. A crash mid-write
  leaves a partial JSON file that subsequent `get/list` calls will fail to
  parse, taking the entire JSONL/Store ledger out. For MVP this is probably
  acceptable, but worth recording so the eventual Postgres backing isn't done
  before the FS path gets a `writeFile(tmp); rename(tmp, final)` pattern.
- **Fix:** Write to `<file>.tmp`, then `rename` to `<file>`.

### 23. [LOW] Test fixtures duplicate production schemas with subtly different
units and naming

- **Files:** `packages/agents/src/test-fixtures.ts:164-187`,
  `packages/evidence/src/h0-builder.ts:24-49`
- **Problem:** The "test-only" h0 builder uses
  `max_daily_budget_delta_pct: 15` (percent) and `params: { delta_pct: -10 }`;
  the production builder uses `0.2` and `max_reduction_pct: 0.2`. The
  divergence is exactly what hides finding #3 from the test suite. The fact
  that test fixtures had to invent a "correct" shape is the strongest signal
  that the production shape is wrong.
- **Fix:** Delete the test-only builder. The orchestrator tests should run the
  production `buildH0Packets` and assert the integration. If
  `data/fixtures/google_ads/demo_campaigns.json` doesn't trigger ≥3 findings
  today, fix the fixture, not the builder.

### 24. [LOW] `resolveAccount` falls back to "first account" silently

- **File:** `packages/agents/src/orchestrator.ts:452-466`
- **Problem:** If the requested `accountId` is not found, the orchestrator
  picks `accounts[0]`. Combined with #9 (`live:` accepted as fixture), a
  caller can ask for `live:bogus_id` and get the demo account back without
  any warning. This makes mistakes look like successes.
- **Fix:** Throw on miss. Drop the "first account" fallback — fail-closed.

### 25. [LOW] `RoiCalculator`, `EvidenceCard`, etc. — web app trusts the API
result without re-validating against `@admatix/schemas`

- **Files:** `apps/web/src/lib/api.ts`, `apps/web/src/lib/types.ts`,
  `apps/web/src/components/*.tsx`
- **Problem:** The web app's `tryFetch` returns the JSON cast to a TS type,
  but never `.parse()`s through the shared schema. If the API ever returns a
  malformed body (e.g. a half-written `H0Packet`), the cockpit renders
  garbage rather than failing loudly. The fixtures-fallback path is checked
  but the live path is not.
- **Fix:** In `apps/web/src/lib/api.ts`, parse each response with the matching
  `@admatix/schemas` validator (`H0Packet.parse`, `AuditReport.parse`, etc.).

### 26. [LOW] No test exercises the production `buildH0Packets` end-to-end
through the orchestrator

- **Files:** `packages/agents/src/orchestrator.test.ts`,
  `packages/agents/src/test-fixtures.ts`
- **Problem:** Every orchestrator test passes `evidence: makeTestEvidenceDeps()`
  or `makeUnsafeEvidenceDeps()`. There is no test of `runWorkflow` against
  the default (production) `MediaAnalystAgent`. As a result, 165 green tests
  do not actually prove the integrated workflow runs without errors on
  `fixture:acc_demo`.
- **Fix:** Add a single acceptance test that omits `deps.evidence` and asserts
  the workflow completes with ≥1 packet, ≥1 decision, and the diff count
  matches a snapshot. This would have caught #3 and #4.

### 27. [LOW] `Store` events stream name is mangled by an adapter layer

- **File:** `packages/agents/src/orchestrator.ts:412-426`
- **Problem:** A workaround (the doc comment is honest about it) strips a
  leading `events/` prefix because `@admatix/policy`'s `emitEvent` and
  `@admatix/core`'s `Store.append` disagree on whether to include it.
  This is fragile: if either contract changes, events land in the wrong
  place silently. There is no test that verifies the on-disk path is
  `events/<workflow_id>.jsonl`.
- **Fix:** Pick one convention. Either `emitEvent` writes the workflow_id
  directly (and `Store` adds `events/`), or it passes a path the Store does
  not prefix. Remove the adapter.

### 28. [LOW] `Store` rejects ids with slashes — but `resolveAccountRef` allows
`.` and `-` in ids that get embedded in stream names indirectly

- **File:** `packages/core/src/store.ts:20-28`
- **Problem:** The `SAFE_NAME` regex is appropriately narrow. But the trust
  score subject id is sanitized at the call site
  (`orchestrator.ts:345-347: trust.subject_id.replace(/[^a-zA-Z0-9_.-]/g, "_")`)
  rather than enforced by the schema. If a caller writes directly to
  `store.put("trust_scores", "agent/x", ...)`, they get a clearer Store-level
  error than if they had used a more permissive scheme.
- **Fix:** Move the sanitization (or, better, reject at the schema level by
  refining `TrustScore.subject_id` to match `SAFE_NAME`).

---

## Overall health

Phase 1 is **structurally sound but operationally exposed**. The contract
discipline is real — schemas everywhere, validation at boundaries, the
read-only Connector interface, dry-run literals enforced by `z.literal(true)`,
deterministic hashing in `@admatix/core`. The "no live mutation" rule is
defended at three layers (schema, the connector interface having no write
methods, and the CLI's mandatory `--dry-run` flag).

But the **fail-closed claim is partly aspirational**. PolicyGuard is bypassed
on the MCP activation path (#1); EvidenceLedger checks shape, not provenance
(#2); the production H0 builder and PolicyGuard disagree on what
`budget_shift` params look like (#3); and the orchestrator builds dry-run
diffs for `needs_approval` packets without waiting for the receipt (#6).
None of these can write to a real platform today — but each one breaks the
governance story the architecture sells.

The biggest gap is **test coverage shape**: 165 passing tests is impressive,
but the orchestrator acceptance tests use a private test-only h0 builder
whose contract diverges from production in exactly the places the production
builder is broken (#3, #4, #23, #26). The CLI silently patches the same
divergence with `withCliDemoId`. Until the orchestrator runs against the
production `buildH0Packets`, the green CI is a false signal.

The API surface ships with **no auth at all** (#5, #7), no body-redaction
policy (#21), and no `ADMATIX_MODE` runtime check (#8). For a local demo this
is fine; before any kind of preview deployment it is unacceptable.

**Recommended pre-merge fixes (must-do for a `qa: pass`):** #1, #2, #3, #4,
#5, #6, #8, #10, #11, #12, #13, #26. The rest are tractable follow-ups that
can be tracked as WP-K (Hardening) items.

**Verdict:** **NOT READY FOR DEMO MERGE.** Strong foundation; the
specifically-flagged gaps need a hardening pass before this code is shown to
anyone outside the build team as a proof of the governed-by-default story.
