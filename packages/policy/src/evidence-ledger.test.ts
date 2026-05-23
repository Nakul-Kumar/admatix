import { describe, it, expect } from "vitest";
import type { Finding, H0Packet } from "@admatix/schemas";
import { verifyEvidence } from "./evidence-ledger.js";

function basePacket(overrides: Partial<H0Packet> = {}): H0Packet {
  return {
    packet_id: "h0_01",
    tenant_id: "tenant_01",
    goal: "reduce CAC",
    hypothesis: "Pausing low-MER campaigns reduces blended CAC.",
    null_hypothesis: "No effect.",
    baseline_window: "2026-04-22..2026-05-21",
    success_metric: "blended_cac",
    guardrails: { requires_human_approval: true },
    evidence: [
      {
        source: "google_ads_fixture",
        ref: "metric:campaign_daily:camp_01",
      },
    ],
    causal_status: "directional_until_lift_test",
    proposal: {
      action: "pause_entity",
      target_entity_id: "camp_01",
      params: {},
      dry_run_only: true,
    },
    rollback: {
      method: "restore_previous_status",
      checkpoint_id: "ckpt_01",
    },
    approval: {
      status: "pending",
      required_role: "media_lead",
    },
    created_by_agent: "MediaAnalystAgent@0.1.0",
    created_at: "2026-05-22T10:00:00.000Z",
    trace_id: "trace_01",
    ...overrides,
  };
}

function baseFinding(overrides: Partial<Finding> = {}): Finding {
  return {
    finding_id: "find_01",
    detector: "creativeFatigue",
    severity: "medium",
    title: "Creative fatigue on camp_01",
    description: "CTR has dropped 40% over the last 7 days.",
    entity_id: "camp_01",
    evidence: [
      {
        source: "google_ads_fixture",
        ref: "metric:creative_daily:cr_01",
      },
    ],
    causal_status: "directional_until_lift_test",
    created_at: "2026-05-22T10:00:00.000Z",
    ...overrides,
  };
}

describe("verifyEvidence — acceptance tests", () => {
  it("AT-4: a packet with an empty evidence array → ok:false", () => {
    const packet = basePacket();
    // Bypass the schema's .min(1) so we exercise the ledger's defensive branch.
    const malformed = { ...packet, evidence: [] } as unknown as H0Packet;
    const result = verifyEvidence(malformed);
    expect(result.ok).toBe(false);
    expect(result.missing).toContain("evidence");
  });

  it("AT-5: a packet missing rollback → ok:false", () => {
    const packet = basePacket();
    const malformed = {
      ...packet,
      rollback: undefined,
    } as unknown as H0Packet;
    const result = verifyEvidence(malformed);
    expect(result.ok).toBe(false);
    expect(result.missing).toContain("rollback");
  });
});

describe("verifyEvidence — happy path", () => {
  it("returns ok:true for a fully-formed packet", () => {
    const result = verifyEvidence(basePacket());
    expect(result.ok).toBe(true);
    expect(result.missing).toEqual([]);
  });

  it("returns ok:true for a fully-formed finding", () => {
    const result = verifyEvidence(baseFinding());
    expect(result.ok).toBe(true);
    expect(result.missing).toEqual([]);
  });
});

describe("verifyEvidence — fail-closed behaviour", () => {
  it("rejects a packet whose rollback has no checkpoint_id", () => {
    const packet = {
      ...basePacket(),
      rollback: { method: "restore_previous_status", checkpoint_id: "" },
    } as unknown as H0Packet;
    const result = verifyEvidence(packet);
    expect(result.ok).toBe(false);
    expect(result.missing).toContain("rollback");
  });

  it("rejects evidence entries that lack source or ref", () => {
    const packet = {
      ...basePacket(),
      evidence: [
        { source: "google_ads_fixture", ref: "ok" },
        { source: "", ref: "bad" },
        { source: "fine", ref: "" },
      ],
    } as unknown as H0Packet;
    const result = verifyEvidence(packet);
    expect(result.ok).toBe(false);
    expect(result.missing).toContain("evidence[1].source");
    expect(result.missing).toContain("evidence[2].ref");
  });

  it("rejects a non-object subject", () => {
    const result = verifyEvidence(null as unknown as H0Packet);
    expect(result.ok).toBe(false);
    expect(result.missing).toContain("subject");
  });
});
