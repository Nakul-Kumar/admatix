import { H0Packet, z } from "@admatix/schemas";
import { runWorkflow } from "@admatix/agents";
import {
  okEnvelope,
  refsFromPackets,
  traceFor,
  type ToolContext,
  type ToolResultEnvelope,
} from "./common.js";

export const CreatePlanInput = z.object({
  account_ref: z.string(),
  goal: z.string(),
  tenant_id: z.string(),
}).strict();
export type CreatePlanInput = z.infer<typeof CreatePlanInput>;

export async function createPlanTool(
  input: CreatePlanInput,
  ctx: ToolContext,
): Promise<ToolResultEnvelope<{
  workflow_id: string;
  packets: z.infer<typeof H0Packet>[];
  blocked: { action_id: string; reason: string }[];
}>> {
  const parsed = CreatePlanInput.parse(input);
  const result = await runWorkflow(
    {
      accountRef: parsed.account_ref,
      goal: parsed.goal,
      tenantId: parsed.tenant_id,
    },
    { store: ctx.store, connector: ctx.connector },
  );
  const packets = z.array(H0Packet).parse(result.packets);
  return okEnvelope({
    trace_id: result.trace_id,
    source_refs: refsFromPackets(packets),
    risk_level: result.blocked.length > 0 ? "medium" : "low",
    data: {
      workflow_id: result.workflow_id,
      packets,
      blocked: result.blocked,
    },
  });
}
