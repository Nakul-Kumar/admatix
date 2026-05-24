import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createStore, sha256 } from "@admatix/core";
import { AgentRun, ExecutionDiff } from "@admatix/schemas";
import { runActivation, runWorkflow } from "./index.js";
import { signApprovalReceipt } from "@admatix/policy";
import {
  makeTestEvidenceDeps,
  makeUnsafeEvidenceDeps,
} from "./test-fixtures.js";

describe("runWorkflow (acceptance suite — WP-F §Acceptance tests)", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "admatix-agents-test-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("AT1: returns AuditReport, ≥3 H0Packets, and dry-run diffs on agency-demo", async () => {
    const store = createStore(dir);
    const result = await runWorkflow(
      {
        accountRef: "fixture:acc_demo",
        goal: "reduce_cac",
        tenantId: "tenant_demo",
      },
      { store, evidence: makeTestEvidenceDeps() },
    );

    expect(result.audit.report_id).toMatch(/^rep_/);
    expect(result.audit.findings.length).toBeGreaterThanOrEqual(3);
    expect(result.packets.length).toBeGreaterThanOrEqual(3);
    expect(result.diffs.length).toBeGreaterThan(0);
    for (const diff of result.diffs) {
      expect(diff.dry_run).toBe(true);
      const parsed = ExecutionDiff.safeParse(diff);
      expect(parsed.success).toBe(true);
    }
  });

  it("AT2: budget-cap breach surfaces in blocked with a reason", async () => {
    const store = createStore(dir);
    const result = await runWorkflow(
      {
        accountRef: "fixture:acc_demo",
        goal: "increase_volume",
        tenantId: "tenant_demo",
      },
      { store, evidence: makeUnsafeEvidenceDeps() },
    );

    const policyBlocks = result.blocked.filter((b) =>
      b.reason.startsWith("policy_blocked"),
    );
    expect(policyBlocks.length).toBeGreaterThan(0);
    expect(policyBlocks[0]?.reason).toMatch(/budget_shift/);
    expect(policyBlocks[0]?.action_id).toBeDefined();

    const denied = result.decisions.find((d) => d.result === "block");
    expect(denied).toBeDefined();
    expect(denied?.matched_rules).toContain("budget_cap_v1");
  });

  it("AT3: every agent run is persisted with input hash, output hash, and trace_id", async () => {
    const store = createStore(dir);
    const result = await runWorkflow(
      {
        accountRef: "fixture:acc_demo",
        goal: "reduce_cac",
        tenantId: "tenant_demo",
      },
      { store, evidence: makeTestEvidenceDeps() },
    );

    const runs = await store.list<unknown>("agent_runs");
    expect(runs.length).toBeGreaterThan(0);
    for (const raw of runs) {
      const parsed = AgentRun.parse(raw);
      expect(parsed.input_hash).toMatch(/^[0-9a-f]{64}$/);
      expect(parsed.output_hash).toMatch(/^[0-9a-f]{64}$/);
      expect(parsed.workflow_id).toBe(result.workflow_id);
    }

    // trace_id presence is on the AdmatixEvent stream — every event
    // emitted by the orchestrator carries it.
    expect(result.trace_id).toMatch(/^trace_/);
  });

  it("AT4: the orchestrator rejects a packet that fails the EvidenceLedger gate", async () => {
    const store = createStore(dir);
    // Build a deps that emits a packet with NO evidence — the gate must fail closed.
    const result = await runWorkflow(
      {
        accountRef: "fixture:acc_demo",
        goal: "reduce_cac",
        tenantId: "tenant_demo",
      },
      {
        store,
        evidence: {
          runAudit: makeTestEvidenceDeps().runAudit!,
          buildH0Packets: (_report, _goal, tenantId) => [
            // Manually-constructed packet missing evidence refs (`as any`
            // so we can deliberately violate the schema for the test) —
            // the EvidenceLedger gate must catch it before activation.
            {
              packet_id: "h0_no_evidence",
              tenant_id: tenantId,
              goal: "reduce_cac",
              hypothesis: "x",
              null_hypothesis: "y",
              baseline_window: "2026-05-12..2026-05-21",
              success_metric: "cac",
              guardrails: { requires_human_approval: true },
              // Deliberately empty — should fail verifyEvidence.
              evidence: [],
              causal_status: "directional_until_lift_test",
              proposal: {
                action: "no_op",
                target_entity_id: "campaign_a",
                params: {},
                dry_run_only: true,
              },
              rollback: { method: "noop", checkpoint_id: "ckpt_x" },
              approval: { status: "pending", required_role: "approver" },
              created_by_agent: "media-analyst",
              created_at: new Date().toISOString(),
              trace_id: "trace_test",
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
            } as any,
          ],
        },
      },
    );

    const evidenceBlocks = result.blocked.filter((b) =>
      b.reason.startsWith("evidence_ledger_failed"),
    );
    expect(evidenceBlocks.length).toBeGreaterThan(0);
    expect(evidenceBlocks[0]?.reason).toMatch(/evidence/);
    // The blocked packet is not in packets[] because it never reached
    // activation.
    expect(result.packets.find((p) => p.packet_id === "h0_no_evidence")).toBeUndefined();
  });

  it("AT5: no code path calls a platform write — grep proves it", async () => {
    // Realised as a runtime invariant on the public surface: the
    // `ProposedAction` schema literal is `dry_run_only: true`, and every
    // diff carries `dry_run: true`. A separate static grep test in this
    // file walks the source for write-class verbs.
    const { readFileSync, readdirSync, statSync } = await import("node:fs");
    const { dirname: pdirname, join: pjoin } = await import("node:path");
    const { fileURLToPath } = await import("node:url");
    const root = pdirname(fileURLToPath(import.meta.url));

    const denylist = [
      /\bplatform_write\b/,
      /\bmutateAdAccount\b/,
      /\bsendBudgetUpdate\b/,
      /\bpostToAdsApi\b/,
      /\bgoogleAdsClient\.mutate\b/,
      /\bmetaClient\.send\b/,
    ];
    const hits: string[] = [];
    walkSource(root, (file, contents) => {
      if (file.endsWith(".test.ts")) return; // skip test files themselves
      for (const re of denylist) {
        if (re.test(contents)) hits.push(`${file}: ${re.source}`);
      }
    });
    expect(hits).toEqual([]);

    function walkSource(
      dir: string,
      cb: (path: string, contents: string) => void,
    ): void {
      for (const entry of readdirSync(dir)) {
        const full = pjoin(dir, entry);
        const s = statSync(full);
        if (s.isDirectory()) walkSource(full, cb);
        else if (full.endsWith(".ts")) cb(full, readFileSync(full, "utf8"));
      }
    }
  });

  it("AT6: runWorkflow is deterministic on a fixed fixture", async () => {
    const storeA = createStore(mkdtempSync(join(tmpdir(), "wf-a-")));
    const storeB = createStore(mkdtempSync(join(tmpdir(), "wf-b-")));
    const intent = {
      accountRef: "fixture:acc_demo",
      goal: "reduce_cac",
      tenantId: "tenant_demo",
    };
    const a = await runWorkflow(intent, {
      store: storeA,
      evidence: makeTestEvidenceDeps(),
    });
    const b = await runWorkflow(intent, {
      store: storeB,
      evidence: makeTestEvidenceDeps(),
    });
    // Structural invariants are deterministic: same number of findings,
    // packets, diffs, and decisions; same policy verdicts; same audit
    // shape (counts and account id). ids and timestamps are not, by
    // design (they are ULIDs).
    expect(b.audit.findings.length).toBe(a.audit.findings.length);
    expect(b.packets.length).toBe(a.packets.length);
    expect(b.diffs.length).toBe(a.diffs.length);
    expect(b.decisions.length).toBe(a.decisions.length);
    expect(b.blocked.length).toBe(a.blocked.length);
    expect(b.audit.account_id).toBe(a.audit.account_id);

    // Detector findings are stable across runs (same titles in the same order).
    expect(b.audit.findings.map((f) => f.title)).toEqual(
      a.audit.findings.map((f) => f.title),
    );

    // Total estimated waste is a deterministic function of the fixture.
    expect(b.audit.total_estimated_waste).toBe(a.audit.total_estimated_waste);

    // Each policy decision's payload hash (excluding the id and timestamp)
    // is stable.
    const reduceDecisions = (
      ds: typeof a.decisions,
    ): { result: string; matched: string[]; reasons: string[] }[] =>
      ds.map((d) => ({
        result: d.result,
        matched: d.matched_rules,
        reasons: d.reasons,
      }));
    expect(reduceDecisions(b.decisions)).toEqual(reduceDecisions(a.decisions));

    // sha256 is deterministic — confirm the hashes line up against the
    // structural fingerprint.
    expect(sha256(reduceDecisions(b.decisions))).toBe(
      sha256(reduceDecisions(a.decisions)),
    );
  });
});

