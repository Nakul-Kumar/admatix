import type { ToolResultEnvelope } from "../server.js";

export interface CreatePlanInput {
  account_ref: string;
  goal: string;
  tenant_id: string;
}

export async function createPlanTool(
  _input: CreatePlanInput,
): Promise<ToolResultEnvelope> {
  throw new Error("createPlanTool: interface stub");
}
