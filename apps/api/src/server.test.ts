import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  AuditReport,
  BenchmarkRun,
  H0Packet,
} from "@admatix/schemas";
import { createStore, type Store } from "@admatix/core";
import { buildServer } from "./server.js";
import type { FastifyInstance } from "fastify";

let app: FastifyInstance;
let store: Store;
let tmpRoot: string;

const MANAGER_AUTH = { authorization: "Bearer tok_demo_media_manager" };

async function buildAndClose(): Promise<void> {
  const candidate = await buildServer({ logger: false });
  await candidate.close();
}

async function withEnv<T>(
  updates: Record<string, string | undefined>,
  fn: () => Promise<T>,
): Promise<T> {
  const prev: Record<string, string | undefined> = {};
  for (const key of Object.keys(updates)) {
    prev[key] = process.env[key];
    const next = updates[key];
    if (next === undefined) delete process.env[key];
    else process.env[key] = next;
  }
  try {
    return await fn();
  } finally {
    for (const [key, value] of Object.entries(prev)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

beforeAll(async () => {
  tmpRoot = mkdtempSync(join(tmpdir(), "admatix-api-"));
  store = createStore(tmpRoot);
  app = await buildServer({ deps: { store }, logger: false });
  await app.ready();
});

afterAll(async () => {
  await app.close();
  rmSync(tmpRoot, { recursive: true, force: true });
});

describe("F8: API entry point enforces ADMATIX_MODE=fixtures", () => {
  it("buildServer throws if ADMATIX_MODE is unsupported", async () => {
    const prev = process.env["ADMATIX_MODE"];
    process.env["ADMATIX_MODE"] = "live";
    try {
      await expect(buildServer({ logger: false })).rejects.toThrow(/ADMATIX_MODE/);
    } finally {
      if (prev === undefined) delete process.env["ADMATIX_MODE"];
      else process.env["ADMATIX_MODE"] = prev;
    }
  });

  it("readonly mode exposes connector preview but not fixture audit routes", async () => {
    await withEnv({ ADMATIX_MODE: "readonly" }, async () => {
      const readonlyApp = await buildServer({ logger: false });
      await readonlyApp.ready();
      try {
        const capabilities = await readonlyApp.inject({
          method: "GET",
          url: "/api/v1/connectors/capabilities?platform=google_ads",
          headers: MANAGER_AUTH,
        });
        expect(capabilities.statusCode).toBe(200);
        expect((capabilities.json() as { status: string }).status).toBe("available");

        const cassette = join(
          process.cwd(),
          "packages/connectors/testdata/cassettes/google_ads/campaign_metrics.json",
        );
        const preview = await readonlyApp.inject({
          method: "POST",
          url: "/api/v1/connectors/preview",
          headers: MANAGER_AUTH,
          payload: {
            request_id: "req_api_preview",
            platform: "google_ads",
            source_kind: "oauth_readonly",
            object_type: "platform_report",
            sync_type: "performance_report",
            account_id: "1234567890",
            window: "2026-05-20..2026-05-21",
            params: {},
            cassette_path: cassette,
          },
        });
        expect(preview.statusCode).toBe(200);
        expect((preview.json() as { row_count: number; proof_ready: boolean }).row_count).toBe(2);
        expect((preview.json() as { proof_ready: boolean }).proof_ready).toBe(false);

        const audit = await readonlyApp.inject({
          method: "POST",
          url: "/api/v1/audit",
          headers: MANAGER_AUTH,
          payload: {
            accountRef: "fixture:acc_demo",
            goal: "reduce_cac",
          },
        });
        expect(audit.statusCode).toBe(404);
      } finally {
        await readonlyApp.close();
      }
    });
  });
});

describe("CX-7 production secret hygiene", () => {
  it("hard-fails production API boot when ADMATIX_API_TOKENS is missing", async () => {
    await withEnv(
      {
        ADMATIX_ENV: "production",
        NODE_ENV: undefined,
        ADMATIX_API_TOKENS: undefined,
      },
      async () => {
        await expect(buildAndClose()).rejects.toThrow(
          /ADMATIX_API_TOKENS/,
        );
      },
    );
  });

  it("hard-fails production API boot when ADMATIX_API_TOKENS uses demo defaults", async () => {
    await withEnv(
      {
        ADMATIX_ENV: "production",
        NODE_ENV: undefined,
        ADMATIX_API_TOKENS: JSON.stringify({
          tok_demo_media_manager: {
            tenant_id: "tenant_demo",
            role: "media_manager",
          },
        }),
      },
      async () => {
        await expect(buildAndClose()).rejects.toThrow(
          /demo default token/,
        );
      },
    );
  });
});

describe("WP-J API acceptance", () => {
  it("acceptance #1a: /api/v1/audit returns a schema-valid AuditReport + packets", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/audit",
      headers: MANAGER_AUTH,
      payload: {
        accountRef: "fixture:acc_demo",
        goal: "reduce_cac",
        window: "2026-05-12..2026-05-21",
      },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { audit: unknown; packets: unknown[] };
    expect(() => AuditReport.parse(body.audit)).not.toThrow();
    expect(Array.isArray(body.packets)).toBe(true);
    for (const p of body.packets) {
      expect(() => H0Packet.parse(p)).not.toThrow();
    }
  });

  it("acceptance #1b: /api/v1/packets lists schema-valid packets", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/packets",
      headers: MANAGER_AUTH,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { packets: unknown[] };
    expect(Array.isArray(body.packets)).toBe(true);
    for (const p of body.packets) {
      expect(() => H0Packet.parse(p)).not.toThrow();
    }
  });

  it("acceptance #1c: benchmark routes return a schema-valid BenchmarkRun", async () => {
    const runRes = await app.inject({
      method: "POST",
      url: "/api/v1/benchmarks/run",
      headers: MANAGER_AUTH,
      payload: { suite: "safety-v1" },
    });
    expect(runRes.statusCode).toBe(200);
    const run = BenchmarkRun.parse(runRes.json());
    expect(run.suite).toBe("safety-v1");

    const latest = await app.inject({
      method: "GET",
      url: "/api/v1/benchmarks/latest?suite=safety-v1",
      headers: MANAGER_AUTH,
    });
    expect(latest.statusCode).toBe(200);
    expect(() => BenchmarkRun.parse(latest.json())).not.toThrow();
  });

  it("acceptance #5: invalid H0 packet cannot be approved (409)", async () => {
    const invalid = {
      packet_id: "h0_invalid_test",
      tenant_id: "tenant_demo",
      goal: "reduce_cac",
      hypothesis: "test",
      null_hypothesis: "test null",
      baseline_window: "2026-05-12..2026-05-21",
      success_metric: "estimated_waste_reduction",
      guardrails: { requires_human_approval: true },
      // intentionally missing source/ref on the single evidence entry to
      // trip the EvidenceLedger gate — the schema would reject min(1) with
      // empty array, but it permits an entry that omits source+ref because
      // EvidenceRef makes both technically required only at parse time.
      // We bypass parse to write a malformed-but-shaped object straight
      // into the store and confirm the approval endpoint fails closed.
      evidence: [{ source: "", ref: "" }],
      causal_status: "directional_until_lift_test",
      proposal: { action: "no_op", target_entity_id: "campaign_a", params: {}, dry_run_only: true },
      // rollback intentionally invalid (empty strings)
      rollback: { method: "", checkpoint_id: "" },
      approval: { status: "pending", required_role: "media_manager" },
      created_by_agent: "test",
      created_at: "2026-05-21T00:00:00.000Z",
      trace_id: "trace_test",
    };
    await store.put("h0_packets", invalid.packet_id, invalid);

    const res = await app.inject({
      method: "POST",
      url: "/api/v1/approvals",
      headers: MANAGER_AUTH,
      payload: {
        packetId: invalid.packet_id,
        decision: "approved",
      },
    });
    expect(res.statusCode).toBe(409);
    const body = res.json() as { error: string; missing: string[] };
    expect(body.error).toBe("invalid_packet");
    expect(body.missing.length).toBeGreaterThan(0);
  });

  it("approves a valid packet end-to-end", async () => {
    const target = validPacket("h0_approve_end_to_end");
    await store.put("h0_packets", target.packet_id, target);
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/approvals",
      headers: MANAGER_AUTH,
      payload: {
        packetId: target.packet_id,
        decision: "approved",
      },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { receipt: { decision: string; signature?: string } };
    expect(body.receipt.decision).toBe("approved");
    expect(typeof body.receipt.signature).toBe("string");
    expect(body.receipt.signature!.length).toBeGreaterThan(16);
  });

  it("rejects duplicate approval attempts for an already decided packet", async () => {
    const packet = validPacket("h0_duplicate_approval");
    await store.put("h0_packets", packet.packet_id, packet);

    const first = await app.inject({
      method: "POST",
      url: "/api/v1/approvals",
      headers: MANAGER_AUTH,
      payload: {
        packetId: packet.packet_id,
        decision: "approved",
      },
    });
    expect(first.statusCode).toBe(200);

    const second = await app.inject({
      method: "POST",
      url: "/api/v1/approvals",
      headers: MANAGER_AUTH,
      payload: {
        packetId: packet.packet_id,
        decision: "approved",
      },
    });
    expect(second.statusCode).toBe(409);
    expect((second.json() as { error: string }).error).toBe("packet_already_decided");
  });

  it("mints approval receipts with a bounded expiry", async () => {
    const packet = validPacket("h0_expiring_receipt");
    await store.put("h0_packets", packet.packet_id, packet);

    const res = await app.inject({
      method: "POST",
      url: "/api/v1/approvals",
      headers: MANAGER_AUTH,
      payload: {
        packetId: packet.packet_id,
        decision: "approved",
      },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      receipt: { decided_at: string; expires_at?: string };
    };
    expect(typeof body.receipt.expires_at).toBe("string");
    expect(Date.parse(body.receipt.expires_at!)).toBeGreaterThan(
      Date.parse(body.receipt.decided_at),
    );
  });

  describe("F5: approvals cannot forge identity (QA finding)", () => {
    it("rejects approval with no Authorization header (401)", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/api/v1/approvals",
        payload: { packetId: "anything", decision: "approved" },
      });
      expect(res.statusCode).toBe(401);
    });

    it("ignores a body-supplied decidedBy/role and uses the token identity", async () => {
      const target = validPacket("h0_identity_forge");
      await store.put("h0_packets", target.packet_id, target);
      const res = await app.inject({
        method: "POST",
        url: "/api/v1/approvals",
        headers: MANAGER_AUTH,
        payload: {
          packetId: target.packet_id,
          decision: "approved",
          // QA finding #5 attack: caller tries to manufacture an
          // approval as "finance_director" without holding that role.
          decidedBy: "evil_user",
          role: "finance_director",
        } as unknown as Record<string, unknown>,
      });
      // The endpoint accepts the request (extra fields are ignored), but
      // the resulting receipt records the *token's* identity, NOT the
      // body's. role = media_manager (from MANAGER_AUTH), not
      // finance_director.
      expect(res.statusCode).toBe(200);
      const body = res.json() as { receipt: { role: string; decided_by: string } };
      expect(body.receipt.role).toBe("media_manager");
      expect(body.receipt.decided_by).not.toBe("evil_user");
    });

    it("F7: /api/v1/packets filters by the caller's tenant", async () => {
      // Plant a packet belonging to a foreign tenant. With tenant
      // isolation in place, the demo-tenant token must NOT see it.
      const foreignPacket = {
        packet_id: "h0_foreign_tenant",
        tenant_id: "tenant_other",
        goal: "reduce_cac",
        hypothesis: "h",
        null_hypothesis: "n",
        baseline_window: "2026-05-12..2026-05-21",
        success_metric: "estimated_waste_reduction",
        guardrails: { max_daily_budget_delta_pct: 20, requires_human_approval: true },
        evidence: [{ source: "google_ads_fixture", ref: "campaign:acc_demo:campaign_a" }],
        causal_status: "directional_until_lift_test",
        proposal: {
          action: "no_op",
          target_entity_id: "campaign_a",
          params: {},
          dry_run_only: true,
        },
        rollback: { method: "noop", checkpoint_id: "ckpt_x" },
        approval: { status: "pending", required_role: "media_manager" },
        created_by_agent: "test",
        created_at: "2026-05-22T00:00:00.000Z",
        trace_id: "trace_foreign",
      };
      await store.put("h0_packets", foreignPacket.packet_id, foreignPacket);
      const res = await app.inject({
        method: "GET",
        url: "/api/v1/packets",
        headers: MANAGER_AUTH,
      });
      const { packets } = res.json() as { packets: { packet_id: string }[] };
      expect(packets.some((p) => p.packet_id === foreignPacket.packet_id)).toBe(
        false,
      );
    });

    it("forbids a viewer-role token from approving (403)", async () => {
      const target = validPacket("h0_viewer_forbidden");
      await store.put("h0_packets", target.packet_id, target);
      const res = await app.inject({
        method: "POST",
        url: "/api/v1/approvals",
        headers: { authorization: "Bearer tok_demo_viewer" },
        payload: { packetId: target.packet_id, decision: "approved" },
      });
      expect(res.statusCode).toBe(403);
    });
  });
});

