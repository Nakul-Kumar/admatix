import {
  AuditReport,
  BenchmarkRun,
  ExecutionDiff,
  H0Packet,
  RiskLevel,
  type EvidenceRef,
  type PlatformAccount,
  z,
} from "@admatix/schemas";
import {
  createStore,
  normalizeMetrics,
  sha256,
  type Store,
} from "@admatix/core";
import {
  fixtureConnector,
  resolveAccountRef,
  type Connector,
} from "@admatix/connectors";

export const DEFAULT_WINDOW = "2026-05-12..2026-05-21";

export interface ToolContext {
  store: Store;
  connector: Connector;
}

export function createToolContext(opts: {
  store?: Store;
  connector?: Connector;
  dataDir?: string;
} = {}): ToolContext {
  return {
    store: opts.store ?? createStore(opts.dataDir ?? process.env["ADMATIX_DATA_DIR"]),
    connector: opts.connector ?? fixtureConnector(),
  };
}

export const ToolResultEnvelopeSchema = z.object({
  trace_id: z.string(),
  source_refs: z.array(z.string()),
  risk_level: RiskLevel,
  status: z.enum(["ok", "blocked", "error"]),
  data: z.unknown(),
}).strict();

export type ToolResultEnvelope<T = unknown> = z.infer<typeof ToolResultEnvelopeSchema> & {
  data: T;
};

export function okEnvelope<T>(args: {
  trace_id: string;
  source_refs: string[];
  risk_level?: z.infer<typeof RiskLevel>;
  data: T;
}): ToolResultEnvelope<T> {
  return ToolResultEnvelopeSchema.parse({
    trace_id: args.trace_id,
    source_refs: args.source_refs,
    risk_level: args.risk_level ?? "low",
    status: "ok",
    data: args.data,
  }) as ToolResultEnvelope<T>;
}

export function blockedEnvelope<T>(args: {
  trace_id: string;
  source_refs?: string[];
  risk_level?: z.infer<typeof RiskLevel>;
  data: T;
}): ToolResultEnvelope<T> {
  return ToolResultEnvelopeSchema.parse({
    trace_id: args.trace_id,
    source_refs: args.source_refs ?? [],
    risk_level: args.risk_level ?? "high",
    status: "blocked",
    data: args.data,
  }) as ToolResultEnvelope<T>;
}

export function errorEnvelope<T>(args: {
  trace_id: string;
  source_refs?: string[];
  risk_level?: z.infer<typeof RiskLevel>;
  data: T;
}): ToolResultEnvelope<T> {
  return ToolResultEnvelopeSchema.parse({
    trace_id: args.trace_id,
    source_refs: args.source_refs ?? [],
    risk_level: args.risk_level ?? "medium",
    status: "error",
    data: args.data,
  }) as ToolResultEnvelope<T>;
}

export function traceFor(name: string, input: unknown): string {
  return `trace_mcp_${sha256({ name, input }).slice(0, 16)}`;
}

export function refsFromEvidence(evidence: EvidenceRef[]): string[] {
  return evidence.map((ref) => `${ref.source}:${ref.ref}`);
}

export function refsFromAudit(report: z.infer<typeof AuditReport>): string[] {
  return unique(report.findings.flatMap((finding) => refsFromEvidence(finding.evidence)));
}

export function refsFromPackets(packets: z.infer<typeof H0Packet>[]): string[] {
  return unique(packets.flatMap((packet) => refsFromEvidence(packet.evidence)));
}

export function refsFromBenchmark(run: z.infer<typeof BenchmarkRun>): string[] {
  return run.results.map((result) => `benchmark:${run.suite}:${result.task_id}`);
}

export function refsFromDiff(diff: z.infer<typeof ExecutionDiff>): string[] {
  return [`action:${diff.action_id}`, `entity:${diff.entity_id}`];
}

export async function resolveFixtureAccount(
  connector: Connector,
  accountRef: string,
): Promise<PlatformAccount> {
  const ref = resolveAccountRef(accountRef);
  if (ref.kind !== "fixture") {
    throw new Error(
      `mcp-server: "${accountRef}" is not supported in the MVP. Use fixture:<account_id>; live connectors are read-only later work.`,
    );
  }
  const accounts = await connector.listAccounts();
  const found = accounts.find((account) => account.account_id === ref.id);
  if (found) return found;
  const first = accounts[0];
  if (first) return first;
  throw new Error(`mcp-server: no fixture accounts available for ${connector.platform}`);
}

export async function buildAuditInput(
  ctx: ToolContext,
  accountRef: string,
  window: string,
) {
  const account = await resolveFixtureAccount(ctx.connector, accountRef);
  const campaigns = await ctx.connector.getCampaigns(account.account_id);
  const daily = await ctx.connector.getCampaignDailyMetrics(account.account_id, window);
  const firstParty = await ctx.connector.getFirstPartyRevenue(account.account_id, window);
  const metrics = normalizeMetrics(daily, firstParty, {
    scope: "campaign",
    window,
  });
  return { account, campaigns, daily, firstParty, metrics };
}

export async function getPacketOrThrow(
  store: Store,
  packetId: string,
): Promise<z.infer<typeof H0Packet>> {
  const packet = await store.get<unknown>("h0_packets", packetId);
  if (packet === null) {
    throw new Error(`mcp-server: H0 packet "${packetId}" not found in store`);
  }
  return H0Packet.parse(packet);
}

export function unique(values: string[]): string[] {
  return Array.from(new Set(values)).sort();
}
