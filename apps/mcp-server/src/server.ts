import type { Store } from "@admatix/core";
import type { Connector } from "@admatix/connectors";
import type { RiskLevel } from "@admatix/schemas";

export const APPROVED_TOOL_NAMES = [
  "audit_account",
  "create_plan",
  "show_h0_packet",
  "validate_h0_packet",
  "activate_dry_run",
  "run_benchmark",
] as const;

export type AdmatixToolName = (typeof APPROVED_TOOL_NAMES)[number];

export interface ToolResultEnvelope<T = unknown> {
  trace_id: string;
  source_refs: string[];
  risk_level: RiskLevel;
  status: "ok" | "blocked" | "error";
  data: T;
}

export interface AdmatixMcpDeps {
  store?: Store;
  connector?: Connector;
  dataDir?: string;
}

export function createAdmatixMcpServer(_deps: AdmatixMcpDeps = {}): unknown {
  throw new Error("createAdmatixMcpServer: interface stub");
}

export async function startStdioServer(_deps: AdmatixMcpDeps = {}): Promise<void> {
  throw new Error("startStdioServer: interface stub");
}
