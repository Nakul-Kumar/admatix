import { useEffect, useState } from "react";
import { ApprovalQueue } from "../components/ApprovalQueue.js";
import { DiffView } from "../components/DiffView.js";
import { approvePacket, loadPackets } from "../lib/api.js";
import type { ExecutionDiff, H0Packet } from "../lib/types.js";

export function PacketsPage(): JSX.Element {
  const [state, setState] = useState<
    | { kind: "loading" }
    | { kind: "ready"; packets: H0Packet[]; source: "api" | "fixture" }
  >({ kind: "loading" });

  useEffect(() => {
    let alive = true;
    void loadPackets().then((r) => {
      if (alive) setState({ kind: "ready", packets: r.packets, source: r.source });
    });
    return () => {
      alive = false;
    };
  }, []);

  if (state.kind === "loading") {
    return (
      <section aria-busy="true" className="text-sm text-slate-500">
        Loading H0 packets…
      </section>
    );
  }

  const handleApprove = async (packetId: string, decision: "approved" | "rejected") => {
    if (state.source === "api") {
      await approvePacket(packetId, decision, "media_manager_demo");
    }
    setState((prev) =>
      prev.kind === "ready"
        ? {
            ...prev,
            packets: prev.packets.map((p) =>
              p.packet_id === packetId
                ? {
                    ...p,
                    approval: {
                      ...p.approval,
                      status: decision,
                      approved_by: "media_manager_demo",
                      approved_at: new Date().toISOString(),
                    },
                  }
                : p,
            ),
          }
        : prev,
    );
  };

  const previewDiff = buildPreviewDiff(state.packets[0]);

  return (
    <section className="flex flex-col gap-6">
      <header>
        <p className="text-xs uppercase tracking-wide text-slate-500">Approval queue</p>
        <h2 className="text-xl font-semibold">H0 packets</h2>
        <p className="text-sm text-slate-600 mt-1">
          Each packet carries an evidence trail and a rollback. Packets that fail the
          EvidenceLedger cannot be approved.
        </p>
      </header>
      <ApprovalQueue packets={state.packets} onApprove={handleApprove} />
      <div>
        <h3 className="font-semibold mb-2">Dry-run preview</h3>
        <DiffView diff={previewDiff} />
      </div>
    </section>
  );
}

/**
 * Render a representative dry-run diff for the first pending packet so users
 * can see the before/after the system would propose. Real diffs are produced
 * by the orchestrator + DiffBuilderAgent — this is a deterministic preview.
 */
function buildPreviewDiff(packet: H0Packet | undefined): ExecutionDiff | null {
  if (!packet) return null;
  const targetBudget = 500;
  const reduction = typeof packet.proposal.params["max_reduction_pct"] === "number"
    ? (packet.proposal.params["max_reduction_pct"] as number)
    : 0.2;
  const proposedBudget = Math.round(targetBudget * (1 - reduction));
  return {
    diff_id: `diff_preview_${packet.packet_id}`,
    action_id: `action_${packet.packet_id}`,
    entity_id: packet.proposal.target_entity_id ?? "—",
    changes: [
      { field: "daily_budget", before: targetBudget, after: proposedBudget },
      { field: "action_type", before: "—", after: packet.proposal.action },
    ],
    dry_run: true,
    created_at: packet.created_at,
  };
}
