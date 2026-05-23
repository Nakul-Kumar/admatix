/**
 * Unit tests for the `admatix.verify` MCP tool — WP-S acceptance tests
 * #6 (handler shape + read-only invariant) and #7 (capability gate).
 *
 * The verifier client is mocked; the Phase 3 E2E test
 * (`tests/e2e/phase3-gate.test.ts`) covers the real HTTP path.
 */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createStore } from "@admatix/core";
import { H0Packet } from "@admatix/schemas";
import type {
  VerifierClient,
  VerifyResponsePayload,
} from "@admatix/agents";
import { fixtureConnector } from "@admatix/connectors";
import { ToolResultEnvelopeSchema, type ToolContext } from "./common.js";
import { verifyTool, VerifyInputSchema } from "./verify.js";

const FixturePacket = H0Packet.parse({
  packet_id: "h0_verify_test",
  tenant_id: "tenant_demo",
  goal: "reduce wasted spend",
  hypothesis: "Pausing campaign_a will reduce waste",
  null_hypothesis: "No change has no effect",
  baseline_window: "2026-05-12..2026-05-21",
  success_metric: "estimated_waste_reduction",
  guardrails: { max_daily_budget_delta_pct: 0.2, requires_human_approval: true },
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
  created_by_agent: "MediaAnalystAgent",
  created_at: "2026-05-21T00:00:00.000Z",
  trace_id: "trace_packet_verify_test",
});

const MOCK_RESPONSE: VerifyResponsePayload = {
  estimate: 0.042,
  ci_low: 0.031,
  ci_high: 0.054,
  method: "cate_meta_learner",
  causal_status: "directional_until_lift_test",
  verdict: "lift_detected",
  confounders: ["recency"],
  ci_level: 0.95,
  guardrail_proof: { all_pass: true, rules: [] },
  diagnostics: { qini: 0.18 },
  rejected_methods: [],
  packet_id: FixturePacket.packet_id,
  tx_id: FixturePacket.packet_id,
};

const tmpRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    tmpRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

async function buildCtx(): Promise<
  ToolContext & { verifierClient: VerifierClient }
> {
  const root = await mkdtemp(join(tmpdir(), "admatix-verify-tool-"));
  tmpRoots.push(root);
  const store = createStore(root);
  await store.put("h0_packets", FixturePacket.packet_id, FixturePacket);
  const verifierClient: VerifierClient = {
    async healthz() {
      return { status: "ok" as const, version: "test", libs: {} };
    },
    verify: vi.fn(async () => MOCK_RESPONSE),
  };
  return { store, connector: fixtureConnector(), verifierClient };
}

describe("admatix.verify MCP tool — handler shape (AT6)", () => {
  it("returns a ToolResultEnvelope with the seven canonical fields populated", async () => {
    const ctx = await buildCtx();
    const out = await verifyTool(
      {
        packet_id: FixturePacket.packet_id,
        data_uri: "file:///tmp/world/events.csv",
      },
      ctx,
    );
    const parsed = ToolResultEnvelopeSchema.parse(out);
    expect(parsed.status).toBe("ok");
    expect(parsed.risk_level).toBe("low");
    expect(parsed.trace_id).toBe(FixturePacket.trace_id);
    expect(parsed.source_refs).toEqual([
      "google_ads_fixture:campaign:acc_demo:campaign_a",
    ]);
    const data = parsed.data as VerifyResponsePayload;
    expect(data.estimate).toBe(0.042);
    expect(data.ci_low).toBe(0.031);
    expect(data.ci_high).toBe(0.054);
    expect(data.method).toBe("cate_meta_learner");
    expect(data.causal_status).toBe("directional_until_lift_test");
    expect(data.verdict).toBe("lift_detected");
    expect(data.confounders).toEqual(["recency"]);
  });

  it("is read-shaped: no store writes, no event appends, no packet lifecycle change", async () => {
    const ctx = await buildCtx();
    const putSpy = vi.spyOn(ctx.store, "put");
    const appendSpy = vi.spyOn(ctx.store, "append");

    await verifyTool(
      {
        packet_id: FixturePacket.packet_id,
        data_uri: "file:///tmp/world/events.csv",
      },
      ctx,
    );

    expect(putSpy).not.toHaveBeenCalled();
    expect(appendSpy).not.toHaveBeenCalled();

    // Persisted packet is byte-identical to the fixture we put before
    // calling the tool — no implicit lifecycle change.
    const persisted = await ctx.store.get<unknown>(
      "h0_packets",
      FixturePacket.packet_id,
    );
    expect(persisted).toEqual(FixturePacket);
  });

  it("forwards the derived account_ref and evidence_refs to the verifier", async () => {
    const ctx = await buildCtx();
    await verifyTool(
      {
        packet_id: FixturePacket.packet_id,
        data_uri: "file:///tmp/world/events.csv",
        hint: { design: "clean_ab" },
      },
      ctx,
    );
    const mock = ctx.verifierClient.verify as ReturnType<typeof vi.fn>;
    expect(mock).toHaveBeenCalledTimes(1);
    const payload = mock.mock.calls[0]![0]!;
    expect(payload.packet.packet_id).toBe(FixturePacket.packet_id);
    expect(payload.packet.account_ref).toBe("acc_demo");
    expect(payload.packet.evidence_refs).toEqual([
      "google_ads_fixture:campaign:acc_demo:campaign_a",
    ]);
    expect(payload.data_uri).toBe("file:///tmp/world/events.csv");
    expect(payload.hint).toEqual({ design: "clean_ab" });
  });
});

describe("admatix.verify MCP tool — capability gate (AT7)", () => {
  it("Zod .strict() rejects write-class fields like approval_receipt", () => {
    const parsed = VerifyInputSchema.safeParse({
      packet_id: "h0_x",
      data_uri: "file:///tmp/x.csv",
      approval_receipt: {
        receipt_id: "rcpt_1",
        packet_id: "h0_x",
        action_id: "act_1",
        decision: "approved",
        decided_by: "user",
        role: "media_manager",
        decided_at: "2026-05-21T00:00:00.000Z",
      },
    });
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(JSON.stringify(parsed.error.issues)).toMatch(/Unrecognized key/);
    }
  });

  it("rejects a packet_id that does not resolve in the store", async () => {
    const ctx = await buildCtx();
    await expect(
      verifyTool(
        {
          packet_id: "h0_does_not_exist",
          data_uri: "file:///tmp/world/events.csv",
        },
        ctx,
      ),
    ).rejects.toThrow(/not found in store/);
  });

  it("rejects any unknown top-level input key with Zod", async () => {
    const ctx = await buildCtx();
    await expect(
      verifyTool(
        {
          packet_id: FixturePacket.packet_id,
          data_uri: "file:///tmp/x.csv",
          some_other_field: true,
        } as never,
        ctx,
      ),
    ).rejects.toThrow(/Unrecognized key/);
  });
});
