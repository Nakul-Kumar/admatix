/**
 * Unit tests for `MeasurementScientistAgent` — WP-S acceptance tests
 * #3 (annotate, not approve), #4 (placebo), and #5 (verifier outage).
 *
 * Verifier client is mocked in this file (no HTTP calls). The Phase 3 E2E
 * gate test (`tests/e2e/phase3-gate.test.ts`) covers the real HTTP path.
 */
import { describe, expect, it } from "vitest";
import { H0Packet } from "@admatix/schemas";
import { makeMeasurementScientistAgent } from "./measurement-scientist-agent.js";
import {
  VerifierError,
  type VerifierClient,
  type VerifyResponsePayload,
} from "../verifier-client.js";

function makePacket(overrides: Partial<Record<string, unknown>> = {}) {
  return H0Packet.parse({
    packet_id: "h0_clean_ab",
    tenant_id: "tenant_demo",
    goal: "reduce_cac",
    hypothesis: "Pausing the wasteful ad set will reduce CAC",
    null_hypothesis: "Pausing has no effect on CAC",
    baseline_window: "2026-05-12..2026-05-21",
    success_metric: "cac",
    guardrails: {
      max_daily_budget_delta_pct: 0.2,
      requires_human_approval: true,
    },
    evidence: [
      {
        source: "google_ads_fixture",
        ref: "campaign:acc_demo:campaign_a",
        entity_id: "campaign_a",
      },
    ],
    causal_status: "directional_until_lift_test",
    proposal: {
      action: "no_op",
      target_entity_id: "campaign_a",
      params: {},
      dry_run_only: true,
    },
    rollback: { method: "restore_previous_budget", checkpoint_id: "ckpt_x" },
    approval: { status: "pending", required_role: "media_manager" },
    created_by_agent: "media-analyst",
    created_at: "2026-05-21T00:00:00.000Z",
    trace_id: "trace_test",
    ...overrides,
  });
}

const CLEAN_AB_RESPONSE: VerifyResponsePayload = {
  estimate: 0.0411,
  ci_low: 0.029,
  ci_high: 0.054,
  method: "cate_meta_learner",
  causal_status: "directional_until_lift_test",
  verdict: "lift_detected",
  confounders: ["recency"],
  ci_level: 0.95,
  guardrail_proof: { all_pass: true, rules: [] },
  diagnostics: { qini: 0.18 },
  rejected_methods: [],
  packet_id: "h0_clean_ab",
  tx_id: "h0_clean_ab",
};

const PLACEBO_RESPONSE: VerifyResponsePayload = {
  estimate: 0.0009,
  ci_low: -0.0015,
  ci_high: 0.0034,
  method: "bsts_synthetic_control",
  causal_status: "inconclusive",
  verdict: "inconclusive",
  confounders: [],
  ci_level: 0.95,
  guardrail_proof: { all_pass: true, rules: [] },
  diagnostics: {},
  rejected_methods: [],
  packet_id: "h0_clean_ab",
  tx_id: "h0_clean_ab",
};

function fakeVerifierClient(response: VerifyResponsePayload): VerifierClient {
  return {
    async healthz() {
      return { status: "ok" as const, version: "test", libs: {} };
    },
    async verify() {
      return response;
    },
  };
}

describe("MeasurementScientistAgent — pre-WP-S behaviour preserved", () => {
  it("returns its existing output unchanged when no verifierClient is supplied", async () => {
    const { review } = makeMeasurementScientistAgent({ traceId: "trace_t1" });
    const result = await review({ packet: makePacket() });
    expect(result.verification).toBeUndefined();
    expect(result.output.proposed_actions).toEqual([]);
    expect(result.packet.causal_status).toBe("directional_until_lift_test");
  });

  it("never approves: proposed_actions stays [] even with verifier on a strong-lift world", async () => {
    const { review } = makeMeasurementScientistAgent({
      traceId: "trace_t1",
      deps: { verifierClient: fakeVerifierClient(CLEAN_AB_RESPONSE) },
    });
    const result = await review({
      packet: makePacket(),
      verifyInput: { data_uri: "file:///tmp/world/events.csv" },
    });
    expect(result.output.proposed_actions).toEqual([]);
    expect(result.output.blocked_actions).toEqual([]);
  });
});

