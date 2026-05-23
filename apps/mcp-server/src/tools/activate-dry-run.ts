import type { ApprovalReceipt } from "@admatix/schemas";
import type { ToolResultEnvelope } from "../server.js";

export interface ActivateDryRunInput {
  packet_id: string;
  approval_receipt?: ApprovalReceipt;
}

export async function activateDryRunTool(
  _input: ActivateDryRunInput,
): Promise<ToolResultEnvelope> {
  throw new Error("activateDryRunTool: interface stub");
}
