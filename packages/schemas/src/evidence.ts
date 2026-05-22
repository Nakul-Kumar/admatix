import { z } from "zod";
import { EvidenceRef, CausalStatus } from "./h0-packet.js";

/** A single problem found by a detector. Always carries evidence + a causal status. */
export const Finding = z.object({
  finding_id: z.string(),
  detector: z.string(),
  severity: z.enum(["info", "low", "medium", "high"]),
  title: z.string(),
  description: z.string(),
  entity_id: z.string(),
  estimated_waste: z.number().nonnegative().optional(),
  evidence: z.array(EvidenceRef).min(1),
  causal_status: CausalStatus,
  created_at: z.string(),
});
export type Finding = z.infer<typeof Finding>;

/** The output of `admatix audit` — a set of findings with caveats. */
export const AuditReport = z.object({
  report_id: z.string(),
  account_id: z.string(),
  window: z.string(),
  findings: z.array(Finding),
  total_estimated_waste: z.number().nonnegative(),
  caveats: z.array(z.string()).default([]),
  generated_at: z.string(),
  fixture_version: z.string().optional(),
});
export type AuditReport = z.infer<typeof AuditReport>;
