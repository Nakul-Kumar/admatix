import {
  AgentOutput,
  ProposedAction,
  type H0Packet,
  type RiskLevel,
} from "@admatix/schemas";
import { newId, sha256 } from "@admatix/core";
import type { Agent } from "../agent.js";

export interface PlatformAdapterInput {
  packet: H0Packet;
}

export interface PlatformAdapterResult {
  output: AgentOutput;
  action: ProposedAction;
}

/**
 * Translates an approved H0 packet into a `ProposedAction`. Cannot invent
 * actions — the action type and params are read straight from the packet's
 * `proposal`. The schema literal `dry_run_only: true` is enforced here so
 * the type system itself blocks live writes.
 *
 * Risk level is derived from the action type, not from the agent's
 * judgement: budget-touching = high, status-touching = medium, anything
 * else = low. The PolicyGuard then has the final say.
 */
export function makePlatformAdapterAgent(opts: { traceId: string }): {
  agent: Agent;
  translate(input: PlatformAdapterInput): Promise<PlatformAdapterResult>;
} {
  const translate = async (input: PlatformAdapterInput): Promise<PlatformAdapterResult> => {
    const { packet } = input;
    const action: ProposedAction = ProposedAction.parse({
      action_id: newId("act"),
      packet_id: packet.packet_id,
      type: packet.proposal.action,
      target_entity_id:
        packet.proposal.target_entity_id ?? packet.packet_id,
      params: packet.proposal.params,
      risk_level: deriveRisk(packet.proposal.action),
      dry_run_only: true,
    });
    const input_hash = sha256({
      packet_id: packet.packet_id,
      proposal: packet.proposal,
    });
    const output = AgentOutput.parse({
      agent_id: "platform-adapter",
      agent_version: "0.1.0",
      input_hash,
      output_type: "action.proposed",
      confidence: 1,
      evidence_refs: [`packet:${packet.packet_id}`],
      proposed_actions: [action.action_id],
      blocked_actions: [],
      warnings: [],
      trace_id: opts.traceId,
    });
    return { output, action };
  };
  const agent: Agent = {
    id: "platform-adapter",
    version: "0.1.0",
    async run(input: unknown): Promise<AgentOutput> {
      const pa = input as PlatformAdapterInput;
      const { output } = await translate(pa);
      return output;
    },
  };
  return { agent, translate };
}

function deriveRisk(action: string): RiskLevel {
  switch (action) {
    case "budget_shift":
    case "bid_adjust":
      return "high";
    case "pause_entity":
    case "resume_entity":
    case "creative_rotate":
      return "medium";
    default:
      return "low";
  }
}
