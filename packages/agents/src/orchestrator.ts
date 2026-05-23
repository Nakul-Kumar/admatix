import {
  AgentRun,
  type AgentOutput,
  type AuditReport,
  type Campaign,
  type CampaignDailyMetric,
  type CreativeDailyMetric,
  type ExecutionDiff,
  type FirstPartyRevenueDaily,
  type H0Packet,
  type NormalizedMetrics,
  type PlatformAccount,
  type PolicyDecision,
  type WorkflowStep,
} from "@admatix/schemas";
import {
  newId,
  normalizeMetrics,
  nowIso,
  sha256,
  type Store,
} from "@admatix/core";
import {
  fixtureConnector,
  resolveAccountRef,
  type Connector,
} from "@admatix/connectors";
import {
  createEvidenceResolver,
  emitEvent,
  type EventStore,
  type EvidenceResolver,
} from "@admatix/policy";
import type { DetectorInput } from "@admatix/evidence";
import { makeOrchestratorAgent } from "./agents/orchestrator-agent.js";
import { makePolicyGuardAgent } from "./agents/policy-guard-agent.js";
import { makeEvidenceLedgerAgent } from "./agents/evidence-ledger-agent.js";
import { makeApprovalCoordinatorAgent } from "./agents/approval-coordinator-agent.js";
import {
  makeMediaAnalystAgent,
  type MediaAnalystDeps,
} from "./agents/media-analyst-agent.js";
import { makeMeasurementScientistAgent } from "./agents/measurement-scientist-agent.js";
import { makePlatformAdapterAgent } from "./agents/platform-adapter-agent.js";
import { makeDiffBuilderAgent } from "./agents/diff-builder-agent.js";
import { makeReflectionAgent } from "./agents/reflection-agent.js";
import type { WorkflowIntent, WorkflowResult } from "./types.js";

const POLICY_VERSION = "v1";

export interface WorkflowDeps {
  store: Store;
  /** Override the connector. Defaults to {@link fixtureConnector}. */
  connector?: Connector;
  /**
   * Override the evidence layer. Defaults to `@admatix/evidence`. Wired as
   * a dep so the orchestrator can be exercised against test fixtures while
   * the production detectors and packet builder land in WP-D.
   */
  evidence?: MediaAnalystDeps;
}

/**
 * Execute the four-step loop end to end:
 *   Plan      → MediaAnalyst (audit + H0 packets), each gated by EvidenceLedger
 *   Activate  → PlatformAdapter (action) → PolicyGuard → DiffBuilder
 *   Measure   → MeasurementScientist appends causal caveats
 *   Reflect   → Reflection updates the trust ledger
 *
 * Returns a {@link WorkflowResult}. Persists every agent run, every packet,
 * every action, every diff, and emits an `AdmatixEvent` for every step.
 *
 * Determinism: identical inputs produce identical results modulo the
 * `created_at`/`run_id`/`diff_id`/`action_id` timestamps and ids (the
 * structural payloads and their `input_hash`/`output_hash` values are
 * byte-identical).
 */
