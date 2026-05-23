import {
  AgentRun,
  OutcomeMeasurement,
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
import { emitEvent, type EventStore } from "@admatix/policy";
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
import type { VerifierClient, VerifyResponsePayload } from "./verifier-client.js";
import { makePlatformAdapterAgent } from "./agents/platform-adapter-agent.js";
import { makeDiffBuilderAgent } from "./agents/diff-builder-agent.js";
import { makeReflectionAgent } from "./agents/reflection-agent.js";
import type { WorkflowIntent, WorkflowResult } from "./types.js";

const POLICY_VERSION = "v1";

/**
 * Shape of the value returned by `WorkflowDeps.postPeriodDataUriFor` —
 * a URI plus optional metadata/action-log URIs and a verifier hint. Used
 * by the Phase 3 E2E test to point at a simulator world without forcing a
 * connector dep.
 */
export interface PostPeriodDataUri {
  data_uri: string;
  metadata_uri?: string;
  action_log_uri?: string;
  hint?: { design?: string };
}

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
  /**
   * When supplied, MeasurementScientist calls the verifier, the response is
   * persisted into the `outcome_measurements` collection, and an
   * `AdmatixEvent` of type `measurement.verified` is appended with the
   * payload hash. Phase 3 wiring; absent on Phase 1 demos so they keep
   * running unchanged.
   */
  verifierClient?: VerifierClient;
  /**
   * When supplied, the orchestrator passes this URI as the verifier's
   * `data_uri` for each H0 packet. Returning `null` (or no callback) skips
   * the verifier call for that packet — used by the Phase 3 E2E test to
   * point at a simulator world without forcing a connector dep.
   */
  postPeriodDataUriFor?: (packet: H0Packet) => PostPeriodDataUri | null;
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
  const evidenceLedger = makeEvidenceLedgerAgent({ traceId: trace_id });
  const measurementScientist = makeMeasurementScientistAgent({
    traceId: trace_id,
    ...(deps.verifierClient !== undefined
      ? { deps: { verifierClient: deps.verifierClient } }
      : {}),
  });
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
  const verifierVerdicts: VerifyResponsePayload["verdict"][] = [];

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

    // ---------- MeasurementScientist (causal caveats + optional verifier) ----------
    const entityMetrics = metrics.find(
      (m) => m.entity_id === (draftPacket.proposal.target_entity_id ?? ""),
    );
    const reviewArgs: Parameters<typeof measurementScientist.review>[0] = {
      packet: draftPacket,
    };
    if (entityMetrics !== undefined) {
      reviewArgs.metricsForEntity = entityMetrics;
    }
    const verifyUri = deps.verifierClient && deps.postPeriodDataUriFor
      ? deps.postPeriodDataUriFor(draftPacket)
      : null;
    if (deps.verifierClient && verifyUri) {
      reviewArgs.verifyInput = {
        data_uri: verifyUri.data_uri,
        ...(verifyUri.metadata_uri !== undefined
          ? { metadata_uri: verifyUri.metadata_uri }
          : {}),
        ...(verifyUri.action_log_uri !== undefined
          ? { action_log_uri: verifyUri.action_log_uri }
          : {}),
        ...(verifyUri.hint !== undefined ? { hint: verifyUri.hint } : {}),
      };
    }
    const {
      output: msOutput,
      packet: annotatedPacket,
      verification,
    } = await measurementScientist.review(reviewArgs);
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

    // ---------- Verifier outcome persistence + emit ----------
    // Per WP-S §Acceptance 8 the event order is
    //   evidence.ok → policy.allow → diff.built → measurement.verified
    // so the verifier's persistence + emit live at the bottom of the
    // packet loop (after diff.built), even though the call itself
    // happened during MeasurementScientist.review above.
    if (verification) {
      const measurement = buildOutcomeMeasurement(
        packetWithApproval,
        verification,
      );
      await store.put(
        "outcome_measurements",
        measurement.measurement_id,
        measurement,
      );
      const payload_hash = sha256(canonicalVerifierPayload(verification));
      await emit(store, {
        workflow_id,
        trace_id,
        step: "measure",
        agent_id: "measurement-scientist",
        type: "measurement.verified",
        payload_hash,
        level: "info",
      });
      verifierVerdicts.push(verification.verdict);
    }
  }

  // ---------- Reflect ----------
  // Default (pre-WP-S): one optimistic `validated` per allowed policy
  // decision; `blocked_unsafe` per blocked one.
  // WP-S extension: when the verifier weighed in on at least one packet,
  // its verdicts (`lift_detected → "validated"`, `no_effect →
  // "invalidated"`, `inconclusive →` no-op) replace the optimistic
  // "validated" outcomes; `blocked_unsafe` is always kept.
  const outcomes: ("validated" | "invalidated" | "blocked_unsafe")[] = [];
  for (const d of decisions) {
    if (d.result === "block") outcomes.push("blocked_unsafe");
  }
  if (verifierVerdicts.length === 0) {
    for (const d of decisions) {
      if (d.result !== "block") outcomes.push("validated");
    }
  } else {
    for (const v of verifierVerdicts) {
      if (v === "lift_detected") outcomes.push("validated");
      else if (v === "no_effect") outcomes.push("invalidated");
      // inconclusive → no-op (no trust update)
    }
  }
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
  if (accounts.length > 0) {
    const first = accounts[0];
    if (first) return first;
  }
  throw new Error(
    `runWorkflow: could not resolve account "${accountId}" from connector ${connector.platform}`,
  );
}

