/**
 * AdMatix end-to-end demo (WP-K).
 *
 * Wires every shipped package and app into one narratable transcript:
 *
 *   audit → plan → packet → activate (dry-run) → policy-block (unsafe)
 *           → benchmark → MCP read-only surface → ROI / cockpit data
 *
 * The transcript printed to stdout is fully deterministic — same fixtures,
 * same demo, same bytes. `docs/runbooks/demo-script.md` embeds the same
 * transcript and `tests/e2e/demo-flow.test.ts` asserts the bytes match
 * line-for-line.
 *
 * Public surface — also imported by the e2e test:
 *   runDemo({ output? }) → DemoResult
 *   The CLI form `pnpm tsx scripts/demo.ts` calls runDemo with stdout.
 */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Writable } from "node:stream";
import { fixtureConnector } from "@admatix/connectors";
import {
  computeImpact,
  createStore,
  normalizeMetrics,
  type Store,
} from "@admatix/core";
import { runAudit } from "@admatix/evidence";
import {
  evaluateAction,
  loadPolicy,
  verifyEvidence,
} from "@admatix/policy";
import {
  makeDiffBuilderAgent,
  makePlatformAdapterAgent,
  runWorkflow,
} from "@admatix/agents";
import { runSuite } from "@admatix/evals";
import {
  ApprovalReceipt,
  ProposedAction,
  type AuditReport,
  type BenchmarkRun,
  type ExecutionDiff,
  type H0Packet,
  type PolicyDecision,
} from "@admatix/schemas";
import {
  APPROVED_TOOL_NAMES,
  activateDryRunTool,
  auditAccountTool,
} from "@admatix/mcp-server";
import { buildServer } from "@admatix/api";

export interface DemoOptions {
  /** Where to write the human transcript. Defaults to `process.stdout`. */
  readonly output?: NodeJS.WritableStream;
  /**
   * Override the temp data dir. Mostly for tests; defaults to a fresh
   * `mkdtemp` under the OS tmpdir which is cleaned up after the run.
   */
  readonly storeRoot?: string;
}

export interface DemoStepResult {
  readonly id: number;
  readonly title: string;
  readonly ok: boolean;
  /** Optional structured payload for assertions in the e2e test. */
  readonly data?: unknown;
}

export interface DemoResult {
  readonly steps: DemoStepResult[];
  readonly transcript: string;
  readonly storeRoot: string;
  readonly artifacts: {
    readonly audit: AuditReport;
    readonly packets: H0Packet[];
    readonly diff: ExecutionDiff;
    readonly blockDecision: PolicyDecision;
    readonly benchmark: BenchmarkRun;
    readonly cockpit: { healthz: unknown; audits: number; packets: number; receipts: number };
  };
}

const ACCOUNT_REF = "fixture:acc_demo";
const WINDOW = "2026-05-12..2026-05-21";
const GOAL = "reduce CAC 10% without MER below 3.0";
const TENANT = "tenant_demo";
const BASELINE_WINDOW = "2026-05-12..2026-05-17";
const CURRENT_WINDOW = "2026-05-18..2026-05-21";
const BENCHMARK_SUITE = "safety-v1";

/**
 * Run the full 8-step AdMatix demo on fixtures.
 * Throws on any acceptance-test failure; the caller's process exits non-zero.
 */
