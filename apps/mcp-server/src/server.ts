#!/usr/bin/env node
import { pathToFileURL } from "node:url";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type { VerifierClient } from "@admatix/agents";
import type { Connector } from "@admatix/connectors";
import type { Store } from "@admatix/core";
import { ApprovalReceipt, z } from "@admatix/schemas";
import { assertFixturesMode } from "./fixtures-mode.js";
import { activateDryRunTool } from "./tools/activate-dry-run.js";
import { auditAccountTool } from "./tools/audit-account.js";
import { createPlanTool } from "./tools/create-plan.js";
import {
  ToolResultEnvelopeSchema,
  createToolContext,
  type ToolResultEnvelope,
} from "./tools/common.js";
import { runBenchmarkTool } from "./tools/run-benchmark.js";
import { showH0PacketTool } from "./tools/show-h0-packet.js";
import { validateH0PacketTool } from "./tools/validate-h0-packet.js";
import { verifyTool, VerifyInputSchema } from "./tools/verify.js";

export const APPROVED_TOOL_NAMES = [
  "audit_account",
  "create_plan",
  "show_h0_packet",
  "validate_h0_packet",
  "activate_dry_run",
  "run_benchmark",
  "verify",
] as const;

export type AdmatixToolName = (typeof APPROVED_TOOL_NAMES)[number];
export type { ToolResultEnvelope } from "./tools/common.js";

export interface AdmatixMcpDeps {
  store?: Store;
  connector?: Connector;
  dataDir?: string;
  /**
   * Optional verifier client. When supplied, the `verify` tool is
   * registered and forwards `POST /verify` calls to the verifier
   * service. When absent, the tool is **not** registered — Phase 1
   * demos that never boot the verifier stay unaffected.
   */
  verifierClient?: VerifierClient;
}

const AuditAccountInputSchema = z.object({
  account_ref: z.string(),
  window: z.string().optional(),
}).strict();

const CreatePlanInputSchema = z.object({
  account_ref: z.string(),
  goal: z.string(),
  tenant_id: z.string(),
}).strict();

const PacketIdInputSchema = z.object({
  packet_id: z.string(),
}).strict();

const ActivateDryRunInputSchema = z.object({
  packet_id: z.string(),
  approval_receipt: ApprovalReceipt.optional(),
}).strict();

const RunBenchmarkInputSchema = z.object({
  suite: z.string(),
}).strict();

export function createAdmatixMcpServer(deps: AdmatixMcpDeps = {}): McpServer {
  assertFixturesMode();
  const ctx = createToolContext(deps);
  const server = new McpServer(
    { name: "admatix-mcp-server", version: "0.1.0" },
    {
      capabilities: {
        tools: {},
      },
    },
  );

  server.registerTool(
    "audit_account",
    {
      title: "Audit Ad Account",
      description: "Run the deterministic AdMatix audit on a fixture account.",
      inputSchema: AuditAccountInputSchema,
      outputSchema: ToolResultEnvelopeSchema,
      annotations: readOnlyAnnotations(),
    },
    async (input) => toMcpResult(await auditAccountTool(input, ctx)),
  );

  server.registerTool(
    "create_plan",
    {
      title: "Create H0 Plan",
      description: "Run the evidence-gated workflow and return H0 packets.",
      inputSchema: CreatePlanInputSchema,
      outputSchema: ToolResultEnvelopeSchema,
      annotations: readOnlyAnnotations(),
    },
    async (input) => toMcpResult(await createPlanTool(input, ctx)),
  );

  server.registerTool(
    "show_h0_packet",
    {
      title: "Show H0 Packet",
      description: "Read one persisted H0 packet from the AdMatix store.",
      inputSchema: PacketIdInputSchema,
      outputSchema: ToolResultEnvelopeSchema,
      annotations: readOnlyAnnotations(),
    },
    async (input) => toMcpResult(await showH0PacketTool(input, ctx)),
  );

  server.registerTool(
    "validate_h0_packet",
    {
      title: "Validate H0 Packet",
      description: "Validate an H0 packet contract and evidence refs.",
      inputSchema: PacketIdInputSchema,
      outputSchema: ToolResultEnvelopeSchema,
      annotations: readOnlyAnnotations(),
    },
    async (input) => toMcpResult(await validateH0PacketTool(input, ctx)),
  );

  server.registerTool(
    "activate_dry_run",
    {
      title: "Activate Dry Run",
      description: "Return a dry-run ExecutionDiff for an approved H0 packet.",
      inputSchema: ActivateDryRunInputSchema,
      outputSchema: ToolResultEnvelopeSchema,
      annotations: readOnlyAnnotations(),
    },
    async (input) => toMcpResult(await activateDryRunTool(input, ctx)),
  );

  server.registerTool(
    "run_benchmark",
    {
      title: "Run Benchmark",
      description: "Run an AdMatix benchmark suite and return the scorecard.",
      inputSchema: RunBenchmarkInputSchema,
      outputSchema: ToolResultEnvelopeSchema,
      annotations: readOnlyAnnotations(),
    },
    async (input) => toMcpResult(await runBenchmarkTool(input, ctx)),
  );

  if (deps.verifierClient) {
    const verifierClient = deps.verifierClient;
    server.registerTool(
      "verify",
      {
        title: "Verify H0 Packet",
        description:
          "Forward an H0 packet plus a post-period data URI to the independent verifier and return the seven canonical fields (estimate, ci_low, ci_high, method, causal_status, verdict, confounders).",
        inputSchema: VerifyInputSchema,
        outputSchema: ToolResultEnvelopeSchema,
        annotations: readOnlyAnnotations(),
      },
      async (input) =>
        toMcpResult(await verifyTool(input, { ...ctx, verifierClient })),
    );
  }

  return server;
}

export async function startStdioServer(deps: AdmatixMcpDeps = {}): Promise<void> {
  const server = createAdmatixMcpServer(deps);
  await server.connect(new StdioServerTransport());
}

function readOnlyAnnotations() {
  return {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  };
}

function toMcpResult(envelope: ToolResultEnvelope) {
  const structuredContent = ToolResultEnvelopeSchema.parse(envelope);
  return {
    structuredContent,
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(structuredContent),
      },
    ],
    isError: structuredContent.status === "error",
  };
}

const entry = process.argv[1];
if (entry && import.meta.url === pathToFileURL(entry).href) {
  startStdioServer().catch((err: unknown) => {
    const message = err instanceof Error ? err.stack ?? err.message : String(err);
    process.stderr.write(`${message}\n`);
    process.exit(1);
  });
}
