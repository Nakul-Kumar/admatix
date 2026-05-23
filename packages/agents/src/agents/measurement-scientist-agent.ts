import { AgentOutput, type H0Packet, type NormalizedMetrics } from "@admatix/schemas";
import { sha256 } from "@admatix/core";
import type { Agent } from "../agent.js";

export interface MeasurementScientistInput {
  packet: H0Packet;
  metricsForEntity?: NormalizedMetrics;
}

export interface MeasurementScientistResult {
  output: AgentOutput;
  packet: H0Packet;
  caveats: string[];
}

/**
 * Adds causal caveats. MeasurementScientist never *approves* a packet — it
 * may only annotate causal_status and append caveats. The strongest claim
 * it can make in the MVP is `directional_until_lift_test`; nothing in the
 * MVP path produces `experimental` or `causal` without a future lift study.
 *
 * Enforced rule: the agent reads but never mutates evidence; rollback is
 * left untouched. This is the "measurement agents cannot approve their own
 * packets" invariant from `ARCHITECTURE-DEEP.md` §6.
 */
export function makeMeasurementScientistAgent(opts: { traceId: string }): {
  agent: Agent;
  review(input: MeasurementScientistInput): Promise<MeasurementScientistResult>;
} {
  const review = async (
    input: MeasurementScientistInput,
  ): Promise<MeasurementScientistResult> => {
    const caveats: string[] = [];
    const sampleSize = input.metricsForEntity?.conversions ?? 0;
    if (sampleSize < 30) {
      caveats.push(
        `low_conversion_volume:${sampleSize} — effect estimate is directional only`,
      );
    }
    if (input.packet.causal_status !== "directional_until_lift_test") {
      caveats.push(
        `downgraded_causal_status:${input.packet.causal_status} → directional_until_lift_test (no MVP lift test wired)`,
      );
    }
    const annotatedPacket: H0Packet = {
      ...input.packet,
      causal_status: "directional_until_lift_test",
    };
    const input_hash = sha256({
      packet_id: input.packet.packet_id,
      conversions: sampleSize,
    });
    const output = AgentOutput.parse({
      agent_id: "measurement-scientist",
      agent_version: "0.1.0",
      input_hash,
      output_type: "measurement.caveats",
      confidence: 0.7,
      evidence_refs: [`packet:${input.packet.packet_id}`],
      proposed_actions: [],
      blocked_actions: [],
      warnings: caveats,
      trace_id: opts.traceId,
    });
    return { output, packet: annotatedPacket, caveats };
  };
  const agent: Agent = {
    id: "measurement-scientist",
    version: "0.1.0",
    async run(input: unknown): Promise<AgentOutput> {
      const ms = input as MeasurementScientistInput;
      const { output } = await review(ms);
      return output;
    },
  };
  return { agent, review };
}
