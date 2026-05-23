import { H0Packet } from "@admatix/schemas";
import { describe, expect, it } from "vitest";
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
    expect(packets.length).toBe(report.findings.length);
    for (const packet of packets) {
      expect(() => H0Packet.parse(packet)).not.toThrow();
      expect(packet.rollback.method).toBeTruthy();
      expect(packet.rollback.checkpoint_id).toBeTruthy();
      expect(packet.proposal.dry_run_only).toBe(true);
      expect(packet.approval.status).toBe("pending");
    }
  });
});
