import { describe, it, expect } from "vitest";
import { H0Packet, ProposedAction, AuditReport } from "./index.js";

const validPacket = {
  packet_id: "h0_001",
  tenant_id: "tenant_demo",
  goal: "Reduce CAC while preserving MER",
  hypothesis: "Shifting 15% of Campaign A budget to Campaign B reduces CAC 8%.",
  null_hypothesis: "The shift does not improve CAC after conversion lag.",
  baseline_window: "2026-05-01..2026-05-21",
  success_metric: "blended_cac",
  guardrails: { max_daily_budget_delta_pct: 15, min_mer: 3.0, requires_human_approval: true },
  evidence: [{ source: "google_ads_fixture", ref: "metric:campaign_daily:123" }],
  causal_status: "directional_until_lift_test",
  proposal: { action: "budget_shift", params: {}, dry_run_only: true },
  rollback: { method: "restore_previous_budget", checkpoint_id: "chk_001" },
  approval: { status: "pending", required_role: "media_lead" },
  created_by_agent: "planner",
  created_at: "2026-05-22T00:00:00Z",
  trace_id: "trace_abc",
};

describe("H0Packet contract", () => {
  it("accepts a valid packet", () => {
    expect(() => H0Packet.parse(validPacket)).not.toThrow();
  });

  it("rejects a packet with no evidence", () => {
    expect(() => H0Packet.parse({ ...validPacket, evidence: [] })).toThrow();
  });

  it("rejects a packet missing the rollback block", () => {
    const { rollback, ...noRollback } = validPacket;
    expect(() => H0Packet.parse(noRollback)).toThrow();
  });
});

describe("ProposedAction contract", () => {
  it("forces dry_run_only to true in the MVP", () => {
    expect(() =>
      ProposedAction.parse({
        action_id: "a1",
        packet_id: "h0_001",
        type: "budget_shift",
        target_entity_id: "campaign_a",
        params: {},
        risk_level: "medium",
        dry_run_only: false,
      }),
    ).toThrow();
  });
});

describe("AuditReport contract", () => {
  it("accepts an empty-findings report", () => {
    expect(() =>
      AuditReport.parse({
        report_id: "r1",
        account_id: "acc1",
        window: "2026-05-01..2026-05-21",
        findings: [],
        total_estimated_waste: 0,
        caveats: ["Platform attribution is directional, not causal."],
        generated_at: "2026-05-22T00:00:00Z",
      }),
    ).not.toThrow();
  });
});
