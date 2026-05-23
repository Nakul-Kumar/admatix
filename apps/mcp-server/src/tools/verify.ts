import { z } from "@admatix/schemas";
import type {
  VerifierClient,
  VerifyResponsePayload,
} from "@admatix/agents";
import {
  getPacketOrThrow,
  okEnvelope,
  refsFromEvidence,
  traceFor,
  type ToolContext,
  type ToolResultEnvelope,
} from "./common.js";

/**
 * Strict input schema for the `admatix.verify` MCP tool. The tool is
 * read-shaped — it never accepts write-class fields (e.g. `approval_receipt`)
 * — and Zod's `.strict()` rejects any unknown key with a clear error.
 */
export const VerifyInputSchema = z
  .object({
    packet_id: z.string(),
    data_uri: z.string(),
    metadata_uri: z.string().optional(),
    action_log_uri: z.string().optional(),
    hint: z.object({ design: z.string().optional() }).partial().optional(),
  })
  .strict();
export type VerifyInput = z.infer<typeof VerifyInputSchema>;

/**
 * `admatix.verify` MCP tool handler — looks up the persisted H0 packet,
 * forwards a `/verify` request to the independent verifier, and returns
 * the seven canonical fields (plus context) inside a `ToolResultEnvelope`.
 *
 * The tool is **read-shaped** by construction (`AGENTS.md` rule 7):
 * - It does not write to the store.
 * - It does not emit a `ledger.action_events` row.
 * - It does not move a packet through its lifecycle.
 *
 * The verifier's persistence side-effects only happen on the
 * orchestrator-driven workflow path (`runWorkflow`), never on a direct
 * MCP call.
 */
export async function verifyTool(
  input: VerifyInput,
  ctx: ToolContext & { verifierClient: VerifierClient },
): Promise<ToolResultEnvelope<VerifyResponsePayload>> {
  const parsed = VerifyInputSchema.parse(input);
  const packet = await getPacketOrThrow(ctx.store, parsed.packet_id);
  const account_ref = deriveAccountRef(packet);
  const payload: Parameters<VerifierClient["verify"]>[0] = {
    packet: {
      packet_id: packet.packet_id,
      tenant_id: packet.tenant_id,
      account_ref,
      goal: packet.goal,
      hypothesis: packet.hypothesis,
      causal_status: packet.causal_status,
      guardrails: { ...packet.guardrails },
      evidence_refs: packet.evidence.map((e) => `${e.source}:${e.ref}`),
    },
    data_uri: parsed.data_uri,
    ...(parsed.metadata_uri !== undefined
      ? { metadata_uri: parsed.metadata_uri }
      : {}),
    ...(parsed.action_log_uri !== undefined
      ? { action_log_uri: parsed.action_log_uri }
      : {}),
    ...(parsed.hint !== undefined ? { hint: parsed.hint } : {}),
  };
  const response = await ctx.verifierClient.verify(payload);
  return okEnvelope<VerifyResponsePayload>({
    trace_id: packet.trace_id || traceFor("verify", parsed),
    source_refs: refsFromEvidence(packet.evidence),
    risk_level: "low",
    data: response,
  });
}

/**
 * H0Packet does not currently carry an `account_ref` field, so derive one
 * from the evidence-ref convention used by the detectors and packet
 * builder (`campaign:<account>:<campaign>` /
 * `metric:campaign_daily:<account>:<campaign>:<date>`); fall back to
 * `tenant_id` so the field is always populated. The verifier uses
 * `account_ref` only as metadata.
 */
function deriveAccountRef(packet: Awaited<ReturnType<typeof getPacketOrThrow>>): string {
  for (const e of packet.evidence) {
    const parts = e.ref.split(":");
    if (parts[0] === "campaign" && parts[1]) return parts[1];
    if (
      parts[0] === "metric" &&
      parts[1] === "campaign_daily" &&
      parts[2]
    ) {
      return parts[2];
    }
  }
  return packet.tenant_id;
}
