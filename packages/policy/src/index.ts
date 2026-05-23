/**
 * @admatix/policy — the two mandatory gates (PolicyGuard + EvidenceLedger),
 * the policy configuration loader, and the append-only observability event log.
 *
 * Both gates fail closed: on error or ambiguity they block, never allow.
 */
export {
  loadPolicy,
  evaluateAction,
  evaluateActionAgainstRules,
} from "./policy-guard.js";
export type { PolicyContext } from "./policy-guard.js";

export {
  verifyEvidence,
  verifyEvidenceWithResolver,
  createEvidenceResolver,
} from "./evidence-ledger.js";
export type { EvidenceResolver } from "./evidence-ledger.js";

export {
  approvalPayload,
  approvalSecret,
  signApprovalReceipt,
  verifyApprovalReceipt,
} from "./approval-signing.js";

export { emitEvent, AdmatixEvent } from "./events.js";
export type { EventStore } from "./events.js";