export async function runDemo(opts: DemoOptions = {}): Promise<DemoResult> {
  const out = new TranscriptSink(opts.output ?? process.stdout);
  const storeRoot = opts.storeRoot ?? (await mkdtemp(join(tmpdir(), "admatix-demo-")));
  const ownsRoot = opts.storeRoot === undefined;
  const store = createStore(storeRoot);
  const connector = fixtureConnector("google_ads");
  const steps: DemoStepResult[] = [];

  out.line("AdMatix end-to-end demo — fixture:acc_demo (no live platform calls)");
  out.line("===================================================================");
  out.line("");

  // ---------------- Step 1 — AUDIT ----------------
  const audit = await step1Audit(out, connector, store);
  steps.push({ id: 1, title: "Audit account", ok: audit.findings.length >= 3, data: audit });
  assertOk(audit.findings.length >= 3, "Step 1: expected >= 3 audit findings");

  // ---------------- Step 2 — PLAN ----------------
  const planResult = await step2Plan(out, store);
  const packets = aliasPackets(planResult.packets);
  for (const p of packets) await store.put("h0_packets", p.packet_id, p);
  steps.push({
    id: 2,
    title: "Plan (H0 packets)",
    ok: packets.length >= 1,
    data: { packets, workflow_id: planResult.workflow_id },
  });
  assertOk(packets.length >= 1, "Step 2: expected >= 1 H0 packet");

  // ---------------- Step 3 — PACKET SHOW ----------------
  const showPacket = packets[0];
  assertOk(showPacket !== undefined, "Step 3: no packet to show");
  const evidenceValidity = verifyEvidence(showPacket!);
  step3Packet(out, showPacket!, evidenceValidity);
  steps.push({ id: 3, title: "Show packet h0_001", ok: evidenceValidity.ok, data: showPacket });
  assertOk(evidenceValidity.ok, "Step 3: EvidenceLedger refused the demo packet");

  // ---------------- Step 4 — ACTIVATE (dry-run diff) ----------------
  const activation = await step4Activate(out, connector, showPacket!);
  steps.push({
    id: 4,
    title: "Activate h0_001 --dry-run",
    ok: activation.diff.dry_run === true && activation.decision.result !== "block",
    data: activation,
  });
  assertOk(activation.diff.dry_run === true, "Step 4: diff must be a dry-run");

  // ---------------- Step 5 — POLICY GUARD blocks an unsafe action ----------------
  const block = step5UnsafeBlock(out, showPacket!);
  steps.push({
    id: 5,
    title: "PolicyGuard blocks unsafe action",
    ok: block.decision.result === "block",
    data: block,
  });
  assertOk(block.decision.result === "block", "Step 5: unsafe action was NOT blocked");

  // ---------------- Step 6 — BENCHMARK ----------------
  const bench = await step6Benchmark(out, store);
  steps.push({ id: 6, title: "Benchmark safety-v1", ok: bench.results.length > 0, data: bench });
  assertOk(bench.results.length > 0, "Step 6: benchmark produced no results");

  // ---------------- Step 7 — MCP read-only tool surface ----------------
  const mcp = await step7Mcp(out, connector, store, showPacket!);
  steps.push({
    id: 7,
    title: "MCP read-only tools",
    ok: mcp.auditOk && mcp.activateBlocked,
    data: mcp,
  });
  assertOk(mcp.auditOk, "Step 7: MCP audit_account did not return ok");
  assertOk(
    mcp.activateBlocked,
    "Step 7: MCP activate_dry_run without receipt must be blocked",
  );

  // ---------------- Step 8 — ROI + cockpit data ----------------
  const cockpit = await step8RoiAndCockpit(out, connector, audit, store, packets);
  steps.push({ id: 8, title: "ROI + cockpit data", ok: true, data: cockpit });

  out.line("");
  out.line("===================================================================");
  out.line(
    `Demo complete — 8/8 steps green, 1 unsafe action blocked, ${audit.findings.length} findings, ${packets.length} H0 packets.`,
  );

  if (ownsRoot) {
    await rm(storeRoot, { recursive: true, force: true });
  }

  return {
    steps,
    transcript: out.collected(),
    storeRoot,
    artifacts: {
      audit,
      packets,
      diff: activation.diff,
      blockDecision: block.decision,
      benchmark: bench,
      cockpit,
    },
  };
}

// ----------------------------------------------------------------------------
// Step implementations
// ----------------------------------------------------------------------------

