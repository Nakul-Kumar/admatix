# WP-K — Integration & demo · phase report

**Branch:** `wp/k-integration` · **Wave:** 4 · **Status:** shipped
**Owns:** `tests/e2e/**`, `scripts/demo.ts`, `docs/runbooks/demo-script.md`,
README "Status" section.
**Depends on:** every prior WP (`@admatix/schemas`, `@admatix/core`,
`@admatix/connectors`, `@admatix/evidence`, `@admatix/policy`,
`@admatix/agents`, `@admatix/evals`, `@admatix/mcp-server`, `@admatix/api`).

## What shipped

WP-K is the Phase 1 finish line: one runnable command that drives every
shipped package and app through the four-step gated loop end to end, on
fixtures, with no LLM and no live platform calls anywhere in the codepath.

### `scripts/demo.ts`
A single command (`pnpm tsx scripts/demo.ts` / `pnpm demo`) that runs the
eight-step demo defined in `docs/build/00-BUILD-ORCHESTRATION.md §1`:

1. **AUDIT** — `runAudit` against the `fixture:acc_demo` Google Ads fixture,
   3 evidence-backed findings, `total_estimated_waste = $2,321.00`.
2. **PLAN** — `runWorkflow` orchestrator emits H0 packets through every
   gate (MediaAnalyst → EvidenceLedger → MeasurementScientist →
   PlatformAdapter → PolicyGuard → ApprovalCoordinator → DiffBuilder →
   Reflection).
3. **PACKET** — `verifyEvidence` confirms the packet is valid; the
   transcript prints hypothesis, null, goal, evidence refs, guardrails,
   rollback, and the ledger verdict.
4. **ACTIVATE** — PlatformAdapter translates to a `ProposedAction`,
   DiffBuilder produces a dry-run `ExecutionDiff` showing
   `daily_budget: 500 -> 400 (-20%)`. `dry_run: true` is a Zod literal
   — the type system itself blocks any mutation path.
5. **POLICY BLOCK** — a deliberately unsafe +60% budget shift against a
   20% cap is sent through `evaluateAction`; PolicyGuard returns
   `result: "block"` with rules `budget_cap_v1, approval_required_v1`
   and a clear, attributable reason.
6. **BENCHMARK** — `runSuite("safety-v1")` against the deterministic
   AdMatix baseline: 12/12 tasks passed, 0 unsafe write attempts, every
   pinned dimension (fixture / code / policy / model) recorded.
7. **MCP** — six read-only/propose-only tools are advertised; an in-process
   `auditAccountTool` call returns `status=ok`; `activateDryRunTool`
   without an `ApprovalReceipt` returns `status=blocked` with reason
   `approval_receipt_required_for_write_shaped_dry_run`.
8. **ROI + COCKPIT** — `computeImpact` on the early vs. late window
   reports a recovered-waste estimate of $1,397.68; the Fastify cockpit
   API is exercised in-process via `app.inject()` for `/healthz`,
   `/api/v1/audits`, `/api/v1/packets`, `/api/v1/approvals`.

The transcript printed to stdout is **byte-deterministic** — same fixtures,
same demo, same bytes across every run.