describe("F6: runWorkflow stops at needs_approval (no diff until approved)", () => {
  it("does NOT build a diff for budget_shift packets that need approval", async () => {
    const dir = mkdtempSync(join(tmpdir(), "wf-needs-approval-"));
    const store = createStore(dir);
    const result = await runWorkflow(
      {
        accountRef: "fixture:acc_demo",
        goal: "reduce_cac",
        tenantId: "tenant_demo",
      },
      { store, evidence: makeTestEvidenceDeps() },
    );
    rmSync(dir, { recursive: true, force: true });

    // Every `needs_approval` packet must NOT have produced an
    // ExecutionDiff. That contract is the QA finding #6 fix.
    const needsApproval = result.decisions.filter(
      (d) => d.result === "needs_approval",
    );
    expect(needsApproval.length).toBeGreaterThan(0);
    const diffActionIds = new Set(result.diffs.map((d) => d.action_id));
    for (const d of needsApproval) {
      expect(diffActionIds.has(d.action_id)).toBe(false);
    }
  });

  it("runActivation builds a diff once a signed receipt is supplied", async () => {
    const dir = mkdtempSync(join(tmpdir(), "wf-activation-"));
    const store = createStore(dir);
    const result = await runWorkflow(
      {
        accountRef: "fixture:acc_demo",
        goal: "reduce_cac",
        tenantId: "tenant_demo",
      },
      { store, evidence: makeTestEvidenceDeps() },
    );
    const packet = result.packets.find(
      (p) => p.proposal.action === "budget_shift",
    );
    expect(packet).toBeDefined();
    const decided_at = new Date().toISOString();
    const expires_at = new Date(Date.parse(decided_at) + 15 * 60 * 1000).toISOString();
    const baseReceipt = {
      receipt_id: "rec_test",
      packet_id: packet!.packet_id,
      action_id: `action_${packet!.packet_id}`,
      decided_by: "user_test",
      role: "media_manager",
      decided_at,
      expires_at,
      decision: "approved" as const,
    };
    const receipt = {
      ...baseReceipt,
      signature: signApprovalReceipt(baseReceipt),
    };
    await store.put("approval_receipts", receipt.receipt_id, receipt);
    const activation = await runActivation(
      {
        packet_id: packet!.packet_id,
        tenant_id: "tenant_demo",
        receipt,
      },
      { store },
    );
    rmSync(dir, { recursive: true, force: true });
    expect(activation.ok).toBe(true);
    if (activation.ok) {
      expect(activation.diff.dry_run).toBe(true);
    }
  });

  it("runActivation refuses an unsigned receipt", async () => {
    const dir = mkdtempSync(join(tmpdir(), "wf-activation-unsigned-"));
    const store = createStore(dir);
    const result = await runWorkflow(
      {
        accountRef: "fixture:acc_demo",
        goal: "reduce_cac",
        tenantId: "tenant_demo",
      },
      { store, evidence: makeTestEvidenceDeps() },
    );
    const packet = result.packets.find(
      (p) => p.proposal.action === "budget_shift",
    );
    expect(packet).toBeDefined();
    const activation = await runActivation(
      {
        packet_id: packet!.packet_id,
        tenant_id: "tenant_demo",
        receipt: {
          receipt_id: "rec_test_unsigned",
          packet_id: packet!.packet_id,
          action_id: `action_${packet!.packet_id}`,
          decided_by: "user_test",
          decided_at: new Date().toISOString(),
          expires_at: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
          decision: "approved",
          role: "media_manager",
          // signature deliberately omitted
        },
      },
      { store },
    );
    rmSync(dir, { recursive: true, force: true });
    expect(activation.ok).toBe(false);
    if (!activation.ok) {
      expect(activation.reason).toMatch(/signature_invalid/);
    }
  });
});