export async function runWorkflow(
  intent: WorkflowIntent,
  deps: WorkflowDeps,
): Promise<WorkflowResult> {
  const trace_id = newId("trace");
  const workflow_id = newId("wf");
  const ref = resolveAccountRef(intent.accountRef);
  const connector = deps.connector ?? fixtureConnector();
  const { store } = deps;

  // ---------- Plan ----------
  const orchestratorAgent = makeOrchestratorAgent({ traceId: trace_id });
  const mediaAnalyst = makeMediaAnalystAgent({
    traceId: trace_id,
    deps: deps.evidence,
  });
  // EvidenceLedger resolver is wired below after we've loaded campaigns +
  // daily metrics. We pass it into the agent factory at that point.
  const measurementScientist = makeMeasurementScientistAgent({ traceId: trace_id });
  const policyGuard = makePolicyGuardAgent({ traceId: trace_id });
  const approvalCoordinator = makeApprovalCoordinatorAgent({ traceId: trace_id });
  const platformAdapter = makePlatformAdapterAgent({ traceId: trace_id });
  const diffBuilder = makeDiffBuilderAgent({ traceId: trace_id });
  const reflection = makeReflectionAgent({ traceId: trace_id });

  const orchOutput = await orchestratorAgent.run({ intent, ref });
  await persistRun({
    store,
    output: orchOutput,
    tenant_id: intent.tenantId,
    workflow_id,
    step: "plan",
    input_hash: sha256({ intent, ref }),
  });
  await emit(store, {
    workflow_id,
    trace_id,
    step: "plan",
    agent_id: "orchestrator",
    type: "workflow.start",
    payload_hash: orchOutput.input_hash,
    level: "info",
  });

  const account = await resolveAccount(connector, ref.id);
  const campaigns = await connector.getCampaigns(account.account_id);
  const daily = await connector.getCampaignDailyMetrics(
    account.account_id,
    deriveWindow(),
  );
  const firstParty = await connector.getFirstPartyRevenue(
    account.account_id,
    deriveWindow(),
  );
  const _creativeDaily: CreativeDailyMetric[] = await connector
    .getCreativeDailyMetrics(account.account_id, deriveWindow())
    .catch(() => []);
  const metrics: NormalizedMetrics[] = normalizeMetrics(daily, firstParty, {
    scope: "campaign",
    window: deriveWindow(),
  });

  // EvidenceLedger resolver: every ref must point at a real row.
  // - campaign_daily metric: must exist in the loaded daily set with a
  //   matching account/campaign/date triple. The expected hash is
  //   sha256(row).
  // - campaign: must exist in the loaded campaigns array. Hash is
  //   sha256(campaign).
  const dailyByRefKey = new Map<string, CampaignDailyMetric>();
  for (const row of daily) {
    dailyByRefKey.set(
      `${row.account_id}|${row.campaign_id}|${row.date}`,
      row,
    );
  }
  const campaignsByKey = new Map<string, Campaign>();
  for (const c of campaigns) {
    campaignsByKey.set(`${c.account_id}|${c.campaign_id}`, c);
  }
  const evidenceResolver: EvidenceResolver = createEvidenceResolver({
    campaignDailyMetric: ({ account_id, campaign_id, date }) => {
      const row = dailyByRefKey.get(`${account_id}|${campaign_id}|${date}`);
      return row ? { exists: true, hash: sha256(row) } : null;
    },
    campaign: ({ account_id, campaign_id }) => {
      const c = campaignsByKey.get(`${account_id}|${campaign_id}`);
      return c ? { exists: true, hash: sha256(c) } : null;
    },
  });
  const evidenceLedger = makeEvidenceLedgerAgent({
    traceId: trace_id,
    resolver: evidenceResolver,
  });

  const { output: maOutput, audit, packets } = await mediaAnalyst.analyse({
    account,
    campaigns,
    metrics,
    daily,
    firstParty,
    window: deriveWindow(),
    goal: intent.goal,
    tenantId: intent.tenantId,
  });
  await persistRun({
    store,
    output: maOutput,
    tenant_id: intent.tenantId,
    workflow_id,
    step: "plan",
    input_hash: maOutput.input_hash,
  });
  await store.put("audit_reports", audit.report_id, audit);
  await emit(store, {
    workflow_id,
    trace_id,
    step: "plan",
    agent_id: "media-analyst",
    type: "audit.completed",
    payload_hash: maOutput.input_hash,
    level: "info",
  });

  const blocked: { action_id: string; reason: string }[] = [];
  const decisions: PolicyDecision[] = [];
  const diffs: ExecutionDiff[] = [];
  const acceptedPackets: H0Packet[] = [];

  for (const draftPacket of packets) {
    // ---------- EvidenceLedger gate (mandatory) ----------
    const { output: elOutput, ok, missing } = await evidenceLedger.verify({
      subject: draftPacket,
    });
    await persistRun({
      store,
      output: elOutput,
      tenant_id: intent.tenantId,
      workflow_id,
      step: "plan",
      input_hash: elOutput.input_hash,
      status: ok ? "completed" : "blocked",
      blocked_reason: ok ? null : `evidence_missing:${missing.join(",")}`,
    });
    await emit(store, {
      workflow_id,
      trace_id,
      step: "plan",
      agent_id: "evidence-ledger",
      type: ok ? "evidence.ok" : "evidence.blocked",
      payload_hash: elOutput.input_hash,
      level: ok ? "info" : "warn",
    });
    if (!ok) {
      blocked.push({
        action_id: draftPacket.packet_id,
        reason: `evidence_ledger_failed: ${missing.join(", ")}`,
      });
      continue;
    }

    // ---------- MeasurementScientist (causal caveats) ----------
    const entityMetrics = metrics.find(
      (m) => m.entity_id === (draftPacket.proposal.target_entity_id ?? ""),
    );
    const reviewArgs: Parameters<typeof measurementScientist.review>[0] = {
      packet: draftPacket,
    };
    if (entityMetrics !== undefined) {
      reviewArgs.metricsForEntity = entityMetrics;
    }
    const { output: msOutput, packet: annotatedPacket } = await measurementScientist.review(
      reviewArgs,
    );
    await persistRun({
      store,
      output: msOutput,
      tenant_id: intent.tenantId,
      workflow_id,
      step: "measure",
      input_hash: msOutput.input_hash,
    });
    await emit(store, {
      workflow_id,
      trace_id,
      step: "measure",
      agent_id: "measurement-scientist",
      type: "measurement.caveats",
      payload_hash: msOutput.input_hash,
      level: "info",
    });

    // ---------- PlatformAdapter (action proposal) ----------
    const { output: paOutput, action } = await platformAdapter.translate({
      packet: annotatedPacket,
    });
    await persistRun({
      store,
      output: paOutput,
      tenant_id: intent.tenantId,
      workflow_id,
      step: "activate",
      input_hash: paOutput.input_hash,
    });
    await store.put("proposed_actions", action.action_id, action);

    // ---------- PolicyGuard gate (mandatory) ----------
    const campaign = campaigns.find((c) => c.campaign_id === action.target_entity_id);
    const decision_input: Parameters<typeof policyGuard.evaluate>[0] = {
      action,
      context: {
        guardrails: annotatedPacket.guardrails,
      },
    };
    if (campaign) decision_input.context.campaign = campaign;
    if (entityMetrics) decision_input.context.metrics = entityMetrics;
    const { output: pgOutput, decision } = await policyGuard.evaluate(decision_input);
    decisions.push(decision);
    await store.put("policy_decisions", decision.decision_id, decision);
    await persistRun({
      store,
      output: pgOutput,
      tenant_id: intent.tenantId,
      workflow_id,
      step: "activate",
      input_hash: pgOutput.input_hash,
      status: decision.result === "block" ? "blocked" : "completed",
      blocked_reason: decision.result === "block" ? decision.reasons.join("; ") : null,
    });
    await emit(store, {
      workflow_id,
      trace_id,
      step: "activate",
      agent_id: "policy-guard",
      type: `policy.${decision.result}`,
      payload_hash: pgOutput.input_hash,
      level: decision.result === "block" ? "warn" : "info",
    });

    // ---------- ApprovalCoordinator (routing) ----------
    const { output: acOutput, approval } = await approvalCoordinator.coordinate({
      packet: annotatedPacket,
      decision,
    });
    await persistRun({
      store,
      output: acOutput,
      tenant_id: intent.tenantId,
      workflow_id,
      step: "activate",
      input_hash: acOutput.input_hash,
    });
    const packetWithApproval: H0Packet = { ...annotatedPacket, approval };

    if (decision.result === "block") {
      blocked.push({
        action_id: action.action_id,
        reason: `policy_blocked: ${decision.reasons.join("; ")}`,
      });
      await store.put("h0_packets", packetWithApproval.packet_id, packetWithApproval);
      acceptedPackets.push(packetWithApproval);
      continue;
    }

    // ARCHITECTURE-DEEP §7: an H0 packet must reach `approved` before an
    // `ExecutionDiff` is built. PolicyGuard's `needs_approval` is the
    // documented "human must sign" gate — we MUST stop here and wait for
    // a real ApprovalReceipt. `runActivation()` (below) re-evaluates
    // policy with the receipt in hand and builds the diff.
    if (decision.result === "needs_approval") {
      await store.put("h0_packets", packetWithApproval.packet_id, packetWithApproval);
      acceptedPackets.push(packetWithApproval);
      await emit(store, {
        workflow_id,
        trace_id,
        step: "activate",
        agent_id: "approval-coordinator",
        type: "approval.pending",
        payload_hash: acOutput.input_hash,
        level: "info",
      });
      continue;
    }

    // ---------- DiffBuilder (dry-run diff) ----------
    const buildArgs: Parameters<typeof diffBuilder.build>[0] = {
      action,
      packet: packetWithApproval,
    };
    if (campaign) buildArgs.campaign = campaign;
    const { output: dbOutput, diff } = await diffBuilder.build(buildArgs);
    diffs.push(diff);
    await store.put("execution_diffs", diff.diff_id, diff);
    await persistRun({
      store,
      output: dbOutput,
      tenant_id: intent.tenantId,
      workflow_id,
      step: "activate",
      input_hash: dbOutput.input_hash,
    });
    await emit(store, {
      workflow_id,
      trace_id,
      step: "activate",
      agent_id: "diff-builder",
      type: "diff.built",
      payload_hash: dbOutput.input_hash,
      level: "info",
    });
    await store.put("h0_packets", packetWithApproval.packet_id, packetWithApproval);
    acceptedPackets.push(packetWithApproval);
  }

  // ---------- Reflect ----------
  const outcomes = decisions.map((d) =>
    d.result === "block" ? ("blocked_unsafe" as const) : ("validated" as const),
  );
  const { output: refOutput, trust } = await reflection.reflect({
    subject_type: "agent",
    subject_id: "media-analyst",
    outcomes,
    policyDecisions: decisions,
  });
  await store.put(
    "trust_scores",
    `agent_${trust.subject_id.replace(/[^a-zA-Z0-9_.-]/g, "_")}`,
    trust,
  );
  await persistRun({
    store,
    output: refOutput,
    tenant_id: intent.tenantId,
    workflow_id,
    step: "reflect",
    input_hash: refOutput.input_hash,
  });
  await emit(store, {
    workflow_id,
    trace_id,
    step: "reflect",
    agent_id: "reflection",
    type: "trust.updated",
    payload_hash: refOutput.input_hash,
    level: "info",
  });

  const result: WorkflowResult = {
    workflow_id,
    trace_id,
    audit,
    packets: acceptedPackets,
    diffs,
    decisions,
    blocked,
  };
  return result;
}

