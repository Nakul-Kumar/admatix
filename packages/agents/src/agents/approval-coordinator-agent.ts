import {
  AgentOutput,
  type Approval,
  type H0Packet,
  type PolicyDecision,
} from "@admatix/schemas";
import { sha256 } from "@admatix/core";
import type { Agent } from "../agent.js";

export interface ApprovalCoordinatorInput {
  packet: H0Packet;
  decision: PolicyDecision;
}

export interface ApprovalCoordinatorResult {
  output: AgentOutput;
  approval: Approval;
}

/**
 * Manages the approval state attached to an H0 packet. The MVP never
 * auto-approves — anything that touches spend stays in `pending`. Anything
 * blocked is marked `rejected` so the cockpit can render it correctly.
 */
export function makeApprovalCoordinatorAgent(opts: { traceId: string }): {
  agent: Agent;
  coordinate(input: ApprovalCoordinatorInput): Promise<ApprovalCoordinatorResult>;
} {
  const coordinate = async (
    input: ApprovalCoordinatorInput,
  ): Promise<ApprovalCoordinatorResult> => {
    const required_role = input.packet.guardrails.requires_human_approval
      ? "approver"
      : "system";
    let status: Approval["status"];
    if (input.decision.result === "block") {
      status = "rejected";
    } else if (input.decision.result === "allow") {
      status = required_role === "approver" ? "pending" : "not_required";
    } else {
      status = "pending";
    }
    const approval: Approval = {
      status,
      required_role,
    };
    const input_hash = sha256({
      packet_id: input.packet.packet_id,
      decision_id: input.decision.decision_id,
    });
    const output = AgentOutput.parse({
      agent_id: "approval-coordinator",
      agent_version: "0.1.0",
      input_hash,
      output_type: "approval.routed",
      confidence: 1,
      evidence_refs: [`packet:${input.packet.packet_id}`],
      proposed_actions: [],
      blocked_actions: [],
      warnings: status === "rejected" ? input.decision.reasons : [],
      trace_id: opts.traceId,
    });
    return { output, approval };
  };
  const agent: Agent = {
    id: "approval-coordinator",
    version: "0.1.0",
    async run(input: unknown): Promise<AgentOutput> {
      const ac = input as ApprovalCoordinatorInput;
      const { output } = await coordinate(ac);
      return output;
    },
  };
  return { agent, coordinate };
}
