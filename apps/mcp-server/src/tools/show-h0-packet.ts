import { H0Packet, z } from "@admatix/schemas";
import {
  getPacketOrThrow,
  okEnvelope,
  refsFromEvidence,
  traceFor,
  type ToolContext,
  type ToolResultEnvelope,
} from "./common.js";

export const ShowH0PacketInput = z.object({
  packet_id: z.string(),
}).strict();
export type ShowH0PacketInput = z.infer<typeof ShowH0PacketInput>;

export async function showH0PacketTool(
  input: ShowH0PacketInput,
  ctx: ToolContext,
): Promise<ToolResultEnvelope<z.infer<typeof H0Packet>>> {
  const parsed = ShowH0PacketInput.parse(input);
  const packet = await getPacketOrThrow(ctx.store, parsed.packet_id);
  return okEnvelope({
    trace_id: packet.trace_id || traceFor("show_h0_packet", parsed),
    source_refs: refsFromEvidence(packet.evidence),
    risk_level: "low",
    data: packet,
  });
}