describe("MeasurementScientistAgent — verifier annotation (AT3)", () => {
  it("on a clean_ab world: verification.verdict='lift_detected' and CI brackets ground truth", async () => {
    const { review } = makeMeasurementScientistAgent({
      traceId: "trace_t1",
      deps: { verifierClient: fakeVerifierClient(CLEAN_AB_RESPONSE) },
    });
    const result = await review({
      packet: makePacket(),
      verifyInput: {
        data_uri: "file:///tmp/world/events.csv",
        hint: { design: "clean_ab" },
      },
    });
    expect(result.verification).toBeDefined();
    expect(result.verification?.verdict).toBe("lift_detected");
    const ate = 0.04;
    expect(result.verification?.ci_low ?? Number.POSITIVE_INFINITY).toBeLessThanOrEqual(ate);
    expect(result.verification?.ci_high ?? Number.NEGATIVE_INFINITY).toBeGreaterThanOrEqual(ate);
    // Packet remains in pending-approval shape; no implicit approval.
    expect(result.packet.causal_status).toBe("directional_until_lift_test");
    expect(result.packet.approval.status).toBe("pending");
    expect(result.caveats).toContain("verifier_method:cate_meta_learner");
    expect(result.caveats).toContain("verifier_verdict:lift_detected");
    expect(result.caveats).toContain("verifier_confounder:recency");
  });
});

describe("MeasurementScientistAgent — placebo round-trip (AT4)", () => {
  it("on a zero_lift_placebo world: verdict in {no_effect, inconclusive} and caveats reflect it", async () => {
    const { review } = makeMeasurementScientistAgent({
      traceId: "trace_t1",
      deps: { verifierClient: fakeVerifierClient(PLACEBO_RESPONSE) },
    });
    const result = await review({
      packet: makePacket({ packet_id: "h0_placebo" }),
      verifyInput: { data_uri: "file:///tmp/placebo/events.csv" },
    });
    expect(result.verification).toBeDefined();
    expect(["no_effect", "inconclusive"]).toContain(
      result.verification?.verdict ?? "",
    );
    expect(result.caveats).toContain(
      `verifier_verdict:${result.verification?.verdict}`,
    );
    // `inconclusive` causal status surfaces as a caveat — packet stays
    // at directional_until_lift_test (the schema's strongest MVP value).
    if (result.verification?.causal_status === "inconclusive") {
      expect(
        result.caveats.some((c) =>
          c.startsWith("verifier_causal_status:inconclusive"),
        ),
      ).toBe(true);
    }
  });
});

describe("MeasurementScientistAgent — verifier outage degrades gracefully (AT5)", () => {
  it("on network error: returns pre-verifier output plus verifier_unavailable:network caveat", async () => {
    const failing: VerifierClient = {
      async healthz() {
        return { status: "ok" as const, version: "test", libs: {} };
      },
      async verify() {
        throw new VerifierError("network", "boom", {
          url: "http://127.0.0.1:8088/verify",
        });
      },
    };
    const { review } = makeMeasurementScientistAgent({
      traceId: "trace_t1",
      deps: { verifierClient: failing },
    });
    const result = await review({
      packet: makePacket(),
      verifyInput: { data_uri: "file:///tmp/world/events.csv" },
    });
    expect(result.verification).toBeUndefined();
    expect(result.caveats).toContain("verifier_unavailable:network");
    // The pre-verifier output remains a valid AgentOutput.
    expect(result.output.proposed_actions).toEqual([]);
    expect(result.packet.causal_status).toBe("directional_until_lift_test");
  });
});
