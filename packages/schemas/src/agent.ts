import { z } from "zod";
import { RiskLevel } from "./actions.js";

/** The uniform output every agent returns. */
export const AgentOutput = z.object({
  agent_id: z.string(),
  agent_version: z.string(),
  input_hash: z.string(),
  output_type: z.string(),
  confidence: z.number().min(0).max(1),
  evidence_refs: z.array(z.string()),
  proposed_actions: z.array(z.string()).default([]), // action_ids
  blocked_actions: z.array(z.string()).default([]),
  warnings: z.array(z.string()).default([]),
  trace_id: z.string(),
});
export type AgentOutput = z.infer<typeof AgentOutput>;

export const WorkflowStep = z.enum(["plan", "activate", "measure", "reflect"]);
export type WorkflowStep = z.infer<typeof WorkflowStep>;

/** Persisted state for a single agent run — the replayable audit unit. */
export const AgentRun = z.object({
  run_id: z.string(),
  agent_id: z.string(),
  agent_version: z.string(),
  tenant_id: z.string(),
  workflow_id: z.string(),
  step: WorkflowStep,
  input_hash: z.string(),
  policy_version: z.string(),
  model: z.string(), // model id or "none"
  tools_allowed: z.array(z.string()),
  tools_called: z.array(z.string()),
  source_refs: z.array(z.string()),
  output_hash: z.string(),
  risk_level: RiskLevel,
  status: z.enum(["completed", "blocked", "error"]),
  blocked_reason: z.string().nullable().default(null),
  created_at: z.string(),
});
export type AgentRun = z.infer<typeof AgentRun>;

/** Trust accrues to agents, skills, and connectors; it rises and decays. */
export const TrustScore = z.object({
  subject_type: z.enum(["agent", "skill", "connector"]),
  subject_id: z.string(),
  score: z.number().min(0).max(1),
  validated_count: z.number().int().nonnegative(),
  invalidated_count: z.number().int().nonnegative(),
  updated_at: z.string(),
});
export type TrustScore = z.infer<typeof TrustScore>;
