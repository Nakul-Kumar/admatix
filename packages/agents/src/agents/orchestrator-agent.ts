import { AgentOutput } from "@admatix/schemas";
import { sha256 } from "@admatix/core";
import type { Agent } from "../agent.js";

/**
 * Routes the Plan → Activate → Measure → Reflect loop. The orchestrator
 * agent never proposes actions and never executes anything — it only fans
 * out work to the specialists and aggregates their outputs. The real
 * routing happens in `runWorkflow`; this agent records that a routing step
 * occurred so the agent_runs ledger has a control-plane trace.
 */
export function makeOrchestratorAgent(opts: { traceId: string }): Agent {
  return {
    id: "orchestrator",
    version: "0.1.0",
    async run(input: unknown): Promise<AgentOutput> {
      const input_hash = sha256(input ?? null);
      return AgentOutput.parse({
        agent_id: "orchestrator",
        agent_version: "0.1.0",
        input_hash,
        output_type: "workflow.route",
        confidence: 1,
        evidence_refs: [],
        proposed_actions: [],
        blocked_actions: [],
        warnings: [],
        trace_id: opts.traceId,
      });
    },
  };
}
