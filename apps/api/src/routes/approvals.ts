import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  ApprovalReceipt,
  H0Packet,
  type ApprovalReceipt as ApprovalReceiptT,
  type H0Packet as H0PacketT,
} from "@admatix/schemas";
import { newId, nowIso, type Store } from "@admatix/core";
import { verifyEvidence } from "@admatix/policy";

const ApprovalRequest = z.object({
  packetId: z.string(),
  decision: z.enum(["approved", "rejected"]),
  decidedBy: z.string(),
  role: z.string().default("media_manager"),
  note: z.string().optional(),
});

export interface ApprovalsDeps {
  store: Store;
}

/** POST /api/v1/approvals — record an approval/rejection on a packet. */
export function registerApprovalsRoutes(app: FastifyInstance, deps: ApprovalsDeps): void {
  app.post("/api/v1/approvals", async (req, reply) => {
    const parsed = ApprovalRequest.safeParse(req.body ?? {});
    if (!parsed.success) {
      reply.code(400);
      return { error: "invalid_request", issues: parsed.error.issues };
    }

    const stored = await deps.store.get<H0PacketT>("h0_packets", parsed.data.packetId);
    if (!stored) {
      reply.code(404);
      return { error: "packet_not_found" };
    }

    const packet = H0Packet.parse(stored);
    const validity = verifyEvidence(packet);
    if (!validity.ok) {
      reply.code(409);
      return {
        error: "invalid_packet",
        message:
          "EvidenceLedger refused this packet — fix the missing fields before approving.",
        missing: validity.missing,
      };
    }

    const receipt: ApprovalReceiptT = ApprovalReceipt.parse({
      receipt_id: newId("rec"),
      packet_id: packet.packet_id,
      action_id: `action_${packet.packet_id}`,
      decision: parsed.data.decision,
      decided_by: parsed.data.decidedBy,
      role: parsed.data.role,
      decided_at: nowIso(),
      ...(parsed.data.note !== undefined ? { note: parsed.data.note } : {}),
    });
    await deps.store.put("approval_receipts", receipt.receipt_id, receipt);

    const updated: H0PacketT = {
      ...packet,
      approval: {
        ...packet.approval,
        status: parsed.data.decision,
        approved_by: parsed.data.decidedBy,
        approved_at: receipt.decided_at,
      },
    };
    await deps.store.put("h0_packets", updated.packet_id, updated);

    return { receipt, packet: updated };
  });

  app.get("/api/v1/approvals", async () => {
    const receipts = await deps.store.list<ApprovalReceiptT>("approval_receipts");
    return { receipts: receipts.map((r) => ApprovalReceipt.parse(r)) };
  });
}