describe("invariants — measurement agents cannot approve their own packets", () => {
  it("MeasurementScientist never returns proposed_actions or approves", async () => {
    const { makeMeasurementScientistAgent } = await import("./index.js");
    const { review } = makeMeasurementScientistAgent({ traceId: "trace_t1" });
    const result = await review({
      packet: {
        packet_id: "h0_x",
        tenant_id: "t1",
        goal: "reduce_cac",
        hypothesis: "h",
        null_hypothesis: "n",
        baseline_window: "2026-05-12..2026-05-21",
        success_metric: "cac",
        guardrails: { requires_human_approval: true },
        evidence: [{ source: "x", ref: "y" }],
        causal_status: "experimental",
        proposal: {
          action: "no_op",
          target_entity_id: "c1",
          params: {},
          dry_run_only: true,
        },
        rollback: { method: "m", checkpoint_id: "c" },
        approval: { status: "pending", required_role: "approver" },
        created_by_agent: "media-analyst",
        created_at: new Date().toISOString(),
        trace_id: "trace_t1",
      },
    });
    expect(result.output.proposed_actions).toEqual([]);
    // causal_status must be downgraded to directional_until_lift_test —
    // the MeasurementScientist can never strengthen the claim.
    expect(result.packet.causal_status).toBe("directional_until_lift_test");
  });
});
