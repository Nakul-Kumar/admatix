import { mkdtemp, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { H0Packet } from "@admatix/schemas";
import { createStore, nowIso } from "@admatix/core";
import {
  APPROVED_TOOL_NAMES,
  createAdmatixMcpServer,
} from "./server.js";
import { ToolResultEnvelopeSchema } from "./tools/common.js";
import { activateDryRunTool } from "./tools/activate-dry-run.js";
import { auditAccountTool } from "./tools/audit-account.js";
import { createPlanTool } from "./tools/create-plan.js";
import { runBenchmarkTool } from "./tools/run-benchmark.js";
import { showH0PacketTool } from "./tools/show-h0-packet.js";
import { validateH0PacketTool } from "./tools/validate-h0-packet.js";
import { afterEach, describe, expect, it } from "vitest";

const FixturePacket = H0Packet.parse({
  packet_id: "h0_test_packet",
  tenant_id: "tenant_demo",
  goal: "lower wasted spend",
  hypothesis: "Reducing inefficient spend on cmp_brand will lower waste.",
  null_hypothesis: "No change will improve the account.",
  baseline_window: "2026-05-12..2026-05-21",
  success_metric: "estimated_waste_reduction",
  guardrails: {
    max_daily_budget_delta_pct: 0.2,
    requires_human_approval: true,
  },
  evidence: [
    {
      source: "google_ads_fixture",
      ref: "metric:campaign_daily:cmp_brand:2026-05-21",
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
    checkpoint_id: "checkpoint_test",
  },
  approval: {
    status: "pending",
    required_role: "media_manager",
  },
  created_by_agent: "MediaAnalystAgent",
  created_at: "2026-05-21T00:00:00.000Z",
  trace_id: "trace_test_packet",
});

const tmpRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    tmpRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("MCP server", () => {
  it("advertises only the six base read-only tools when no verifier dep is supplied", async () => {
    const server = createAdmatixMcpServer({ dataDir: await tempRoot() });
    const registered = server as unknown as {
      _registeredTools: Record<string, unknown>;
    };
    const names = Object.keys(registered._registeredTools).sort();
    await server.close();

    expect(APPROVED_TOOL_NAMES).toEqual([
      "audit_account",
      "create_plan",
      "show_h0_packet",
      "validate_h0_packet",
      "activate_dry_run",
      "run_benchmark",
      "verify",
    ]);
    // `verify` is registered only when `deps.verifierClient` is supplied,
    // so a Phase-1-shaped server with no verifier dep advertises six.
    expect(names).toEqual(
      [...APPROVED_TOOL_NAMES].filter((n) => n !== "verify").sort(),
    );
  });

  it("returns a blocked response for activate_dry_run without an approval receipt", async () => {
    const store = createStore(await tempRoot());
    await store.put("h0_packets", FixturePacket.packet_id, FixturePacket);

    const result = await activateDryRunTool(
      { packet_id: FixturePacket.packet_id },
      {
        store,
        connector: (await import("@admatix/connectors")).fixtureConnector(),
      },
    );

    const parsed = ToolResultEnvelopeSchema.parse(result);
    expect(parsed.status).toBe("blocked");
    expect(parsed.trace_id).toMatch(/^trace_mcp_/);
    expect(parsed.risk_level).toBe("high");
    expect(JSON.stringify(parsed.data)).toContain("approval_receipt_required");
  });

  it("validates direct tool outputs and includes trace_id on every response", async () => {
    const store = createStore(await tempRoot());
    const connector = (await import("@admatix/connectors")).fixtureConnector();
    await store.put("h0_packets", FixturePacket.packet_id, FixturePacket);
    const ctx = { store, connector };

    const outputs = [
      await auditAccountTool({ account_ref: "fixture:acc_demo" }, ctx),
      await createPlanTool(
        {
          account_ref: "fixture:acc_demo",
          goal: "lower CAC while preserving revenue",
          tenant_id: "tenant_demo",
        },
        ctx,
      ),
      await showH0PacketTool({ packet_id: FixturePacket.packet_id }, ctx),
      await validateH0PacketTool({ packet_id: FixturePacket.packet_id }, ctx),
      await activateDryRunTool(
        {
          packet_id: FixturePacket.packet_id,
          approval_receipt: {
            receipt_id: "rcpt_test",
            packet_id: FixturePacket.packet_id,
            action_id: "act_approved",
            decision: "approved",
            decided_by: "user_test",
            role: "media_manager",
            decided_at: nowIso(),
          },
        },
        ctx,
      ),
      await runBenchmarkTool({ suite: "safety-v1" }, ctx),
    ];

    for (const output of outputs) {
      const parsed = ToolResultEnvelopeSchema.parse(output);
      expect(parsed.trace_id.length).toBeGreaterThan(0);
      expect(parsed.source_refs).toEqual(expect.any(Array));
      expect(["low", "medium", "high"]).toContain(parsed.risk_level);
    }
  });

  it("rejects unknown input fields with Zod", async () => {
    const store = createStore(await tempRoot());
    const connector = (await import("@admatix/connectors")).fixtureConnector();
    await expect(
      auditAccountTool(
        { account_ref: "fixture:acc_demo", extra: true } as never,
        { store, connector },
      ),
    ).rejects.toThrow(/Unrecognized key/);
  });

  it("starts and responds over stdio, and unknown tools do not crash it", async () => {
    const dataDir = await tempRoot();
    const repoRoot = findRepoRoot();
    const client = new Client({ name: "admatix-test-client", version: "0.1.0" });
    const transport = new StdioClientTransport({
      command: join(repoRoot, "node_modules", ".bin", "tsx"),
      args: [
        join(repoRoot, "apps", "mcp-server", "src", "server.ts"),
      ],
      cwd: repoRoot,
      env: {
        ...stringEnv(process.env),
        ADMATIX_FIXTURE_ROOT: join(repoRoot, "data", "fixtures"),
        ADMATIX_DATA_DIR: dataDir,
        NODE_ENV: "test",
      },
      stderr: "pipe",
    });

    await client.connect(transport);
    const tools = await client.listTools();
    // stdio entry point boots without a verifier dep — `verify` is gated
    // behind `deps.verifierClient` so only the six base tools appear.
    expect(tools.tools.map((tool) => tool.name).sort()).toEqual(
      [...APPROVED_TOOL_NAMES].filter((n) => n !== "verify").sort(),
    );

    const unknown = await client.callTool({ name: "mutate_platform", arguments: {} });
    expect(unknown.isError).toBe(true);
    expect(JSON.stringify(unknown.content)).toContain("mutate_platform");
    await expect(client.ping()).resolves.toBeDefined();

    const audit = await client.callTool({
      name: "audit_account",
      arguments: { account_ref: "fixture:acc_demo" },
    });
    expect(ToolResultEnvelopeSchema.parse(audit.structuredContent).trace_id).toBeTruthy();

    const plan = await client.callTool({
      name: "create_plan",
      arguments: {
        account_ref: "fixture:acc_demo",
        goal: "lower CAC while preserving revenue",
        tenant_id: "tenant_demo",
      },
    });
    const planEnvelope = ToolResultEnvelopeSchema.parse(plan.structuredContent);
    const packets = zPacketArrayFromEnvelope(planEnvelope);
    expect(packets.length).toBeGreaterThan(0);
    const packet = packets[0];
    if (!packet) throw new Error("create_plan returned no packets");

    const blocked = await client.callTool({
      name: "activate_dry_run",
      arguments: { packet_id: packet.packet_id },
    });
    expect(ToolResultEnvelopeSchema.parse(blocked.structuredContent).status).toBe("blocked");

    const dryRun = await client.callTool({
      name: "activate_dry_run",
      arguments: {
        packet_id: packet.packet_id,
        approval_receipt: {
          receipt_id: "rcpt_stdio",
          packet_id: packet.packet_id,
          action_id: "act_stdio",
          decision: "approved",
          decided_by: "user_stdio",
          role: "media_manager",
          decided_at: nowIso(),
        },
      },
    });
    const dryRunEnvelope = ToolResultEnvelopeSchema.parse(dryRun.structuredContent);
    expect(dryRunEnvelope.status).toBe("ok");
    expect(JSON.stringify(dryRunEnvelope.data)).toContain("\"dry_run\":true");

    await client.close();
  });
});

async function tempRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "admatix-mcp-"));
  tmpRoots.push(root);
  return root;
}

function stringEnv(env: NodeJS.ProcessEnv): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) {
    if (typeof value === "string") out[key] = value;
  }
  return out;
}

function findRepoRoot(): string {
  let dir = process.cwd();
  for (let i = 0; i < 8; i += 1) {
    if (existsSync(join(dir, "pnpm-workspace.yaml"))) return dir;
    const parent = join(dir, "..");
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error(`could not locate repo root from ${process.cwd()}`);
}

function zPacketArrayFromEnvelope(
  envelope: ReturnType<typeof ToolResultEnvelopeSchema.parse>,
) {
  const data = envelope.data as { packets?: unknown };
  return H0Packet.array().parse(data.packets);
}
