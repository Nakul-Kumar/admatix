import { H0Packet } from "@admatix/schemas";
import { describe, expect, it } from "vitest";
import { evaluateAction } from "@admatix/policy";
import { buildH0Packets, runAudit } from "./index.js";
import { loadCampaignInput } from "./test-utils.js";

describe("WP-D acceptance", () => {
  it("runAudit on agency-demo yields 3-5 findings and non-zero estimated waste", () => {
    const report = runAudit(
      loadCampaignInput("google_ads", "demo_campaigns.json"),
      "2026-05-12..2026-05-21",
    );
    expect(report.findings.length).toBeGreaterThanOrEqual(3);
    expect(report.findings.length).toBeLessThanOrEqual(5);
    expect(report.total_estimated_waste).toBeGreaterThan(0);
    expect(report.caveats).toContain("Platform-reported metrics are directional, not causal.");
  });

  it("buildH0Packets emits schema-valid dry-run packets with rollbacks", () => {
    const report = runAudit(
      loadCampaignInput("google_ads", "demo_campaigns.json"),
      "2026-05-12..2026-05-21",
    );
    const packets = buildH0Packets(report, "reduce wasted spend", "tenant_demo");
    // buildH0Packets filters to high/medium severity. The demo fixture's
    // findings are all high/medium, so the count matches.
    const expectedCount = report.findings.filter(
      (f) => f.severity === "high" || f.severity === "medium",
    ).length;
    expect(packets.length).toBe(expectedCount);
    for (const packet of packets) {
      expect(() => H0Packet.parse(packet)).not.toThrow();
      expect(packet.rollback.method).toBeTruthy();
      expect(packet.rollback.checkpoint_id).toBeTruthy();
      expect(packet.proposal.dry_run_only).toBe(true);
      expect(packet.approval.status).toBe("pending");
    }
  });

  // QA finding #3 (CRITICAL): the production builder previously wrote
  // `params: { max_reduction_pct: 0.2 }` but PolicyGuard's budget_cap
  // rule reads `params.delta_pct`. So every budget_shift came back as
  // "block — missing params.delta_pct" via the API/MCP/orchestrator
  // paths, hidden only because tests used a private test-only builder.
  // This integration test would have caught it: at least one
  // budget_shift packet from the production pipeline MUST reach
  // `needs_approval` (the documented "human signs" state), never
  // `block`.
  it("F3: production pipeline produces ≥1 budget_shift that PolicyGuard accepts as needs_approval", () => {
    const report = runAudit(
      loadCampaignInput("google_ads", "demo_campaigns.json"),
      "2026-05-12..2026-05-21",
    );
    const packets = buildH0Packets(report, "reduce wasted spend", "tenant_demo");
    const budgetShiftPackets = packets.filter(
      (p) => p.proposal.action === "budget_shift",
    );
    expect(budgetShiftPackets.length).toBeGreaterThan(0);
    let needsApprovalCount = 0;
    let blockCount = 0;
    for (const packet of budgetShiftPackets) {
      const decision = evaluateAction(
        {
          action_id: `act_${packet.packet_id}`,
          packet_id: packet.packet_id,
          type: "budget_shift",
          target_entity_id: packet.proposal.target_entity_id ?? "",
          params: packet.proposal.params,
          risk_level: "high",
          dry_run_only: true,
        },
        { guardrails: packet.guardrails },
      );
      if (decision.result === "needs_approval") needsApprovalCount += 1;
      if (decision.result === "block") {
        blockCount += 1;
        // If this fires, the production builder's params shape is
        // misaligned with PolicyGuard's expected shape — exactly the
        // bug the test is here to prevent. Surface the reasons.
        throw new Error(
          `PolicyGuard blocked a production budget_shift packet: ${decision.reasons.join("; ")}`,
        );
      }
    }
    expect(blockCount).toBe(0);
    expect(needsApprovalCount).toBeGreaterThan(0);
  });
});
