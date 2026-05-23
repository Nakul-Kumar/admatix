import { describe, it, expect } from "vitest";
import type {
  Guardrails,
  H0Packet,
  ProposedAction,
} from "@admatix/schemas";
import { evaluateAction, loadPolicy } from "./policy-guard.js";
import type { PolicyContext } from "./policy-guard.js";

const guardrails: Guardrails = {
  max_daily_budget_delta_pct: 20,
  requires_human_approval: true,
};

function baseContext(overrides: Partial<Guardrails> = {}): PolicyContext {
  return { guardrails: { ...guardrails, ...overrides } };
}

function budgetShift(
  delta_pct: number,
  overrides: Partial<ProposedAction> = {},
): ProposedAction {
  return {
    action_id: "act_01",
    packet_id: "h0_01",
    type: "budget_shift",
    target_entity_id: "camp_01",
    params: { delta_pct },
    risk_level: "medium",
    dry_run_only: true,
    ...overrides,
  };
}

describe("loadPolicy", () => {
  it("loads policy v1 with the three required rule kinds", () => {
    const policy = loadPolicy();
    expect(policy.version).toBe("v1");
    const kinds = new Set(policy.rules.map((r) => r.kind));
    expect(kinds.has("budget_cap")).toBe(true);
    expect(kinds.has("approval_required")).toBe(true);
    expect(kinds.has("prohibited_action")).toBe(true);
  });

  it("throws an actionable error for an unknown version", () => {
    expect(() => loadPolicy("v999")).toThrow(/policy.*v999/);
  });
});

describe("evaluateAction — acceptance tests", () => {
  it("AT-1: budget_shift above the cap → result:'block' with a clear reason", () => {
    const action = budgetShift(80); // cap is 20% in guardrails
    const decision = evaluateAction(action, baseContext());
    expect(decision.result).toBe("block");
    expect(decision.matched_rules).toContain("budget_cap_v1");
    expect(decision.reasons.join(" ")).toMatch(/exceeds the 20% cap/);
    expect(decision.risk_level).toBe("high");
  });

  it("AT-2: a within-cap spend action → result:'needs_approval'", () => {
    const action = budgetShift(10); // within 20% cap
    const decision = evaluateAction(action, baseContext());
    expect(decision.result).toBe("needs_approval");
    expect(decision.matched_rules).toContain("approval_required_v1");
    expect(decision.matched_rules).not.toContain("budget_cap_v1");
  });

  it("AT-3: a non-dry-run action → result:'block' (prohibited)", () => {
    // The schema requires dry_run_only: true, so we deliberately violate
    // it to verify the fail-closed branch.
    const action = {
      ...budgetShift(5),
      dry_run_only: false,
    } as unknown as ProposedAction;
    const decision = evaluateAction(action, baseContext());
    expect(decision.result).toBe("block");
    expect(decision.matched_rules).toContain("prohibited_action_v1");
    expect(decision.reasons.join(" ")).toMatch(/schema validation|dry-run/);
  });

  it("AT-7: every PolicyDecision records the policy_version", () => {
    const decisions = [
      evaluateAction(budgetShift(80), baseContext()),
      evaluateAction(budgetShift(10), baseContext()),
      evaluateAction(
        { ...budgetShift(5), dry_run_only: false } as unknown as ProposedAction,
        baseContext(),
      ),
    ];
    for (const d of decisions) {
      expect(d.policy_version).toBe("v1");
    }
  });
});

describe("evaluateAction — fail-closed behaviour", () => {
  it("blocks malformed actions (missing required fields)", () => {
    const decision = evaluateAction(
      { action_id: "act_bogus" } as unknown as ProposedAction,
      baseContext(),
    );
    expect(decision.result).toBe("block");
    expect(decision.action_id).toBe("act_bogus");
    expect(decision.matched_rules).toContain("prohibited_action_v1");
    expect(decision.policy_version).toBe("v1");
  });

  it("blocks when guardrails are missing", () => {
    const decision = evaluateAction(
      budgetShift(5),
      { guardrails: undefined as unknown as Guardrails },
    );
    expect(decision.result).toBe("block");
    expect(decision.reasons.join(" ")).toMatch(/guardrails/i);
  });

  it("blocks when guardrails are present but malformed", () => {
    const decision = evaluateAction(
      budgetShift(5),
      {
        guardrails: {
          max_daily_budget_delta_pct: "not-a-number",
        } as unknown as Guardrails,
      },
    );
    expect(decision.result).toBe("block");
  });

  it("blocks a budget_shift that omits params.delta_pct", () => {
    const action: ProposedAction = {
      action_id: "act_no_delta",
      packet_id: "h0_01",
      type: "budget_shift",
      target_entity_id: "camp_01",
      params: {},
      risk_level: "medium",
      dry_run_only: true,
    };
    const decision = evaluateAction(action, baseContext());
    expect(decision.result).toBe("block");
    expect(decision.matched_rules).toContain("budget_cap_v1");
  });

  it("returns 'allow' for a no_op action with no rule matches", () => {
    const action: ProposedAction = {
      action_id: "act_noop",
      packet_id: "h0_01",
      type: "no_op",
      target_entity_id: "camp_01",
      params: {},
      risk_level: "low",
      dry_run_only: true,
    };
    const decision = evaluateAction(action, baseContext());
    expect(decision.result).toBe("allow");
    expect(decision.matched_rules).toHaveLength(0);
  });
});

describe("evaluateAction — packet-style usage", () => {
  it("marks a valid pause_entity (a spend-touching action) as needs_approval", () => {
    const action: ProposedAction = {
      action_id: "act_pause",
      packet_id: "h0_02",
      type: "pause_entity",
      target_entity_id: "camp_02",
      params: {},
      risk_level: "low",
      dry_run_only: true,
    };
    const decision = evaluateAction(action, baseContext());
    expect(decision.result).toBe("needs_approval");
    expect(decision.matched_rules).toContain("approval_required_v1");
  });

  it("preserves the action_id and includes a decision_id + decided_at", () => {
    const action = budgetShift(5, { action_id: "act_specific" });
    const decision = evaluateAction(action, baseContext());
    expect(decision.action_id).toBe("act_specific");
    expect(decision.decision_id).toMatch(/^dec_/);
    expect(() => new Date(decision.decided_at).toISOString()).not.toThrow();
  });

  // Reference for the H0Packet-side import — kept here so the schema link is
  // exercised in a single test file alongside the action evaluation.
  it("H0Packet schema type is reachable from the policy package", () => {
    const _typeProbe: H0Packet | undefined = undefined;
    expect(_typeProbe).toBeUndefined();
  });
});