function deriveWindow(): string {
  return "2026-05-12..2026-05-21";
}

/**
 * Map a verifier response onto the frozen `OutcomeMeasurement` schema.
 * The schema fields are reused — not extended — per WP-S §"Files this WP
 * MUST NOT touch":
 *
 *   verifier.estimate         → observed_value (and delta_pct as a copy)
 *   [ci_low, ci_high]         → confidence_interval (only set when both
 *                                are numeric; guardrail_only paths omit it)
 *   verifier.method           → notes["method:<name>"]
 *   verifier.verdict          → notes["verdict:<name>"] and passed
 *   verifier.causal_status    → notes["causal_status:<name>"]
 *   verifier.confounders[]    → notes["confounder:<name>"]
 *   verifier.tx_id            → notes["tx_id:<tx_id>"] (trace correlation)
 *
 * The five required-for-round-trip fields (estimate, ci_low, ci_high,
 * method, verdict) are recoverable from the persisted row by reading
 * `observed_value`, `confidence_interval`, and the `method:` / `verdict:`
 * note prefixes.
 */
function buildOutcomeMeasurement(
  packet: H0Packet,
  verification: VerifyResponsePayload,
): OutcomeMeasurement {
  const notes: string[] = [
    `method:${verification.method}`,
    `verdict:${verification.verdict}`,
    `causal_status:${verification.causal_status}`,
    `tx_id:${verification.tx_id}`,
    `ci_level:${verification.ci_level}`,
  ];
  for (const c of verification.confounders) notes.push(`confounder:${c}`);
  const measurement: Record<string, unknown> = {
    measurement_id: `om_${sha256({
      packet_id: packet.packet_id,
      tx_id: verification.tx_id,
      method: verification.method,
    }).slice(0, 16)}`,
    packet_id: packet.packet_id,
    success_metric: packet.success_metric,
    baseline_value: null,
    observed_value: verification.estimate,
    delta_pct: verification.estimate,
    passed: verification.verdict === "lift_detected",
    notes,
    evidence: [
      {
        source: "verifier",
        ref: `verify:${verification.tx_id}`,
        hash: sha256(canonicalVerifierPayload(verification)),
      },
    ],
    measured_at: nowIso(),
  };
  if (
    typeof verification.ci_low === "number" &&
    typeof verification.ci_high === "number"
  ) {
    measurement["confidence_interval"] = [
      verification.ci_low,
      verification.ci_high,
    ];
  }
  return OutcomeMeasurement.parse(measurement);
}

/**
 * Canonicalised verifier payload used for the event-stream `payload_hash`
 * and the persisted-evidence hash. Sorted keys via the same JSON form the
 * Postgres ledger trigger expects when WP-M's Supabase store is wired in,
 * so a hash computed here equals the one a future trigger will compute
 * server-side.
 */
function canonicalVerifierPayload(v: VerifyResponsePayload): unknown {
  return {
    causal_status: v.causal_status,
    ci_high: v.ci_high,
    ci_level: v.ci_level,
    ci_low: v.ci_low,
    confounders: [...v.confounders],
    estimate: v.estimate,
    method: v.method,
    packet_id: v.packet_id,
    tx_id: v.tx_id,
    verdict: v.verdict,
  };
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
