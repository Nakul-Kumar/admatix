import type { ToolResultEnvelope } from "../server.js";

export interface AuditAccountInput {
  account_ref: string;
  window?: string;
}

export async function auditAccountTool(
  _input: AuditAccountInput,
): Promise<ToolResultEnvelope> {
  throw new Error("auditAccountTool: interface stub");
}
