import { AgentOutput, type PolicyDecision, type ProposedAction } from "@admatix/schemas";
import { sha256 } from "@admatix/core";
import { evaluateAction, type PolicyContext } from "@admatix/policy";
import type { Agent } from "../agent.js";

export interface PolicyGuardInput {
  action: ProposedAction;
  context: PolicyContext;
}

export interface PolicyGuardResult {
  output: AgentOutput;
  decision: PolicyDecision;
}

/**
 * Mandatory gate #1. Wraps `evaluateAction` so the decision is materialised
 * as both a `PolicyDecision` (for the ledger) and an `AgentOutput` (for the
 * `agent_runs` audit trail). Blocked actions surface in `blocked_actions`.
 */
export function makePolicyGuardAgent(opts: { traceId: string }): {
  agent: Agent;
  evaluate(input: PolicyGuardInput): Promise<PolicyGuardResult>;
} {
  const evaluate = async (input: PolicyGuardInput): Promise<PolicyGuardResult> => {
    const decision = evaluateAction(input.action, input.context);
    const input_hash = sha256({
      action_id: input.action.action_id,
      action_type: input.action.type,
      params: input.action.params,
      guardrails: input.context.guardrails,
    });
    const output = AgentOutput.parse({
      agent_id: "policy-guard",
      agent_version: "0.1.0",
      input_hash,
      output_type: "policy.decision",
      confidence: 1,
      evidence_refs: [`policy:${decision.policy_version}`, `action:${input.action.action_id}`],
      proposed_actions: [],
      blocked_actions: decision.result === "block" ? [input.action.action_id] : [],
      warnings: decision.reasons,
      trace_id: opts.traceId,
    });
    return { output, decision };
  };
  const agent: Agent = {
    id: "policy-guard",
    version: "0.1.0",
    async run(input: unknown): Promise<AgentOutput> {
      const guard = input as PolicyGuardInput;
      const { output } = await evaluate(guard);
      return output;
    },
  };
  return { agent, evaluate };
}
