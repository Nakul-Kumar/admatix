import {
  AgentOutput,
  TrustScore,
  type PolicyDecision,
} from "@admatix/schemas";
import { newId, nowIso, sha256 } from "@admatix/core";
import type { Agent } from "../agent.js";

export type Outcome = "validated" | "invalidated" | "blocked_unsafe";

export interface ReflectionInput {
  subject_type: "agent" | "skill" | "connector";
  subject_id: string;
  current?: TrustScore | null;
  outcomes: Outcome[];
  policyDecisions?: PolicyDecision[];
}

export interface ReflectionResult {
  output: AgentOutput;
  trust: TrustScore;
  next_plan_note: string;
}

/**
 * Trust ledger algorithm (frozen — see `ARCHITECTURE-DEEP.md` §5):
 *   validated:       score += (1 - score) * 0.15
 *   invalidated:     score -= score * 0.30
 *   blocked_unsafe:  score -= score * 0.50
 *
 * Initial score is 0.50. Reflection is the only writer of `trust_scores`;
 * it never rewrites historical evidence and never produces actions.
 */
export function makeReflectionAgent(opts: { traceId: string }): {
  agent: Agent;
  reflect(input: ReflectionInput): Promise<ReflectionResult>;
} {
  const reflect = async (input: ReflectionInput): Promise<ReflectionResult> => {
    const start = input.current ?? {
      subject_type: input.subject_type,
      subject_id: input.subject_id,
      score: 0.5,
      validated_count: 0,
      invalidated_count: 0,
      updated_at: nowIso(),
    };
    let score = start.score;
    let validated = start.validated_count;
    let invalidated = start.invalidated_count;
    let blocked = 0;
    for (const o of input.outcomes) {
      if (o === "validated") {
        score = score + (1 - score) * 0.15;
        validated += 1;
      } else if (o === "invalidated") {
        score = score - score * 0.3;
        invalidated += 1;
      } else if (o === "blocked_unsafe") {
        score = score - score * 0.5;
        blocked += 1;
      }
    }
    score = clamp(score, 0, 1);
    const trust = TrustScore.parse({
      subject_type: input.subject_type,
      subject_id: input.subject_id,
      score,
      validated_count: validated,
      invalidated_count: invalidated,
      updated_at: nowIso(),
    });
    const next_plan_note = noteFor(score);
    const input_hash = sha256({
      subject_id: input.subject_id,
      outcomes: input.outcomes,
      blocked_unsafe_count: blocked,
    });
    const output = AgentOutput.parse({
      agent_id: "reflection",
      agent_version: "0.1.0",
      input_hash,
      output_type: "trust.update",
      confidence: 1,
      evidence_refs: [
        `trust:${input.subject_type}:${input.subject_id}`,
        `trust_note:${newId("note")}`,
      ],
      proposed_actions: [],
      blocked_actions: [],
      warnings: blocked > 0 ? [`blocked_unsafe_actions:${blocked}`] : [],
      trace_id: opts.traceId,
    });
    return { output, trust, next_plan_note };
  };
  const agent: Agent = {
    id: "reflection",
    version: "0.1.0",
    async run(input: unknown): Promise<AgentOutput> {
      const r = input as ReflectionInput;
      const { output } = await reflect(r);
      return output;
    },
  };
  return { agent, reflect };
}

function clamp(n: number, lo: number, hi: number): number {
  if (n < lo) return lo;
  if (n > hi) return hi;
  return n;
}

function noteFor(score: number): string {
  if (score < 0.4) return "propose-only: surface findings without action proposals";
  if (score <= 0.75)
    return "gated: surface proposals; require full human review before activation";
  return "trusted: pre-fill approval in the cockpit; human still signs";
}
