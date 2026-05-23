import { describe, it, expect } from "vitest";
import type { Finding, H0Packet } from "@admatix/schemas";
import {
  createEvidenceResolver,
  verifyEvidence,
  verifyEvidenceWithResolver,
} from "./evidence-ledger.js";

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

describe("verifyEvidenceWithResolver — provenance check (QA finding #2)", () => {
  it("rejects refs that do not match any known pattern (would have caught the bug: any string passed)", async () => {
    const resolver = createEvidenceResolver({
      campaignDailyMetric: () => ({ exists: true }),
    });
    const packet = {
      ...basePacket(),
      evidence: [{ source: "google_ads_fixture", ref: "any-old-string" }],
    } as H0Packet;
    const result = await verifyEvidenceWithResolver(packet, resolver);
    expect(result.ok).toBe(false);
    expect(result.missing).toContain("evidence[0].ref:unrecognized_pattern");
  });

  it("rejects refs whose pointed-to row does not exist", async () => {
    const resolver = createEvidenceResolver({
      campaignDailyMetric: () => null, // nothing exists
    });
    const packet = {
      ...basePacket(),
      evidence: [
        {
          source: "google_ads_fixture",
          ref: "metric:campaign_daily:acc_demo:campaign_a:2026-05-21",
        },
      ],
    } as H0Packet;
    const result = await verifyEvidenceWithResolver(packet, resolver);
    expect(result.ok).toBe(false);
    expect(result.missing).toContain("evidence[0].ref:unresolved");
  });

  it("accepts refs that resolve and whose recomputed hash matches", async () => {
    const resolver = createEvidenceResolver({
      campaignDailyMetric: () => ({ exists: true, hash: "deadbeef" }),
    });
    const packet = {
      ...basePacket(),
      evidence: [
        {
          source: "google_ads_fixture",
          ref: "metric:campaign_daily:acc_demo:campaign_a:2026-05-21",
          hash: "deadbeef",
        },
      ],
    } as H0Packet;
    const result = await verifyEvidenceWithResolver(packet, resolver);
    expect(result.ok).toBe(true);
    expect(result.missing).toEqual([]);
  });

  it("rejects when the supplied hash disagrees with the resolved row", async () => {
    const resolver = createEvidenceResolver({
      campaignDailyMetric: () => ({ exists: true, hash: "from_disk" }),
    });
    const packet = {
      ...basePacket(),
      evidence: [
        {
          source: "google_ads_fixture",
          ref: "metric:campaign_daily:acc_demo:campaign_a:2026-05-21",
          hash: "tampered_value",
        },
      ],
    } as H0Packet;
    const result = await verifyEvidenceWithResolver(packet, resolver);
    expect(result.ok).toBe(false);
    expect(result.missing).toContain("evidence[0].hash:mismatch");
  });

  it("admits self-describing system refs (trust/action/policy) without a lookup callback", async () => {
    const resolver = createEvidenceResolver({});
    const finding = {
      ...baseFinding(),
      evidence: [
        { source: "admatix", ref: "trust:agent:media-analyst" },
        { source: "admatix", ref: "action:act_01" },
        { source: "admatix", ref: "policy:budget_cap_v1:v1" },
      ],
    } as Finding;
    const result = await verifyEvidenceWithResolver(finding, resolver);
    expect(result.ok).toBe(true);
  });
});