function validPacket(packet_id: string): ReturnType<typeof H0Packet.parse> {
  return H0Packet.parse({
    packet_id,
    tenant_id: "tenant_demo",
    goal: "reduce_cac",
    hypothesis: "Reducing inefficient spend on cmp_brand will lower waste.",
    null_hypothesis: "No change will improve the account.",
    baseline_window: "2026-05-12..2026-05-21",
    success_metric: "estimated_waste_reduction",
    guardrails: { max_daily_budget_delta_pct: 20, requires_human_approval: true },
    evidence: [
      {
        source: "google_ads_fixture",
        ref: "metric:campaign_daily:acc_demo:cmp_brand:2026-05-21",
        entity_id: "cmp_brand",
      },
    ],
    causal_status: "directional_until_lift_test",
    proposal: {
      action: "budget_shift",
      target_entity_id: "cmp_brand",
      params: { delta_pct: -10 },
      dry_run_only: true,
    },
    rollback: {
      method: "restore_previous_budget",
      checkpoint_id: `checkpoint_${packet_id}`,
    },
    approval: {
      status: "pending",
      required_role: "media_manager",
    },
    created_by_agent: "test",
    created_at: "2026-05-21T00:00:00.000Z",
    trace_id: `trace_${packet_id}`,
  });
}
