import { z } from "zod";
import { RiskLevel } from "./actions.js";

export const PolicyRule = z.object({
  rule_id: z.string(),
  description: z.string(),
  kind: z.enum([
    "budget_cap",
    "approval_required",
    "prohibited_action",
    "brand_safety",
    "platform_limit",
  ]),
  params: z.record(z.unknown()).default({}),
  severity: z.enum(["block", "warn"]),
});
export type PolicyRule = z.infer<typeof PolicyRule>;

/** The PolicyGuard verdict on a single proposed action. */
export const PolicyDecision = z.object({
  decision_id: z.string(),
  action_id: z.string(),
  policy_version: z.string(),
  result: z.enum(["allow", "block", "needs_approval"]),
  matched_rules: z.array(z.string()),
  reasons: z.array(z.string()),
  risk_level: RiskLevel,
  decided_at: z.string(),
});
export type PolicyDecision = z.infer<typeof PolicyDecision>;
