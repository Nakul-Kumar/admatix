# AdMatix — five-minute end-to-end demo

This is the narrated walkthrough that pairs with `scripts/demo.ts`. The
script is fully deterministic: every line in the transcript below is
produced by the live run on `data/fixtures/`, and the e2e test
(`tests/e2e/demo-flow.test.ts`) asserts the bytes match line-for-line.
Edit nothing in the transcript block — regenerate it instead by running
`pnpm tsx scripts/demo.ts > /tmp/admatix-demo.txt`.

To run the demo yourself:

```bash
pnpm install
pnpm tsx scripts/demo.ts
```

No live ad-platform credentials are used. The whole demo runs on
`fixture:acc_demo` and the `safety-v1` benchmark.

---

## Timestamped narration (target: ~5 minutes)

**0:00 — Frame the problem.** "Paid-media agents will propose changes;
the question is who governs them. AdMatix is the gate."

**0:20 — Step 1 — AUDIT.** Five deterministic detectors (tracking,
pacing, budget-waste, creative-fatigue, supply-path) run against the
fixture account. Every finding carries `evidence_refs` to concrete
fixture rows. The audit declares a directional caveat — *"Platform
metrics are directional, not causal."* — by design.

**0:50 — Step 2 — PLAN.** The orchestrator runs the four-step loop
(Plan → Activate → Measure → Reflect). MediaAnalyst drafts H0 packets;
EvidenceLedger verifies every claim has a source ref; PolicyGuard
evaluates every action; ApprovalCoordinator routes for human review.

**1:20 — Step 3 — PACKET.** Inspect `h0_001` — the hypothesis, the
null, the evidence refs, the guardrails, the rollback. **No rollback
block → no packet.** This is the contract the schema enforces.

**1:50 — Step 4 — ACTIVATE.** The PlatformAdapter translates the packet
into a `ProposedAction` (`dry_run_only: true` is a Zod literal — the
type system itself forbids live writes). DiffBuilder produces a
deterministic before/after diff. The decision is `needs_approval`.

**2:30 — Step 5 — POLICY BLOCK.** We deliberately submit a +60% budget
shift against a 20% cap. PolicyGuard returns `BLOCK` with rule
`budget_cap_v1` and a clear, attributable reason. This is the
fail-closed path — ambiguity or error → block, never allow.

**3:10 — Step 6 — BENCHMARK.** `safety-v1` runs 12 tasks against the
deterministic AdMatix baseline. Every fixture-version, code-version,
policy-version, and model is pinned in the run record, so the result is
reproducible bit-for-bit.

**3:50 — Step 7 — MCP.** An external agent (Claude, Codex, anyone with
an MCP client) sees only the six read-only/propose-only tools.
`activate_dry_run` without an `ApprovalReceipt` returns `status=blocked`
— write-shaped tools fail closed at the surface.

**4:20 — Step 8 — ROI + COCKPIT.** We compute the recovered-waste math
deterministically over the early vs. late window. The Fastify cockpit
API is exercised in-process via `inject()` so the dashboard surface is
proven to expose the same artifacts.

**5:00 — Close.** "Every line in the transcript is reproducible from a
fresh clone. There is no LLM in this loop — the gate is deterministic.
That is the property YC engineers can verify in one `pnpm tsx` command."

---

## Live transcript

```text
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

---

## How the test enforces this

`tests/e2e/demo-flow.test.ts`:

- Calls `runDemo({ output, storeRoot })` against a fresh temp store.
- Asserts all 8 step results are `ok`.
- Asserts at least one unsafe action is blocked with a visible reason.
- Reads the fenced ```text block above and compares it byte-for-byte
  to the live transcript — if you change one and not the other, the
  test fails.

If you intentionally change the demo output, regenerate the transcript
with `pnpm tsx scripts/demo.ts > out.txt` and paste the new bytes into
the fenced block above. No other edit is required.
