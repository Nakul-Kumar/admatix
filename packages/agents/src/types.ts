import type {
  AuditReport,
  ExecutionDiff,
  H0Packet,
  PolicyDecision,
} from "@admatix/schemas";

/**
 * The Plan→Activate→Measure→Reflect result, exactly as fixed in
 * `docs/architecture/ARCHITECTURE-DEEP.md` §3 (`@admatix/agents`).
 */
export interface WorkflowResult {
  workflow_id: string;
  trace_id: string;
  audit: AuditReport;
  packets: H0Packet[];
  diffs: ExecutionDiff[];
  decisions: PolicyDecision[];
  blocked: { action_id: string; reason: string }[];
}

export interface WorkflowIntent {
  accountRef: string;
  goal: string;
  tenantId: string;
}
