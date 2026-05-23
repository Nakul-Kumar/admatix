import { describe, expect, it } from "vitest";
import type { H0Packet } from "@admatix/schemas";
import { makePlatformAdapterAgent } from "./platform-adapter-agent.js";
import { makeDiffBuilderAgent } from "./diff-builder-agent.js";

const packet: H0Packet = {
  packet_id: "h0_a",
  tenant_id: "t1",
  goal: "reduce_cac",
  hypothesis: "shifting -10% on campaign_a will lower CAC",
  null_hypothesis: "no effect",
  baseline_window: "2026-05-12..2026-05-21",
  success_metric: "cac",
  guardrails: { max_daily_budget_delta_pct: 25, requires_human_approval: true },
  evidence: [{ source: "src", ref: "metric:campaign_daily:campaign_a" }],
  causal_status: "directional_until_lift_test",
  proposal: {
    action: "budget_shift",
    target_entity_id: "campaign_a",
    params: { delta_pct: -10 },
    dry_run_only: true,
  },
  rollback: { method: "restore_previous_budget", checkpoint_id: "ckpt_a" },
  approval: { status: "pending", required_role: "approver" },
  created_by_agent: "media-analyst",
  created_at: new Date().toISOString(),
  trace_id: "trace_t1",
};

describe("platform-adapter-agent + diff-builder-agent", () => {
  it("adapter never invents actions — type and params come from the packet", async () => {
    const { translate } = makePlatformAdapterAgent({ traceId: "trace_x" });
    const { action } = await translate({ packet });
    expect(action.type).toBe("budget_shift");
    expect(action.params).toEqual({ delta_pct: -10 });
    expect(action.target_entity_id).toBe("campaign_a");
    expect(action.dry_run_only).toBe(true);
  });

  it("diff builder produces a dry-run before/after preview", async () => {
    const { translate } = makePlatformAdapterAgent({ traceId: "trace_x" });
    const { build } = makeDiffBuilderAgent({ traceId: "trace_x" });
    const { action } = await translate({ packet });
    const { diff } = await build({
      action,
      packet,
      campaign: {
        campaign_id: "campaign_a",
        account_id: "acc_demo",
        platform: "google_ads",
        name: "Brand - Search",
        status: "active",
        daily_budget: 500,
      },
    });
    expect(diff.dry_run).toBe(true);
    expect(diff.changes[0]?.field).toBe("daily_budget");
    expect(diff.changes[0]?.before).toBe(500);
    expect(diff.changes[0]?.after).toBe(450); // 500 * 0.9
  });
});
