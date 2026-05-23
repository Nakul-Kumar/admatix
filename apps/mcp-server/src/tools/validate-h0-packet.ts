import { H0Packet, z } from "@admatix/schemas";
import { verifyEvidence } from "@admatix/policy";
import {
  getPacketOrThrow,
  okEnvelope,
  refsFromEvidence,
  traceFor,
  type ToolContext,
  type ToolResultEnvelope,
} from "./common.js";

export const ValidateH0PacketInput = z.object({
  packet_id: z.string(),
}).strict();
export type ValidateH0PacketInput = z.infer<typeof ValidateH0PacketInput>;

export async function validateH0PacketTool(
  input: ValidateH0PacketInput,
  ctx: ToolContext,
): Promise<ToolResultEnvelope<{
  packet: z.infer<typeof H0Packet>;
  valid: boolean;
  missing: string[];
}>> {
  const parsed = ValidateH0PacketInput.parse(input);
  const packet = await getPacketOrThrow(ctx.store, parsed.packet_id);
  const verdict = verifyEvidence(packet);
  return okEnvelope({
    trace_id: packet.trace_id || traceFor("validate_h0_packet", parsed),
    source_refs: refsFromEvidence(packet.evidence),
    risk_level: verdict.ok ? "low" : "high",
    data: {
      packet,
      valid: verdict.ok,
      missing: verdict.missing,
    },
  });
}
