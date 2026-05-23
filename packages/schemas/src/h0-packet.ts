import { z } from "zod";

/** How strong the causal claim is. Detectors default to directional. */
export const CausalStatus = z.enum([
  "directional_until_lift_test", // platform attribution only
  "experimental", // backed by a designed experiment
  "causal", // validated by a completed experiment
]);
export type CausalStatus = z.infer<typeof CausalStatus>;

/** A pointer to a concrete source row. Every claim must carry these. */
export const EvidenceRef = z.object({
  source: z.string(), // e.g. "google_ads_fixture"
  ref: z.string(), // e.g. "metric:campaign_daily:123" | "policy:budget_cap:v1"
  entity_id: z.string().optional(),
  metric: z.string().optional(),
  value: z.number().optional(),
  hash: z.string().optional(), // sha256 of the source row
});
export type EvidenceRef = z.infer<typeof EvidenceRef>;

/**
 * Per-account guardrails. All numeric fields are in their natural domain unit:
 *
 * - `max_daily_budget_delta_pct` — absolute % points, e.g. `20` means a
 *   budget shift's |delta_pct| may not exceed 20%. NEVER a fraction. A value
 *   <= 1 is therefore a near-zero cap, not a unit confusion.
 * - `min_mer` — ratio (e.g. `3.0` = 3:1 revenue to spend).
 * - `max_cac` — currency, account default.
 */
export const Guardrails = z.object({
  max_daily_budget_delta_pct: z.number().nonnegative().optional(),
  min_mer: z.number().nonnegative().optional(),
  max_cac: z.number().nonnegative().optional(),
  requires_human_approval: z.boolean().default(true),
});
export type Guardrails = z.infer<typeof Guardrails>;

export const Rollback = z.object({
  method: z.string(), // e.g. "restore_previous_budget"
  checkpoint_id: z.string(),
});
export type Rollback = z.infer<typeof Rollback>;

export const Approval = z.object({
  status: z.enum(["pending", "approved", "rejected", "not_required"]),
  required_role: z.string(),
  approved_by: z.string().optional(),
  approved_at: z.string().optional(),
});
export type Approval = z.infer<typeof Approval>;

/**
 * The H0 packet — the unit of trust in AdMatix.
 * Invariants enforced here: at least one evidence ref, a mandatory rollback,
 * and (in the MVP) dry_run_only must be true.
 */
export const H0Packet = z.object({
  packet_id: z.string(),
  tenant_id: z.string(),
  goal: z.string(),
  hypothesis: z.string(),
  null_hypothesis: z.string(),
  baseline_window: z.string(),
  success_metric: z.string(),
  guardrails: Guardrails,
  evidence: z.array(EvidenceRef).min(1),
  causal_status: CausalStatus,
  proposal: z.object({
    action: z.string(),
    target_entity_id: z.string().optional(),
    params: z.record(z.unknown()).default({}),
    dry_run_only: z.boolean().default(true),
  }),
  rollback: Rollback,
  approval: Approval,
  created_by_agent: z.string(),
  created_at: z.string(),
  trace_id: z.string(),
});
export type H0Packet = z.infer<typeof H0Packet>;
