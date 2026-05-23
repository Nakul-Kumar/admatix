/**
 * @admatix/policy — the two mandatory gates (PolicyGuard + EvidenceLedger),
 * the policy configuration, and the append-only observability event log.
 *
 * Both gates fail closed: on error or ambiguity they block, never allow.
 *
 * This file is the public surface; everything below is re-exported from the
 * implementation modules. Internal helpers live in the sibling files.
 */
import { z } from "zod";
import type {
  PolicyRule,
  PolicyDecision,
  ProposedAction,
  Guardrails,
  Campaign,
  NormalizedMetrics,
  H0Packet,
  Finding,
  WorkflowStep,
} from "@admatix/schemas";

/** Context PolicyGuard inspects alongside the action being evaluated. */
export interface PolicyContext {
  campaign?: Campaign;
  metrics?: NormalizedMetrics;
  guardrails: Guardrails;
}

/**
 * Minimal structural store contract PolicyGuard needs for event emission.
 * Compatible with the broader `Store` from `@admatix/core`.
 */
export interface EventStore {
  append(stream: string, record: unknown): Promise<void>;
}

/** The AdmatixEvent shape defined by ARCHITECTURE-DEEP §3. */
export const AdmatixEvent = z.object({
  ts: z.string(),
  trace_id: z.string(),
  workflow_id: z.string(),
  step: z.enum(["plan", "activate", "measure", "reflect"]),
  agent_id: z.string(),
  type: z.string(),
  payload_hash: z.string(),
  level: z.enum(["info", "warn", "error"]),
});
export type AdmatixEvent = z.infer<typeof AdmatixEvent>;
export type AdmatixEventLevel = AdmatixEvent["level"];
export type AdmatixEventStep = WorkflowStep;

/* eslint-disable @typescript-eslint/no-unused-vars */

/** Load a versioned policy bundle (rules + version). Default version: `"v1"`. */
export function loadPolicy(_version?: string): { version: string; rules: PolicyRule[] } {
  throw new Error("not implemented");
}

/**
 * Evaluate a proposed action against the loaded policy + guardrails.
 *
 * Fails closed: malformed input or an unverifiable invariant always returns
 * `result: "block"`. Every decision records `policy_version`.
 */
export function evaluateAction(
  _action: ProposedAction,
  _ctx: PolicyContext,
): PolicyDecision {
  throw new Error("not implemented");
}

/**
 * EvidenceLedger: an `H0Packet` or `Finding` is only valid if every claim has
 * a resolvable evidence ref and (for packets) a `rollback` block is present.
 */
export function verifyEvidence(
  _subject: H0Packet | Finding,
): { ok: boolean; missing: string[] } {
  throw new Error("not implemented");
}

/**
 * Append one observability event (one JSON line) to the workflow's trace.
 * The stream name is derived from `workflow_id`; the implementation is the
 * `Store.append` JSONL writer in `@admatix/core`.
 */
export async function emitEvent(_store: EventStore, _e: AdmatixEvent): Promise<void> {
  throw new Error("not implemented");
}