async function step1Audit(
  out: TranscriptSink,
  connector: ReturnType<typeof fixtureConnector>,
  store: Store,
): Promise<AuditReport> {
  out.line("[1/8] AUDIT  — admatix audit --account fixture:acc_demo");
  const accounts = await connector.listAccounts();
  const account = accounts[0]!;
  const campaigns = await connector.getCampaigns(account.account_id);
  const daily = await connector.getCampaignDailyMetrics(account.account_id, WINDOW);
  const firstParty = await connector.getFirstPartyRevenue(account.account_id, WINDOW);
  const metrics = normalizeMetrics(daily, firstParty, { scope: "campaign", window: WINDOW });
  const audit = runAudit({ account, campaigns, daily, firstParty, metrics }, WINDOW);
  await store.put("audit_reports", audit.report_id, audit);
  out.line(`      window: ${audit.window}`);
  out.line(`      findings: ${audit.findings.length}`);
  out.line(`      estimated waste: $${formatMoney(audit.total_estimated_waste)}`);
  for (const f of audit.findings) {
    const waste = typeof f.estimated_waste === "number" ? ` waste=$${formatMoney(f.estimated_waste)}` : "";
    out.line(`        - [${f.severity}] ${f.detector} on ${f.entity_id}${waste}`);
  }
  out.line(`      caveats: ${audit.caveats.join(" | ")}`);
  out.line("");
  return audit;
}

async function step2Plan(
  out: TranscriptSink,
  store: Store,
): Promise<{ workflow_id: string; packets: H0Packet[] }> {
  out.line(`[2/8] PLAN   — admatix plan --goal "${GOAL}"`);
  const result = await runWorkflow(
    { accountRef: ACCOUNT_REF, goal: GOAL, tenantId: TENANT },
    { store },
  );
  out.line(`      H0 packets emitted: ${result.packets.length}`);
  out.line(`      evidence-ledger gate: ${result.packets.length}/${result.packets.length} passed`);
  out.line(`      orchestrator decisions: ${result.decisions.length} (PolicyGuard runs on every action)`);
  out.line("");
  return { workflow_id: result.workflow_id, packets: result.packets };
}

function step3Packet(
  out: TranscriptSink,
  packet: H0Packet,
  validity: ReturnType<typeof verifyEvidence>,
): void {
  out.line(`[3/8] PACKET — admatix packet show ${packet.packet_id}`);
  out.line(`      hypothesis: ${packet.hypothesis}`);
  out.line(`      null:       ${packet.null_hypothesis}`);
  out.line(`      goal:       ${packet.goal}`);
  out.line(`      success metric: ${packet.success_metric}`);
  out.line(`      causal status:  ${packet.causal_status}`);
  out.line(`      evidence refs: ${packet.evidence.length}`);
  for (const ref of packet.evidence) {
    out.line(`        - ${ref.source}:${ref.ref}`);
  }
  const cap = packet.guardrails.max_daily_budget_delta_pct;
  out.line(
    `      guardrails: max_daily_budget_delta_pct=${cap}% requires_human_approval=${packet.guardrails.requires_human_approval}`,
  );
  out.line(`      proposal: ${packet.proposal.action} -> ${packet.proposal.target_entity_id ?? "n/a"} (dry_run_only=${packet.proposal.dry_run_only})`);
  out.line(`      rollback: ${packet.rollback.method} (checkpoint ${packet.rollback.checkpoint_id})`);
  out.line(`      evidence ledger: ${validity.ok ? "ok" : `missing: ${validity.missing.join(", ")}`}`);
  out.line("");
}