### `tests/e2e/demo-flow.test.ts`
10 acceptance assertions covering: all 8 steps green, evidence-backed
findings, packets carrying rollback + dry-run-only proposals, the diff
being a dry-run, PolicyGuard blocking with a visible reason, the
benchmark scorecard, the MCP six-tool contract + write-shaped failure,
the cockpit `/api/v1` surface, byte-level determinism across two runs,
and a **line-for-line match** between the live transcript and the fenced
`` ```text `` block in the runbook.

### `docs/runbooks/demo-script.md`
The 5-minute narration, timestamped, with the exact live transcript
embedded inline; the runbook is what the e2e test diffs against.

### Other WP-K-owned tweaks
- `README.md` — Status section now lists every WP and the one-command
  demo recipe.
- `vitest.config.ts` — `include` adds `tests/e2e/**/*.test.ts`; a 30 s
  timeout for the orchestration-heavy e2e run.
- `tsconfig.json` (new, root) — typechecks `scripts/**` and `tests/**`
  with `paths` for `@admatix/*`.
- `package.json` — adds the workspace devDeps the script imports;
  `pnpm test` now invokes a single `vitest run` (the previous
  `turbo run test` raced the MCP stdio test under parallel
  per-package vitest instances).

`packages/schemas` was not touched. No other WP's source code was
edited. Only the root config files needed to wire the new tests/e2e
suite and root-level demo script into the workspace were updated.

## Acceptance tests (WP-K spec)

| # | Acceptance test | Status | How it is verified |
|---|---|---|---|
| 1 | `pnpm tsx scripts/demo.ts` runs the full flow and exits 0 | PASS | Live run captured below — exit code 0 |
| 2 | `tests/e2e/demo-flow.test.ts` asserts all 8 demo steps and is green | PASS | 10 / 10 vitest cases pass |
| 3 | The demo blocks at least one unsafe action with a visible reason | PASS | Step 5: `decision.result === "block"`, rules `budget_cap_v1, approval_required_v1`, reason `budget_shift |60%| exceeds the 20% cap` |
| 4 | `docs/runbooks/demo-script.md` matches the real transcript line for line | PASS | `extractTranscriptBlock(runbook)` === captured transcript in the dedicated test case |
| 5 | `pnpm typecheck && pnpm test` is green across the whole workspace | PASS | 18 turbo typecheck tasks green + root `tsc -p tsconfig.json` green; 27 test files / 175 tests pass |

## Verification output

### `pnpm typecheck`
```
admatix:typecheck: > tsc -p tsconfig.json --noEmit
admatix:typecheck:
@admatix/mcp-server:typecheck:
@admatix/mcp-server:typecheck: > @admatix/mcp-server@0.1.0 typecheck
@admatix/mcp-server:typecheck: > tsc -p tsconfig.json --noEmit
@admatix/mcp-server:typecheck:
@admatix/api:typecheck:
@admatix/api:typecheck: > @admatix/api@0.1.0 typecheck
@admatix/api:typecheck: > tsc -p tsconfig.json --noEmit
@admatix/api:typecheck:

 Tasks:    18 successful, 18 total
Cached:    0 cached, 18 total
  Time:    38.355s
```

### `pnpm test`
```
 Test Files  27 passed (27)
      Tests  175 passed (175)
   Start at  06:21:10
   Duration  4.87s
```

### `pnpm scan-secrets`
```
scan-secrets: no token-shaped secrets found.
```

### `pnpm tsx scripts/demo.ts` — live transcript
```
AdMatix end-to-end demo — fixture:acc_demo (no live platform calls)
===================================================================

[1/8] AUDIT  — admatix audit --account fixture:acc_demo
      window: 2026-05-12..2026-05-21
      findings: 3
      estimated waste: $2321.00
        - [high] budget-waste on campaign_a waste=$857.00
        - [high] pacing on campaign_a waste=$607.00
        - [medium] budget-waste on campaign_a waste=$857.00
      caveats: Platform-reported metrics are directional, not causal.

[2/8] PLAN   — admatix plan --goal "reduce CAC 10% without MER below 3.0"
      H0 packets emitted: 3
      evidence-ledger gate: 3/3 passed
      orchestrator decisions: 3 (PolicyGuard runs on every action)

[3/8] PACKET — admatix packet show h0_001
      hypothesis: Reducing inefficient spend on campaign_a will lower wasted spend while conversion volume remains inside guardrails.
      null:       No intervention on campaign_a will improve reduce CAC 10% without MER below 3.0; observed platform metrics may revert without action.
      goal:       reduce CAC 10% without MER below 3.0
      success metric: estimated_waste_reduction
      causal status:  directional_until_lift_test
      evidence refs: 3
        - google_ads_fixture:metric:campaign_daily:acc_demo:campaign_a:2026-05-12
        - google_ads_fixture:metric:campaign_daily:acc_demo:campaign_a:2026-05-21
        - google_ads_fixture:metric:campaign_daily:acc_demo:campaign_a:2026-05-21
      guardrails: max_daily_budget_delta_pct=20% requires_human_approval=true
      proposal: budget_shift -> campaign_a (dry_run_only=true)
      rollback: restore_previous_budget (checkpoint checkpoint_8623a6cfbc77)
      evidence ledger: ok

[4/8] ACTIVATE — admatix activate h0_001 --dry-run
      action type: budget_shift (target campaign_a, risk high)
      policy decision: needs_approval (rules: approval_required_v1)
      diff: 1 change(s), dry_run=true
        - daily_budget: 500 -> 400 (delta -20.00%)

[5/8] POLICY BLOCK — proposing a 60% budget shift against a 20% cap
      policy version: v1
      proposed delta: +60% (cap: 20%)
      decision: BLOCK
      matched rules: budget_cap_v1, approval_required_v1
      reason: budget_shift |60%| exceeds the 20% cap (rule budget_cap_v1).
      reason: Action type budget_shift is spend-touching; human approval required (rule approval_required_v1).

[6/8] BENCHMARK — admatix benchmark run --suite safety-v1
      suite: safety-v1
      tasks: 12 (passed 12 / failed 0)
      unsafe write attempts: 0
      mean score: 1.00
      mean evidence coverage: 0.25
      mean rollback coverage: 0.25
      pinned: fixture=demo-2026-05-22 code=0.1.0 policy=policy-v1 model=none

[7/8] MCP — read-only agent tool surface
      tools: activate_dry_run, audit_account, create_plan, run_benchmark, show_h0_packet, validate_h0_packet
      audit_account → status=ok source_refs=3
      activate_dry_run (no receipt) → status=blocked reason=approval_receipt_required_for_write_shaped_dry_run

[8/8] ROI + COCKPIT — what the dashboard would show an operator
      ROI math: baseline CAC $39.73 (2026-05-12..2026-05-17) vs current CAC $58.87 (2026-05-18..2026-05-21)
      recovered_waste if CAC restored: $1397.68
      audit-level estimated_waste: $2321.00 across 3 findings
      GET /healthz → {"ok":true,"service":"admatix-api"}
      GET /api/v1/audits → 1 report(s)
      GET /api/v1/packets → 6 packet(s)
      GET /api/v1/approvals → 1 receipt(s)

===================================================================
Demo complete — 8/8 steps green, 1 unsafe action blocked, 3 findings, 3 H0 packets.
```

### `npx vitest run tests/e2e/demo-flow.test.ts`
```
 ✓ tests/e2e/demo-flow.test.ts (10 tests) 532ms

 Test Files  1 passed (1)
      Tests  10 passed (10)
```

## Golden-rule audit

| Rule | Held |
|---|---|
| 1. `packages/schemas` is the contract — no new types | Yes — every payload is a schema type from `@admatix/schemas`. |
| 2. Fixtures only | Yes — `ADMATIX_MODE=fixtures` path only; the demo runs on `data/fixtures/`. |
| 3. Dry-run only | Yes — every `ExecutionDiff.dry_run = true` (Zod literal); the e2e test asserts it. |
| 4. Every claim has source refs | Yes — `audit.findings.evidence` non-empty, asserted in the e2e test. |
| 5. Every proposed action has a rollback | Yes — `packet.rollback.checkpoint_id` non-empty, asserted in the e2e test. |
| 6. Two mandatory gates | Yes — EvidenceLedger validates the packet (step 3); PolicyGuard blocks unsafe (step 5). |
| 7. Read & write tools separate | Yes — MCP write-shaped tool blocks without an `ApprovalReceipt` (step 7). |
| 8. Deterministic | Yes — transcript byte-identical across runs, asserted in the e2e test. |
| 9. No secrets, no PII | Yes — `pnpm scan-secrets` clean; no OAuth tokens touched. |
| 10. Pin everything in evals | Yes — every benchmark run records fixture/code/policy/model. |

## What's next

WP-K closes Phase 1 of the Proof Wave. The next slices are Phase 2
(Supabase data layer — WP-L/M/N/O) per
`docs/build/AUTONOMOUS-WAVE-PLAN.md`.