async function persistRun(args: {
  store: Store;
  output: AgentOutput;
  tenant_id: string;
  workflow_id: string;
  step: WorkflowStep;
  input_hash: string;
  status?: "completed" | "blocked" | "error";
  blocked_reason?: string | null;
}): Promise<void> {
  const run = AgentRun.parse({
    run_id: newId("run"),
    agent_id: args.output.agent_id,
    agent_version: args.output.agent_version,
    tenant_id: args.tenant_id,
    workflow_id: args.workflow_id,
    step: args.step,
    input_hash: args.input_hash,
    policy_version: POLICY_VERSION,
    model: "none",
    tools_allowed: [],
    tools_called: [],
    source_refs: args.output.evidence_refs,
    output_hash: sha256(args.output),
    risk_level: "low",
    status: args.status ?? "completed",
    blocked_reason: args.blocked_reason ?? null,
    created_at: nowIso(),
  });
  await args.store.put("agent_runs", run.run_id, run);
}

/**
 * `@admatix/policy`'s `emitEvent` writes to `events/<workflow_id>`, but
 * `@admatix/core`'s `Store.append` already prefixes `events/` and rejects
 * any slash in the stream name. We adapt by stripping the leading
 * `events/` from the stream that `emitEvent` passes so the JSONL lands at
 * the documented `<rootDir>/events/<workflow_id>.jsonl` path either way.
 */
