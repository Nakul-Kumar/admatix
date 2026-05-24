import { ApprovalReceipt, ExecutionDiff, z } from "@admatix/schemas";
import {
  DiffBuilderExactnessError,
  makeDiffBuilderAgent,
  makePlatformAdapterAgent,
} from "@admatix/agents";
import { evaluateAction, verifyApprovalReceipt } from "@admatix/policy";
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

/**
 * Build a dry-run ExecutionDiff for an approved packet.
 *
 * Mandatory gates, in order (AGENTS.md §6 / ARCHITECTURE-DEEP §1, §7):
 *   1. an `approval_receipt` is required (and must approve THIS packet)
 *   2. the receipt's HMAC signature must verify
 *   3. PolicyGuard re-evaluates the action under the packet's guardrails;
 *      `block` returns blocked; `needs_approval` is only honoured if the
 *      signed receipt's `action_id` matches the (re-derived) action_id —
 *      which the adapter recomputes deterministically below.
 *
 * Fail-closed at every branch. There is no path that builds a diff
 * without PolicyGuard having seen the action.
 */
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
  const receiptCheck = verifyApprovalReceipt(parsed.approval_receipt);
  if (!receiptCheck.ok) {
    return blockedEnvelope({
      trace_id,
      risk_level: "high",
      data: {
        blocked: true,
        reason: `approval_receipt_signature_invalid:${receiptCheck.reason}`,
      },
    });
  }

  const packet = await getPacketOrThrow(ctx.store, parsed.packet_id);
  const adapter = makePlatformAdapterAgent({ traceId: trace_id });
  const { action } = await adapter.translate({ packet });
  if (parsed.approval_receipt.action_id !== action.action_id) {
    return blockedEnvelope({
      trace_id,
      risk_level: "high",
      data: {
        blocked: true,
        reason: "approval_receipt_action_mismatch",
      },
    });
  }
  const storedReceipt = await ctx.store.get<z.infer<typeof ApprovalReceipt>>(
    "approval_receipts",
    parsed.approval_receipt.receipt_id,
  );
  if (!storedReceipt || storedReceipt.signature !== parsed.approval_receipt.signature) {
    return blockedEnvelope({
      trace_id,
      risk_level: "high",
      data: {
        blocked: true,
        reason: "approval_receipt_not_stored",
      },
    });
  }
  const existingDiffs = await ctx.store.list<z.infer<typeof ExecutionDiff>>(
    "execution_diffs",
    { action_id: action.action_id },
  );
  if (existingDiffs.length > 0) {
    return blockedEnvelope({
      trace_id,
      risk_level: "high",
      data: {
        blocked: true,
        reason: "approval_receipt_already_used",
      },
    });
  }
  const accounts = await ctx.connector.listAccounts();
  const campaigns = (
    await Promise.all(accounts.map((account) => ctx.connector.getCampaigns(account.account_id)))
  ).flat();
  const campaign = campaigns.find((item) => item.campaign_id === action.target_entity_id);
  // Mandatory PolicyGuard gate. Without this call the MCP tool could
  // emit a dry-run diff for an action that the orchestrator path would
  // block — the cockpit/agent would then think an "approved + activated"
  // diff cleared policy when it never did.
  const decision = evaluateAction(action, {
    guardrails: packet.guardrails,
    ...(campaign ? { campaign } : {}),
  });
  if (decision.result === "block") {
    return blockedEnvelope({
      trace_id,
      risk_level: "high",
      data: {
        blocked: true,
        reason: `policy_block:${decision.reasons.join("; ")}`,
      },
    });
  }
  if (decision.result === "needs_approval") {
    // The receipt already approved this packet. PolicyGuard's
    // `needs_approval` is the "human must sign" route; with a valid
    // signed receipt we accept it. Anything stronger (block) was rejected
    // above. We record the decision id so audit trail covers this path.
  }
  const builder = makeDiffBuilderAgent({ traceId: trace_id });
  let diff: z.infer<typeof ExecutionDiff>;
  try {
    const built = await builder.build({ action, packet, campaign });
    diff = built.diff;
  } catch (error) {
    if (error instanceof DiffBuilderExactnessError) {
      return blockedEnvelope({
        trace_id,
        risk_level: "high",
        data: {
          blocked: true,
          reason: `diff_not_exact:${error.code}`,
        },
      });
    }
    throw error;
  }
  const parsedDiff = ExecutionDiff.parse(diff);
  await ctx.store.put("execution_diffs", parsedDiff.diff_id, parsedDiff);
  await ctx.store.put("policy_decisions", decision.decision_id, decision);
  return okEnvelope({
    trace_id,
    source_refs: refsFromDiff(parsedDiff),
    risk_level: action.risk_level,
    data: parsedDiff,
  });
}
