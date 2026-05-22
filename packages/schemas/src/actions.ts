import { z } from "zod";
import { EvidenceRef } from "./h0-packet.js";

export const ActionType = z.enum([
  "budget_shift",
  "pause_entity",
  "resume_entity",
  "bid_adjust",
  "add_negative_keyword",
  "creative_rotate",
  "no_op",
]);
export type ActionType = z.infer<typeof ActionType>;

export const RiskLevel = z.enum(["low", "medium", "high"]);
export type RiskLevel = z.infer<typeof RiskLevel>;

/** A change the system wants to make. MVP: always dry-run. */
export const ProposedAction = z.object({
  action_id: z.string(),
  packet_id: z.string(),
  type: ActionType,
  target_entity_id: z.string(),
  params: z.record(z.unknown()).default({}),
  risk_level: RiskLevel,
  dry_run_only: z.literal(true),
});
export type ProposedAction = z.infer<typeof ProposedAction>;

export const FieldDiff = z.object({
  field: z.string(),
  before: z.unknown(),
  after: z.unknown(),
});
export type FieldDiff = z.infer<typeof FieldDiff>;

/** The before/after preview produced by a dry-run activation. Never a mutation. */
export const ExecutionDiff = z.object({
  diff_id: z.string(),
  action_id: z.string(),
  entity_id: z.string(),
  changes: z.array(FieldDiff),
  estimated_impact: z.record(z.number()).optional(),
  dry_run: z.literal(true),
  created_at: z.string(),
});
export type ExecutionDiff = z.infer<typeof ExecutionDiff>;

export const ApprovalReceipt = z.object({
  receipt_id: z.string(),
  packet_id: z.string(),
  action_id: z.string(),
  decision: z.enum(["approved", "rejected"]),
  decided_by: z.string(),
  role: z.string(),
  decided_at: z.string(),
  note: z.string().optional(),
});
export type ApprovalReceipt = z.infer<typeof ApprovalReceipt>;

export const RollbackCheckpoint = z.object({
  checkpoint_id: z.string(),
  entity_id: z.string(),
  snapshot: z.record(z.unknown()),
  created_at: z.string(),
});
export type RollbackCheckpoint = z.infer<typeof RollbackCheckpoint>;

/** The Measure-step result for an H0 packet. */
export const OutcomeMeasurement = z.object({
  measurement_id: z.string(),
  packet_id: z.string(),
  success_metric: z.string(),
  baseline_value: z.number().nullable(),
  observed_value: z.number().nullable(),
  delta_pct: z.number().nullable(),
  confidence_interval: z.tuple([z.number(), z.number()]).optional(),
  passed: z.boolean(),
  notes: z.array(z.string()).default([]),
  evidence: z.array(EvidenceRef).default([]),
  measured_at: z.string(),
});
export type OutcomeMeasurement = z.infer<typeof OutcomeMeasurement>;