function eventStoreAdapter(store: Store): EventStore {
  return {
    async append(stream: string, record: unknown): Promise<void> {
      const normalised = stream.startsWith("events/")
        ? stream.slice("events/".length)
        : stream;
      await store.append(normalised, record);
    },
  };
}

async function emit(
  store: Store,
  args: {
    workflow_id: string;
    trace_id: string;
    step: WorkflowStep;
    agent_id: string;
    type: string;
    payload_hash: string;
    level: "info" | "warn" | "error";
  },
): Promise<void> {
  await emitEvent(eventStoreAdapter(store), {
    ts: nowIso(),
    trace_id: args.trace_id,
    workflow_id: args.workflow_id,
    step: args.step,
    agent_id: args.agent_id,
    type: args.type,
    payload_hash: args.payload_hash,
    level: args.level,
  });
}

async function resolveAccount(
  connector: Connector,
  accountId: string,
): Promise<PlatformAccount> {
  const accounts = await connector.listAccounts();
  const found = accounts.find((a) => a.account_id === accountId);
  if (found) return found;
  // QA finding #24: fail closed on miss. The previous "first account"
  // fallback made mistakes look like successes (a caller asking for an
  // unknown account would silently get the demo one).
  throw new Error(
    `runWorkflow: account "${accountId}" not found in connector ${connector.platform} ` +
      `(available: ${accounts.map((a) => a.account_id).join(", ") || "<none>"}).`,
  );
}