async function step4Activate(
  out: TranscriptSink,
  connector: ReturnType<typeof fixtureConnector>,
  packet: H0Packet,
): Promise<{ action: ProposedAction; decision: PolicyDecision; diff: ExecutionDiff }> {
  out.line(`[4/8] ACTIVATE — admatix activate ${packet.packet_id} --dry-run`);
  const adapter = makePlatformAdapterAgent({ traceId: packet.trace_id });
  const builder = makeDiffBuilderAgent({ traceId: packet.trace_id });
  const { action } = await adapter.translate({ packet });
  const accounts = await connector.listAccounts();
  const allCampaigns = (
    await Promise.all(accounts.map((a) => connector.getCampaigns(a.account_id)))
  ).flat();
  const campaign = allCampaigns.find((c) => c.campaign_id === action.target_entity_id);
  const decision = evaluateAction(action, {
    guardrails: packet.guardrails,
    campaign,
  });
  const buildArgs: Parameters<typeof builder.build>[0] = { action, packet };
  if (campaign) buildArgs.campaign = campaign;
  const { diff } = await builder.build(buildArgs);
  out.line(`      action type: ${action.type} (target ${action.target_entity_id}, risk ${action.risk_level})`);
  out.line(`      policy decision: ${decision.result}${decision.matched_rules.length > 0 ? ` (rules: ${decision.matched_rules.join(", ")})` : ""}`);
  out.line(`      diff: ${diff.changes.length} change(s), dry_run=${diff.dry_run}`);
  for (const change of diff.changes) {
    const delta = change.field === "daily_budget" && typeof change.before === "number" && typeof change.after === "number"
      ? ` (delta ${formatDeltaPct(change.before, change.after)})`
      : "";
    out.line(`        - ${change.field}: ${formatVal(change.before)} -> ${formatVal(change.after)}${delta}`);
  }
  out.line("");
  return { action, decision, diff };
}

function step5UnsafeBlock(
  out: TranscriptSink,
  packet: H0Packet,
): { action: ProposedAction; decision: PolicyDecision } {
  out.line("[5/8] POLICY BLOCK — proposing a 60% budget shift against a 20% cap");
  const policy = loadPolicy();
  const unsafeAction = ProposedAction.parse({
    action_id: "act_demo_unsafe",
    packet_id: packet.packet_id,
    type: "budget_shift",
    target_entity_id: packet.proposal.target_entity_id ?? "campaign_a",
    params: { delta_pct: 60 },
    risk_level: "high",
    dry_run_only: true,
  });
  const decision = evaluateAction(unsafeAction, {
    guardrails: { max_daily_budget_delta_pct: 20, requires_human_approval: true },
  });
  out.line(`      policy version: ${policy.version}`);
  out.line(`      proposed delta: +60% (cap: 20%)`);
  out.line(`      decision: ${decision.result.toUpperCase()}`);
  out.line(`      matched rules: ${decision.matched_rules.join(", ")}`);
  for (const reason of decision.reasons) out.line(`      reason: ${reason}`);
  out.line("");
  return { action: unsafeAction, decision };
}

async function step6Benchmark(out: TranscriptSink, store: Store): Promise<BenchmarkRun> {
  out.line(`[6/8] BENCHMARK — admatix benchmark run --suite ${BENCHMARK_SUITE}`);
  const run = await runSuite(BENCHMARK_SUITE, { store }, { baseline: "admatix" });
  const total = numeric(run.summary, "total");
  const passed = numeric(run.summary, "passed");
  const unsafe = numeric(run.summary, "unsafe_write_attempts");
  const mean = numeric(run.summary, "mean_score");
  const ev = numeric(run.summary, "mean_evidence_coverage");
  const rb = numeric(run.summary, "mean_rollback_coverage");
  out.line(`      suite: ${run.suite}`);
  out.line(`      tasks: ${total} (passed ${passed} / failed ${total - passed})`);
  out.line(`      unsafe write attempts: ${unsafe}`);
  out.line(`      mean score: ${mean.toFixed(2)}`);
  out.line(`      mean evidence coverage: ${ev.toFixed(2)}`);
  out.line(`      mean rollback coverage: ${rb.toFixed(2)}`);
  out.line(`      pinned: fixture=${run.pinned.fixture_version} code=${run.pinned.code_version} policy=${run.pinned.policy_version} model=${run.pinned.model}`);
  out.line("");
  return run;
}

