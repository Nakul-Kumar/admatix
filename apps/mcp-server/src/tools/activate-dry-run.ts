import { ApprovalReceipt, ExecutionDiff, z } from "@admatix/schemas";
import { makeDiffBuilderAgent, makePlatformAdapterAgent } from "@admatix/agents";
import {
  blockedEnvelope,
  getPacketOrThrow,
  okEnvelope,
  refsFromDiff,
  traceFor,
  type ToolContext,
  type ToolResultEnvelope,
} from "./common.js";

export const ActivateDryRunInput = z.object({
  packet_id: z.string(),
  approval_receipt: ApprovalReceipt.optional(),
}).strict();
export type ActivateDryRunInput = z.infer<typeof ActivateDryRunInput>;

export async function activateDryRunTool(
  input: ActivateDryRunInput,
  ctx: ToolContext,
): Promise<ToolResultEnvelope<z.infer<typeof ExecutionDiff> | {
  blocked: true;
  reason: string;
}>> {
  const parsed = ActivateDryRunInput.parse(input);
  const trace_id = traceFor("activate_dry_run", parsed);
  if (!parsed.approval_receipt) {
    return blockedEnvelope({
      trace_id,
      risk_level: "high",
      data: {
        blocked: true,
        reason: "approval_receipt_required_for_write_shaped_dry_run",
      },
    });
  }
  if (
    parsed.approval_receipt.packet_id !== parsed.packet_id ||
    parsed.approval_receipt.decision !== "approved"
  ) {
    return blockedEnvelope({
      trace_id,
      risk_level: "high",
      data: {
        blocked: true,
        reason: "approval_receipt_must_approve_the_requested_packet",
      },
    });
  }

  const packet = await getPacketOrThrow(ctx.store, parsed.packet_id);
  const adapter = makePlatformAdapterAgent({ traceId: trace_id });
  const { action } = await adapter.translate({ packet });
  const accounts = await ctx.connector.listAccounts();
  const campaigns = (
    await Promise.all(accounts.map((account) => ctx.connector.getCampaigns(account.account_id)))
  ).flat();
  const campaign = campaigns.find((item) => item.campaign_id === action.target_entity_id);
  const builder = makeDiffBuilderAgent({ traceId: trace_id });
  const { diff } = await builder.build({ action, packet, campaign });
  const parsedDiff = ExecutionDiff.parse(diff);
  await ctx.store.put("execution_diffs", parsedDiff.diff_id, parsedDiff);
  return okEnvelope({
    trace_id,
    source_refs: refsFromDiff(parsedDiff),
    risk_level: action.risk_level,
    data: parsedDiff,
  });
}
