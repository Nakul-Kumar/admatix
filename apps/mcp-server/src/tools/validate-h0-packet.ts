import type { ToolResultEnvelope } from "../server.js";

export interface ValidateH0PacketInput {
  packet_id: string;
}

export async function validateH0PacketTool(
  _input: ValidateH0PacketInput,
): Promise<ToolResultEnvelope> {
  throw new Error("validateH0PacketTool: interface stub");
}
