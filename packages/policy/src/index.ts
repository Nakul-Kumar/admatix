/**
 * @admatix/policy — the two mandatory gates (PolicyGuard + EvidenceLedger),
 * the policy configuration loader, and the append-only observability event log.
 *
 * Both gates fail closed: on error or ambiguity they block, never allow.
 */
export { loadPolicy, evaluateAction } from "./policy-guard.js";
export type { PolicyContext } from "./policy-guard.js";

export { verifyEvidence } from "./evidence-ledger.js";

export { emitEvent, AdmatixEvent } from "./events.js";
export type { EventStore } from "./events.js";