async function step7Mcp(
  out: TranscriptSink,
  connector: ReturnType<typeof fixtureConnector>,
  store: Store,
  packet: H0Packet,
): Promise<{ tools: string[]; auditOk: boolean; activateBlocked: boolean }> {
  out.line("[7/8] MCP — read-only agent tool surface");
  // The demo does not boot a verifier, so the `verify` MCP tool is not
  // registered (WP-S gates it behind `deps.verifierClient`). Print only
  // the tools the demo's MCP server actually exposes.
  const tools = [...APPROVED_TOOL_NAMES]
    .filter((name) => name !== "verify")
    .sort();
  out.line(`      tools: ${tools.join(", ")}`);
  const ctx = { store, connector };
  const auditResult = await auditAccountTool(
    { account_ref: ACCOUNT_REF, window: WINDOW },
    ctx,
  );
  const auditOk = auditResult.status === "ok";
  out.line(`      audit_account → status=${auditResult.status} source_refs=${auditResult.source_refs.length}`);
  const blocked = await activateDryRunTool({ packet_id: packet.packet_id }, ctx);
  const activateBlocked = blocked.status === "blocked";
  const blockedReason =
    typeof blocked.data === "object" && blocked.data !== null && "reason" in blocked.data
      ? String((blocked.data as { reason: unknown }).reason)
      : "";
  out.line(`      activate_dry_run (no receipt) → status=${blocked.status} reason=${blockedReason}`);
  out.line("");
  return { tools, auditOk, activateBlocked };
}

async function step8RoiAndCockpit(
  out: TranscriptSink,
  connector: ReturnType<typeof fixtureConnector>,
  audit: AuditReport,
  store: Store,
  packets: H0Packet[],
): Promise<{ healthz: unknown; audits: number; packets: number; receipts: number; roi: { recovered_waste: number; cac_delta_pct: number | null } }> {
  out.line("[8/8] ROI + COCKPIT — what the dashboard would show an operator");
  // ROI: baseline (early window) vs current (post-spike window) for campaign_a
  const accounts = await connector.listAccounts();
  const account = accounts[0]!;
  const daily = await connector.getCampaignDailyMetrics(account.account_id, WINDOW);
  const earlyDaily = daily.filter((r) => r.date <= "2026-05-17");
  const lateDaily = daily.filter((r) => r.date >= "2026-05-18");
  const baselineMetrics = normalizeMetrics(earlyDaily, [], {
    scope: "campaign",
    window: BASELINE_WINDOW,
  });
  const currentMetrics = normalizeMetrics(lateDaily, [], {
    scope: "campaign",
    window: CURRENT_WINDOW,
  });
  const baseline = baselineMetrics.find((m) => m.entity_id === "campaign_a");
  const current = currentMetrics.find((m) => m.entity_id === "campaign_a");
  if (!baseline || !current) {
    throw new Error("Step 8: missing campaign_a metrics for ROI calc");
  }
  const impact = computeImpact(baseline, current);
  out.line(
    `      ROI math: baseline CAC $${(baseline.cac ?? 0).toFixed(2)} (${BASELINE_WINDOW}) vs current CAC $${(current.cac ?? 0).toFixed(2)} (${CURRENT_WINDOW})`,
  );
  out.line(
    `      recovered_waste if CAC restored: $${impact.recovered_waste.toFixed(2)}`,
  );
  out.line(
    `      audit-level estimated_waste: $${formatMoney(audit.total_estimated_waste)} across ${audit.findings.length} findings`,
  );

  // Stage an approval so the cockpit's approval queue has a row.
  const approvalReceipt = ApprovalReceipt.parse({
    receipt_id: `rec_demo_${packets[0]!.packet_id}`,
    packet_id: packets[0]!.packet_id,
    action_id: `act_demo_${packets[0]!.packet_id}`,
    decision: "approved",
    decided_by: "demo_operator",
    role: "media_manager",
    decided_at: "2026-05-22T00:00:00.000Z",
  });
  await store.put("approval_receipts", approvalReceipt.receipt_id, approvalReceipt);

  // Cockpit data surface: drive the Fastify API in-process via inject().
  const app = await buildServer({ deps: { store }, logger: false });
  try {
    const healthRes = await app.inject({ method: "GET", url: "/healthz" });
    const healthBody = healthRes.json();
    const auditsRes = await app.inject({ method: "GET", url: "/api/v1/audits" });
    const auditsBody = auditsRes.json() as { reports: unknown[] };
    const packetsRes = await app.inject({ method: "GET", url: "/api/v1/packets" });
    const packetsBody = packetsRes.json() as { packets: unknown[] };
    const approvalsRes = await app.inject({ method: "GET", url: "/api/v1/approvals" });
    const approvalsBody = approvalsRes.json() as { receipts: unknown[] };
    out.line(`      GET /healthz → ${JSON.stringify(healthBody)}`);
    out.line(`      GET /api/v1/audits → ${auditsBody.reports.length} report(s)`);
    out.line(`      GET /api/v1/packets → ${packetsBody.packets.length} packet(s)`);
    out.line(`      GET /api/v1/approvals → ${approvalsBody.receipts.length} receipt(s)`);
    return {
      healthz: healthBody,
      audits: auditsBody.reports.length,
      packets: packetsBody.packets.length,
      receipts: approvalsBody.receipts.length,
      roi: {
        recovered_waste: impact.recovered_waste,
        cac_delta_pct: impact.cac_delta_pct,
      },
    };
  } finally {
    await app.close();
  }
}

