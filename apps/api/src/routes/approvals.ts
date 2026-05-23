import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  ApprovalReceipt,
  H0Packet,
  type ApprovalReceipt as ApprovalReceiptT,
  type H0Packet as H0PacketT,
} from "@admatix/schemas";
import { newId, nowIso, sha256, type Store } from "@admatix/core";
import {
  emitEvent,
  signApprovalReceipt,
  verifyEvidence,
} from "@admatix/policy";
import { requireRole } from "../auth.js";

const ApprovalRequest = z.object({
  packetId: z.string(),
  decision: z.enum(["approved", "rejected"]),
  note: z.string().optional(),
});

/** Roles that may approve packets in the MVP. */
const APPROVER_ROLES = ["media_manager", "finance_director"] as const;

export interface ApprovalsDeps {
  store: Store;
}

/** POST /api/v1/approvals — record an approval/rejection on a packet. */
export function registerApprovalsRoutes(app: FastifyInstance, deps: ApprovalsDeps): void {
  app.post("/api/v1/approvals", async (req, reply) => {
    // Identity is set by the global auth hook. Role/decided_by are
    // never accepted from the request body — this is exactly the
    // forged-identity vector QA flagged. Use the token's role.
    const identity = req.identity;
    const roleCheck = requireRole(identity, [...APPROVER_ROLES]);
    if (roleCheck !== true) {
      reply.code(403);
      return roleCheck;
    }
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
    // Tenant isolation: a caller may only approve packets in their own
    // tenant. The body never lets them override this.
    if (packet.tenant_id !== identity!.tenant_id) {
      reply.code(403);
      return { error: "forbidden_tenant" };
    }
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

    const decided_at = nowIso();
    const action_id = `action_${packet.packet_id}`;
    const signature = signApprovalReceipt({
      packet_id: packet.packet_id,
      action_id,
      decided_by: identity!.token_prefix,
      decided_at,
      decision: parsed.data.decision,
    });
    const receipt: ApprovalReceiptT = ApprovalReceipt.parse({
      receipt_id: newId("rec"),
      packet_id: packet.packet_id,
      action_id,
      decision: parsed.data.decision,
      decided_by: identity!.token_prefix,
      role: identity!.role,
      decided_at,
      signature,
      ...(parsed.data.note !== undefined ? { note: parsed.data.note } : {}),
    });
    await deps.store.put("approval_receipts", receipt.receipt_id, receipt);

    const updated: H0PacketT = {
      ...packet,
      approval: {
        ...packet.approval,
        status: parsed.data.decision,
        approved_by: identity!.token_prefix,
        approved_at: receipt.decided_at,
      },
    };
    await deps.store.put("h0_packets", updated.packet_id, updated);

    // `@admatix/policy`'s emitEvent writes to `events/<workflow_id>`, but
    // `@admatix/core`'s Store.append rejects slashes in the stream name
    // (it prepends `events/` itself). Strip the prefix in the adapter,
    // matching the orchestrator (see orchestrator.ts:eventStoreAdapter).
    await emitEvent(
      {
        append: (stream, record) => {
          const norm = stream.startsWith("events/")
            ? stream.slice("events/".length)
            : stream;
          return deps.store.append(norm, record);
        },
      },
      {
        ts: decided_at,
        trace_id: packet.trace_id,
        workflow_id: `api_${packet.packet_id}`,
        step: "activate",
        agent_id: "api.approvals",
        type: `approval.${parsed.data.decision}`,
        payload_hash: sha256({
          receipt_id: receipt.receipt_id,
          packet_id: packet.packet_id,
          decision: parsed.data.decision,
        }),
        level: "info",
      },
    );

    return { receipt, packet: updated };
  });

  app.get("/api/v1/approvals", async (req, reply) => {
    const identity = req.identity;
    if (!identity) {
      reply.code(401);
      return { error: "unauthorized" };
    }
    const receipts = await deps.store.list<ApprovalReceiptT>("approval_receipts");
    const parsed = receipts.map((r) => ApprovalReceipt.parse(r));
    // Tenant isolation: each receipt is filtered by joining to its packet.
    // For the MVP we filter at the join layer; production should index by
    // tenant in the Store.
    const filtered: ApprovalReceiptT[] = [];
    for (const r of parsed) {
      const packet = await deps.store.get<H0PacketT>("h0_packets", r.packet_id);
      if (packet && (packet as H0PacketT).tenant_id === identity.tenant_id) {
        filtered.push(r);
      }
    }
    return { receipts: filtered };
  });
}
