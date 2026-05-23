/**
 * @admatix/agents — the 9 MVP agents and the Plan→Activate→Measure→Reflect
 * orchestrator. The runtime is a deterministic rules engine; no LLM call is
 * required to build or demo. The `Agent` interface is LLM-ready so the
 * reasoning layer can be swapped in later behind the same contract.
 *
 * Public surface fixed in `docs/architecture/ARCHITECTURE-DEEP.md` §3.
 */
import type { Agent } from "./agent.js";
import { makeOrchestratorAgent } from "./agents/orchestrator-agent.js";
import { makePolicyGuardAgent } from "./agents/policy-guard-agent.js";
import { makeEvidenceLedgerAgent } from "./agents/evidence-ledger-agent.js";
import { makeApprovalCoordinatorAgent } from "./agents/approval-coordinator-agent.js";
import { makeMediaAnalystAgent } from "./agents/media-analyst-agent.js";
import { makeMeasurementScientistAgent } from "./agents/measurement-scientist-agent.js";
import { makePlatformAdapterAgent } from "./agents/platform-adapter-agent.js";
import { makeDiffBuilderAgent } from "./agents/diff-builder-agent.js";
import { makeReflectionAgent } from "./agents/reflection-agent.js";

export type { Agent } from "./agent.js";
export type {
  WorkflowDeps,
} from "./orchestrator.js";
export type { WorkflowIntent, WorkflowResult } from "./types.js";
export { runWorkflow, runActivation } from "./orchestrator.js";

export { makeOrchestratorAgent } from "./agents/orchestrator-agent.js";
export { makePolicyGuardAgent } from "./agents/policy-guard-agent.js";
export { makeEvidenceLedgerAgent } from "./agents/evidence-ledger-agent.js";
export { makeApprovalCoordinatorAgent } from "./agents/approval-coordinator-agent.js";
export { makeMediaAnalystAgent } from "./agents/media-analyst-agent.js";
export { makeMeasurementScientistAgent } from "./agents/measurement-scientist-agent.js";
export { makePlatformAdapterAgent } from "./agents/platform-adapter-agent.js";
export { makeDiffBuilderAgent } from "./agents/diff-builder-agent.js";
export { makeReflectionAgent } from "./agents/reflection-agent.js";

export type { MediaAnalystDeps, MediaAnalystInput, MediaAnalystResult } from "./agents/media-analyst-agent.js";
export type { PolicyGuardInput, PolicyGuardResult } from "./agents/policy-guard-agent.js";
export type { EvidenceLedgerInput, EvidenceLedgerResult } from "./agents/evidence-ledger-agent.js";
export type { ApprovalCoordinatorInput, ApprovalCoordinatorResult } from "./agents/approval-coordinator-agent.js";
export type { MeasurementScientistInput, MeasurementScientistResult } from "./agents/measurement-scientist-agent.js";
export type { PlatformAdapterInput, PlatformAdapterResult } from "./agents/platform-adapter-agent.js";
export type { DiffBuilderInput, DiffBuilderResult } from "./agents/diff-builder-agent.js";
export type { ReflectionInput, ReflectionResult, Outcome } from "./agents/reflection-agent.js";

/**
 * The 9 MVP agents indexed by `agent_id`, constructed against a shared
 * `trace_id`. Callers that just need the uniform `Agent` interface (the
 * MCP server, the eval harness) read from this map; the orchestrator uses
 * the typed factory functions above.
 */
export function buildAgents(traceId: string): Record<string, Agent> {
  return {
    orchestrator: makeOrchestratorAgent({ traceId }),
    "policy-guard": makePolicyGuardAgent({ traceId }).agent,
    "evidence-ledger": makeEvidenceLedgerAgent({ traceId }).agent,
    "approval-coordinator": makeApprovalCoordinatorAgent({ traceId }).agent,
    "media-analyst": makeMediaAnalystAgent({ traceId }).agent,
    "measurement-scientist": makeMeasurementScientistAgent({ traceId }).agent,
    "platform-adapter": makePlatformAdapterAgent({ traceId }).agent,
    "diff-builder": makeDiffBuilderAgent({ traceId }).agent,
    reflection: makeReflectionAgent({ traceId }).agent,
  };
}

/** Stable id list of every MVP agent — useful for benchmark coverage. */
export const AGENT_IDS = [
  "orchestrator",
  "policy-guard",
  "evidence-ledger",
  "approval-coordinator",
  "media-analyst",
  "measurement-scientist",
  "platform-adapter",
  "diff-builder",
  "reflection",
] as const;