function deriveWindow(): string {
  return "2026-05-12..2026-05-21";
}

/**
 * Activate a packet that has been approved by a human (`runWorkflow` left
 * it in `pending`/`needs_approval`). Re-evaluates PolicyGuard with the
 * receipt in hand and builds the dry-run diff.
 *
 * Fail-closed on every branch:
 *   - receipt must approve THIS packet and have a verified HMAC
 *   - PolicyGuard `block` → no diff
 *   - PolicyGuard `needs_approval` → only honoured with a verified receipt
 */
export async function runActivation(
  args: {
    packet_id: string;
    tenant_id: string;
    receipt: import("@admatix/schemas").ApprovalReceipt;
  },
  deps: WorkflowDeps,
): Promise<
  | { ok: true; diff: ExecutionDiff; decision: PolicyDecision }
  | { ok: false; reason: string }
> {
  const { store } = deps;
  const connector = deps.connector ?? fixtureConnector();
  const stored = await store.get<H0Packet>("h0_packets", args.packet_id);
  if (!stored) return { ok: false, reason: "packet_not_found" };
  const packet = stored;
  if (packet.tenant_id !== args.tenant_id) {
    return { ok: false, reason: "forbidden_tenant" };
  }
  if (
    args.receipt.packet_id !== packet.packet_id ||
    args.receipt.decision !== "approved"
  ) {
    return { ok: false, reason: "receipt_must_approve_packet" };
  }
  // Lazy import so we don't hoist a heavy dep at module load.
  const { verifyApprovalReceipt, evaluateAction } = await import("@admatix/policy");
  const check = verifyApprovalReceipt(args.receipt);
  if (!check.ok) {
    return { ok: false, reason: `signature_invalid:${check.reason}` };
  }
  const traceId = packet.trace_id;
  const adapter = makePlatformAdapterAgent({ traceId });
  const { action } = await adapter.translate({ packet });
  const accounts = await connector.listAccounts();
  const campaigns = (
    await Promise.all(accounts.map((a) => connector.getCampaigns(a.account_id)))
  ).flat();
  const campaign = campaigns.find(
    (c) => c.campaign_id === action.target_entity_id,
  );
  const decision = evaluateAction(action, {
    guardrails: packet.guardrails,
    ...(campaign ? { campaign } : {}),
  });
  if (decision.result === "block") {
    return { ok: false, reason: `policy_block:${decision.reasons.join("; ")}` };
  }
  // `needs_approval` is OK here — we hold a verified receipt.
  const builder = makeDiffBuilderAgent({ traceId });
  const { diff } = await builder.build({ action, packet, campaign });
  await store.put("execution_diffs", diff.diff_id, diff);
  await store.put("policy_decisions", decision.decision_id, decision);
  return { ok: true, diff, decision };
}

// Re-export helpers used by tests / callers that want to compose pieces.
export type {
  Campaign,
  CampaignDailyMetric,
  FirstPartyRevenueDaily,
  H0Packet,
  AuditReport,
  DetectorInput,
};
