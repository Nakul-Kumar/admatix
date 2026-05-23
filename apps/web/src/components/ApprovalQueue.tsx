import { useState } from "react";
import type { H0Packet } from "../lib/types.js";

interface ApprovalQueueProps {
  packets: H0Packet[];
  onApprove?: (packetId: string, decision: "approved" | "rejected") => void;
}

/**
 * The approval queue lists packets and lets the operator approve/reject.
 * Acceptance test 5: an invalid H0 packet (missing rollback or evidence)
 * cannot be approved — the button is disabled.
 */
export function ApprovalQueue({ packets, onApprove }: ApprovalQueueProps): JSX.Element {
  const [busy, setBusy] = useState<string | null>(null);

  if (packets.length === 0) {
    return (
      <p className="text-sm text-slate-500" role="status">
        No H0 packets pending review.
      </p>
    );
  }

  const handle = async (packetId: string, decision: "approved" | "rejected") => {
    if (!onApprove) return;
    setBusy(packetId);
    try {
      await Promise.resolve(onApprove(packetId, decision));
    } finally {
      setBusy(null);
    }
  };

  return (
    <ul className="flex flex-col gap-3">
      {packets.map((packet) => {
        const validity = validatePacket(packet);
        const isPending = packet.approval.status === "pending";
        const canApprove = validity.ok && isPending;
        return (
          <li
            key={packet.packet_id}
            data-testid="approval-row"
            data-packet-valid={String(validity.ok)}
            className="bg-white border border-slate-200 rounded-lg p-4 flex flex-col gap-3"
          >
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <p className="text-xs font-mono text-slate-500 truncate">
                  {packet.packet_id}
                </p>
                <h3 className="font-semibold leading-tight">{packet.hypothesis}</h3>
                <p className="text-sm text-slate-600 mt-1">
                  <span className="font-medium">Proposal:</span>{" "}
                  {packet.proposal.action} → {packet.proposal.target_entity_id ?? "—"}
                </p>
              </div>
              <span
                className={`text-xs font-medium uppercase tracking-wide px-2 py-0.5 rounded ${
                  packet.approval.status === "pending"
                    ? "bg-amber-100 text-amber-800"
                    : packet.approval.status === "approved"
                      ? "bg-emerald-100 text-emerald-800"
                      : packet.approval.status === "rejected"
                        ? "bg-red-100 text-red-800"
                        : "bg-slate-100 text-slate-700"
                }`}
              >
                {packet.approval.status}
              </span>
            </div>
            {!validity.ok ? (
              <p
                role="alert"
                data-testid="invalid-banner"
                className="text-xs px-3 py-2 rounded bg-gate-soft text-gate"
              >
                Cannot approve — EvidenceLedger rejected this packet:{" "}
                {validity.missing.join(", ")}.
              </p>
            ) : null}
            <div className="flex items-center justify-end gap-2">
              <button
                type="button"
                data-testid="reject-btn"
                disabled={!isPending || busy === packet.packet_id}
                onClick={() => handle(packet.packet_id, "rejected")}
                className="text-sm px-3 py-1.5 rounded border border-slate-300 text-slate-700 hover:bg-slate-100 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Reject
              </button>
              <button
                type="button"
                data-testid="approve-btn"
                disabled={!canApprove || busy === packet.packet_id}
                onClick={() => handle(packet.packet_id, "approved")}
                className="text-sm px-3 py-1.5 rounded bg-slate-900 text-white hover:bg-slate-800 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Approve
              </button>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

/**
 * Mirror of `verifyEvidence` from @admatix/policy — kept inline so the
 * cockpit can render the same gate verdict without an API round-trip when
 * running in fixtures-fallback mode. The contract is the same: at least one
 * evidence ref with non-empty source + ref, plus a rollback with a method
 * and a checkpoint id.
 */
export function validatePacket(packet: H0Packet): { ok: boolean; missing: string[] } {
  const missing: string[] = [];
  const rb = packet.rollback;
  if (!rb || !rb.method || !rb.checkpoint_id) {
    missing.push("rollback");
  }
  const evidence = packet.evidence ?? [];
  if (evidence.length === 0) {
    missing.push("evidence");
  } else {
    evidence.forEach((e, i) => {
      if (!e.source) missing.push(`evidence[${i}].source`);
      if (!e.ref) missing.push(`evidence[${i}].ref`);
    });
  }
  return { ok: missing.length === 0, missing };
}
