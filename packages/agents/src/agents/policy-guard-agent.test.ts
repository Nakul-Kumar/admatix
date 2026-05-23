import { describe, expect, it } from "vitest";
import { makePolicyGuardAgent } from "./policy-guard-agent.js";

describe("policy-guard-agent", () => {
  it("blocks a budget_shift exceeding the cap", async () => {
    const { evaluate } = makePolicyGuardAgent({ traceId: "trace_x" });
    const { decision, output } = await evaluate({
      action: {
        action_id: "act_unsafe",
        packet_id: "h0_x",
        type: "budget_shift",
        target_entity_id: "campaign_a",
        params: { delta_pct: 80 },
        risk_level: "high",
        dry_run_only: true,
      },
      context: { guardrails: { requires_human_approval: true } },
    });
    expect(decision.result).toBe("block");
    expect(decision.matched_rules).toContain("budget_cap_v1");
    expect(output.blocked_actions).toEqual(["act_unsafe"]);
  });

  it("returns needs_approval for safe spend-touching actions", async () => {
    const { evaluate } = makePolicyGuardAgent({ traceId: "trace_x" });
    const { decision } = await evaluate({
      action: {
        action_id: "act_ok",
        packet_id: "h0_y",
        type: "budget_shift",
        target_entity_id: "campaign_a",
        params: { delta_pct: 10 },
        risk_level: "medium",
        dry_run_only: true,
      },
      context: { guardrails: { requires_human_approval: true } },
    });
    expect(decision.result).toBe("needs_approval");
    expect(decision.matched_rules).toContain("approval_required_v1");
  });
});