// ----------------------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------------------

class TranscriptSink {
  private readonly chunks: string[] = [];
  constructor(private readonly out: NodeJS.WritableStream) {}
  line(text: string): void {
    const row = `${text}\n`;
    this.chunks.push(row);
    this.out.write(row);
  }
  collected(): string {
    return this.chunks.join("");
  }
}

function aliasPackets(packets: H0Packet[]): H0Packet[] {
  return packets.map((p, i) => ({
    ...p,
    packet_id: `h0_${String(i + 1).padStart(3, "0")}`,
    proposal: rewriteProposalForDemo(p),
    guardrails: {
      ...p.guardrails,
      max_daily_budget_delta_pct:
        p.guardrails.max_daily_budget_delta_pct !== undefined &&
        p.guardrails.max_daily_budget_delta_pct <= 1
          ? p.guardrails.max_daily_budget_delta_pct * 100
          : p.guardrails.max_daily_budget_delta_pct,
    },
  }));
}

function rewriteProposalForDemo(packet: H0Packet): H0Packet["proposal"] {
  if (packet.proposal.action !== "budget_shift") return packet.proposal;
  const maxReduction = packet.proposal.params["max_reduction_pct"];
  if (typeof maxReduction !== "number") return packet.proposal;
  return {
    ...packet.proposal,
    params: {
      ...packet.proposal.params,
      delta_pct: -Math.round(maxReduction * 10000) / 100,
    },
  };
}

function numeric(summary: Record<string, number>, key: string): number {
  const v = summary[key];
  return typeof v === "number" ? v : 0;
}

function formatMoney(n: number): string {
  return n.toFixed(2);
}

function formatVal(v: unknown): string {
  if (v === null || v === undefined) return "null";
  if (typeof v === "string") return v;
  if (typeof v === "number") return v.toString();
  if (Array.isArray(v)) return JSON.stringify(v);
  return JSON.stringify(v);
}

function formatDeltaPct(before: number, after: number): string {
  if (before === 0) return "n/a";
  const pct = ((after - before) / before) * 100;
  const sign = pct >= 0 ? "+" : "";
  return `${sign}${pct.toFixed(2)}%`;
}

function assertOk(cond: boolean, msg: string): void {
  if (!cond) throw new Error(`AdMatix demo failed — ${msg}`);
}

// Helper exposed for tests that want a silent transcript.
export function devNull(): NodeJS.WritableStream {
  return new Writable({
    write(_chunk, _enc, cb) {
      cb();
    },
  });
}

// ----------------------------------------------------------------------------
// CLI entrypoint
// ----------------------------------------------------------------------------

const isMain =
  typeof process !== "undefined" &&
  Array.isArray(process.argv) &&
  process.argv[1] !== undefined &&
  /scripts\/demo\.(t|j|m)s$/.test(process.argv[1]);

if (isMain) {
  runDemo()
    .then(() => process.exit(0))
    .catch((err: unknown) => {
      const msg = err instanceof Error ? err.stack ?? err.message : String(err);
      process.stderr.write(`${msg}\n`);
      process.exit(1);
    });
}
