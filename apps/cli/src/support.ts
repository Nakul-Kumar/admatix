import { mkdir, readdir, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { Command } from "commander";
import {
  createStore,
  normalizeMetrics,
  nowIso,
  type Store,
} from "@admatix/core";
import {
  fixtureConnector,
  resolveAccountRef,
  type Connector,
} from "@admatix/connectors";
import { buildH0Packets, runAudit, type DetectorInput } from "@admatix/evidence";
import type {
  AuditReport,
  Campaign,
  ExecutionDiff,
  H0Packet,
  PlatformAccount,
  ProposedAction,
} from "@admatix/schemas";
import {
  ApprovalReceipt,
  OutcomeMeasurement,
  RollbackCheckpoint,
} from "@admatix/schemas";
import { makeDiffBuilderAgent, makePlatformAdapterAgent } from "@admatix/agents";
import { evaluateAction, signApprovalReceipt } from "@admatix/policy";

export const DEFAULT_WINDOW = "2026-05-12..2026-05-21";
export const DEFAULT_GOAL = "reduce CAC 10% without MER below 3.0";
export const DEFAULT_TENANT = "tenant_demo";

export interface CliContext {
  readonly storeRoot?: string;
  readonly output?: NodeJS.WritableStream;
  readonly errorOutput?: NodeJS.WritableStream;
}

export class CliError extends Error {
  readonly exitCode: number;
  readonly json?: unknown;

  constructor(message: string, exitCode = 1, json?: unknown) {
    super(message);
    this.name = "CliError";
    this.exitCode = exitCode;
    this.json = json;
  }
}

export function getStore(command: Command): Store {
  return createStore(resolveStoreRoot(command));
}

export function resolveStoreRoot(command: Command): string | undefined {
  return command.optsWithGlobals<{ storeRoot?: string }>().storeRoot;
}

export function wantsJson(command: Command): boolean {
  return command.optsWithGlobals<{ json?: boolean }>().json === true;
}

export function writeResult<T>(
  command: Command,
  value: T,
  human: (value: T) => string,
  ctx: CliContext,
): void {
  const out = ctx.output ?? process.stdout;
  out.write(wantsJson(command) ? `${stableJson(value)}\n` : human(value));
}

export function printError(error: CliError, ctx: CliContext): void {
  const err = ctx.errorOutput ?? process.stderr;
  if (error.json) {
    err.write(`${stableJson(error.json)}\n`);
    return;
  }
  err.write(`${error.message}\n`);
}

export function stableJson(value: unknown): string {
  return JSON.stringify(sortJson(value), null, 2);
}

export async function initLocalStore(root?: string): Promise<{ root: string; created: string[] }> {
  const target = resolve(root ?? "data");
  const dirs = [
    join(target, "state", "h0_packets"),
    join(target, "state", "audit_reports"),
    join(target, "state", "execution_diffs"),
    join(target, "state", "approval_receipts"),
    join(target, "state", "outcome_measurements"),
    join(target, "events"),
  ];
  for (const dir of dirs) await mkdir(dir, { recursive: true });
  return { root: target, created: dirs };
}

export async function buildAuditForRef(
  accountRef: string,
  window = DEFAULT_WINDOW,
): Promise<{ report: AuditReport; input: DetectorInput; connector: Connector }> {
  const { account, connector } = await resolveFixtureAccount(accountRef);
  const campaigns = await connector.getCampaigns(account.account_id);
  const daily = await connector.getCampaignDailyMetrics(account.account_id, window);
  const firstParty = await connector.getFirstPartyRevenue(account.account_id, window);
  const metrics = normalizeMetrics(daily, firstParty, {
    scope: "campaign",
    window,
  });
  const input: DetectorInput = { account, campaigns, daily, firstParty, metrics };
  const report = runAudit(input, window);
  return { report, input, connector };
}

export async function resolveFixtureAccount(
  accountRef: string,
): Promise<{ account: PlatformAccount; connector: Connector; canonicalRef: string }> {
  let parsed: ReturnType<typeof resolveAccountRef>;
  try {
    parsed = resolveAccountRef(accountRef);
  } catch (error) {
    throw actionable(
      `Invalid account ref "${accountRef}".`,
      `Use "fixture:agency-demo" for the MVP fixture account. Detail: ${messageOf(error)}`,
      2,
      "invalid_account_ref",
      { account_ref: accountRef },
    );
  }
  if (parsed.kind !== "fixture") {
    throw actionable(
      `Unsupported account ref "${accountRef}".`,
      "The MVP supports fixtures only; rerun with fixture:agency-demo.",
      2,
      "unsupported_account_ref",
      { account_ref: accountRef },
    );
  }
  const connector = fixtureConnector("google_ads");
  const accounts = await connector.listAccounts();
  const expectedId = fixtureAliasToId(parsed.id);
  const account = accounts.find((candidate) => candidate.account_id === expectedId);
  if (!account) {
    throw actionable(
      `Unknown fixture account "${parsed.id}".`,
      `Use "fixture:agency-demo" or one of: ${accounts.map((a) => `fixture:${a.account_id}`).join(", ")}.`,
      2,
      "unknown_fixture_account",
      { account_ref: accountRef, available: accounts.map((a) => a.account_id) },
    );
  }
  return { account, connector, canonicalRef: `fixture:${account.account_id}` };
}

export function fixtureAliasToId(id: string): string {
  return id === "agency-demo" ? "acc_demo" : id;
}

export async function ensureDemoPackets(store: Store): Promise<H0Packet[]> {
  const existing = await store.list<H0Packet>("h0_packets");
  if (existing.length > 0) return existing;
  const { report } = await buildAuditForRef("fixture:agency-demo", DEFAULT_WINDOW);
  await store.put("audit_reports", report.report_id, report);
  const packets = buildH0Packets(report, DEFAULT_GOAL, DEFAULT_TENANT).map((packet, index) =>
    withCliDemoId(packet, index),
  );
  for (const packet of packets) await store.put("h0_packets", packet.packet_id, packet);
  return packets;
}

export async function getPacketOrDemo(store: Store, packetId: string): Promise<H0Packet> {
  const stored = await store.get<H0Packet>("h0_packets", packetId);
  if (stored) return stored;
  if (/^h0_\d{3}$/.test(packetId)) {
    await ensureDemoPackets(store);
    const demo = await store.get<H0Packet>("h0_packets", packetId);
    if (demo) return demo;
  }
  throw actionable(
    `Unknown H0 packet "${packetId}".`,
    "Run `admatix plan --account fixture:agency-demo --goal \"reduce CAC 10% without MER below 3.0\"` first, or use h0_001 for the demo packet.",
    2,
    "unknown_packet",
    { packet_id: packetId },
  );
}

export async function activatePacketDryRun(packet: H0Packet): Promise<{
  action: ProposedAction;
  decision: ReturnType<typeof evaluateAction>;
  diff: ExecutionDiff | null;
}> {
  const traceId = packet.trace_id;
  const adapter = makePlatformAdapterAgent({ traceId });
  const builder = makeDiffBuilderAgent({ traceId });
  const { action } = await adapter.translate({ packet });
  const campaign = await campaignForPacket(packet);
  const decision = evaluateAction(action, {
    campaign,
    guardrails: packet.guardrails,
  });
  if (decision.result === "block") {
    return { action, decision, diff: null };
  }
  const built = await builder.build({ action, packet, campaign });
  return { action, decision, diff: built.diff };
}

export async function seedDemo(store: Store): Promise<{
  audit_report_id: string;
  packet_ids: string[];
}> {
  const { report } = await buildAuditForRef("fixture:agency-demo", DEFAULT_WINDOW);
  await store.put("audit_reports", report.report_id, report);
  const packets = buildH0Packets(report, DEFAULT_GOAL, DEFAULT_TENANT).map((packet, index) =>
    withCliDemoId(packet, index),
  );
  for (const packet of packets) await store.put("h0_packets", packet.packet_id, packet);
  return { audit_report_id: report.report_id, packet_ids: packets.map((p) => p.packet_id) };
}

export async function listFixtureFiles(): Promise<string[]> {
  const root = fixtureRoot();
  const files: string[] = [];
  await collectJsonFiles(root, files);
  return files.map((file) => file.slice(root.length + 1)).sort();
}

export async function approvePacket(
  store: Store,
  packet: H0Packet,
  decidedBy: string,
  note?: string,
): Promise<ApprovalReceipt> {
  const activation = await activatePacketDryRun(packet);
  const decided_at = nowIso();
  const expires_at = new Date(Date.parse(decided_at) + 15 * 60 * 1000).toISOString();
  const receipt = ApprovalReceipt.parse({
    receipt_id: `approval_${packet.packet_id}`,
    packet_id: packet.packet_id,
    action_id: activation.action.action_id,
    decision: "approved",
    decided_by: decidedBy,
    role: "media_manager",
    decided_at,
    expires_at,
    note,
  });
  receipt.signature = signApprovalReceipt(receipt);
  await store.put("approval_receipts", receipt.receipt_id, receipt);
  return receipt;
}

export async function measurePacket(store: Store, packet: H0Packet): Promise<OutcomeMeasurement> {
  const measurement = OutcomeMeasurement.parse({
    measurement_id: `measure_${packet.packet_id}`,
    packet_id: packet.packet_id,
    success_metric: packet.success_metric,
    baseline_value: null,
    observed_value: null,
    delta_pct: null,
    passed: false,
    notes: ["MVP measurement is a placeholder until verifier service is wired."],
    evidence: packet.evidence,
    measured_at: nowIso(),
  });
  await store.put("outcome_measurements", measurement.measurement_id, measurement);
  return measurement;
}

export async function rollbackPacket(store: Store, packet: H0Packet): Promise<RollbackCheckpoint> {
  const checkpoint = RollbackCheckpoint.parse({
    checkpoint_id: packet.rollback.checkpoint_id,
    entity_id: packet.proposal.target_entity_id ?? packet.packet_id,
    snapshot: {
      method: packet.rollback.method,
      dry_run_only: true,
    },
    created_at: nowIso(),
  });
  await store.put("rollback_checkpoints", checkpoint.checkpoint_id, checkpoint);
  return checkpoint;
}

export function actionable(
  headline: string,
  fix: string,
  exitCode: number,
  code: string,
  details: Record<string, unknown>,
): CliError {
  return new CliError(`${headline} ${fix}`, exitCode, {
    ok: false,
    error: { code, message: headline, fix, details },
  });
}

export function withCliDemoId(packet: H0Packet, index: number): H0Packet {
  const id = `h0_${String(index + 1).padStart(3, "0")}`;
  return { ...packet, packet_id: id };
}

async function campaignForPacket(packet: H0Packet): Promise<Campaign | undefined> {
  const { connector, account } = await resolveFixtureAccount("fixture:agency-demo");
  const campaigns = await connector.getCampaigns(account.account_id);
  const target = packet.proposal.target_entity_id;
  return campaigns.find((campaign) => campaign.campaign_id === target);
}

async function collectJsonFiles(dir: string, out: string[]): Promise<void> {
  const entries = await readdir(dir);
  for (const entry of entries) {
    const full = join(dir, entry);
    const info = await stat(full);
    if (info.isDirectory()) await collectJsonFiles(full, out);
    else if (entry.endsWith(".json")) out.push(full);
  }
}

function fixtureRoot(): string {
  const override = process.env["ADMATIX_FIXTURE_ROOT"];
  if (override) return override;
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 12; i += 1) {
    const candidate = join(dir, "data", "fixtures");
    if (existsSync(candidate)) return candidate;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw actionable(
    "Could not locate data/fixtures.",
    "Run commands from the repo root or set ADMATIX_FIXTURE_ROOT.",
    2,
    "fixtures_missing",
    {},
  );
}

function sortJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortJson);
  if (value === null || typeof value !== "object") return value;
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(value).sort()) {
    out[key] = sortJson((value as Record<string, unknown>)[key]);
  }
  return out;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
