import { describe, expect, it } from "vitest";
import type { H0Packet } from "@admatix/schemas";
import { makeEvidenceLedgerAgent } from "./evidence-ledger-agent.js";

const validPacket: H0Packet = {
  packet_id: "h0_v",
  tenant_id: "t1",
  goal: "reduce_cac",
  hypothesis: "h",
  null_hypothesis: "n",
  baseline_window: "2026-05-12..2026-05-21",
  success_metric: "cac",
  guardrails: { requires_human_approval: true },
  evidence: [{ source: "src", ref: "ref" }],
  causal_status: "directional_until_lift_test",
  proposal: {
    action: "no_op",
    target_entity_id: "c1",
    params: {},
    dry_run_only: true,
  },
  rollback: { method: "noop", checkpoint_id: "ckpt_x" },
  approval: { status: "pending", required_role: "approver" },
  created_by_agent: "media-analyst",
  created_at: new Date().toISOString(),
  trace_id: "trace_t1",
};

describe("evidence-ledger-agent", () => {
  it("returns ok for a valid packet", async () => {
    const { verify } = makeEvidenceLedgerAgent({ traceId: "trace_x" });
    const r = await verify({ subject: validPacket });
    expect(r.ok).toBe(true);
    expect(r.missing).toEqual([]);
    expect(r.output.confidence).toBe(1);
  });

  it("fails closed on missing evidence", async () => {
    const { verify } = makeEvidenceLedgerAgent({ traceId: "trace_x" });
    const r = await verify({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      subject: { ...validPacket, evidence: [] as any },
    });
    expect(r.ok).toBe(false);
    expect(r.missing).toContain("evidence");
    expect(r.output.warnings.length).toBeGreaterThan(0);
  });
});
