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

describe("WP-J API acceptance", () => {
  it("acceptance #1a: /api/v1/audit returns a schema-valid AuditReport + packets", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/audit",
      payload: {
        accountRef: "fixture:acc_demo",
        goal: "reduce_cac",
        tenantId: "tenant_demo",
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
    const res = await app.inject({ method: "GET", url: "/api/v1/packets" });
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
      payload: { suite: "safety-v1" },
    });
    expect(runRes.statusCode).toBe(200);
    const run = BenchmarkRun.parse(runRes.json());
    expect(run.suite).toBe("safety-v1");

    const latest = await app.inject({
      method: "GET",
      url: "/api/v1/benchmarks/latest?suite=safety-v1",
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
      payload: {
        packetId: invalid.packet_id,
        decision: "approved",
        decidedBy: "media_manager_demo",
      },
    });
    expect(res.statusCode).toBe(409);
    const body = res.json() as { error: string; missing: string[] };
    expect(body.error).toBe("invalid_packet");
    expect(body.missing.length).toBeGreaterThan(0);
  });

  it("approves a valid packet end-to-end", async () => {
    const listed = await app.inject({ method: "GET", url: "/api/v1/packets" });
    const { packets } = listed.json() as { packets: { packet_id: string }[] };
    const target = packets.find((p) => p.packet_id !== "h0_invalid_test");
    expect(target).toBeDefined();
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/approvals",
      payload: {
        packetId: target!.packet_id,
        decision: "approved",
        decidedBy: "media_manager_demo",
      },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { receipt: { decision: string } };
    expect(body.receipt.decision).toBe("approved");
  });
});
