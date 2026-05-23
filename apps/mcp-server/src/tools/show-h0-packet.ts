import type { ToolResultEnvelope } from "../server.js";

export interface ShowH0PacketInput {
  packet_id: string;
}

export async function showH0PacketTool(
  _input: ShowH0PacketInput,
): Promise<ToolResultEnvelope> {
  throw new Error("showH0PacketTool: interface stub");
}
