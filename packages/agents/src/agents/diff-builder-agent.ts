import {
  AgentOutput,
  ExecutionDiff,
  type Campaign,
  type FieldDiff,
  type H0Packet,
  type ProposedAction,
} from "@admatix/schemas";
import { newId, nowIso, sha256 } from "@admatix/core";
import type { Agent } from "../agent.js";

export interface DiffBuilderInput {
  action: ProposedAction;
  packet: H0Packet;
  campaign?: Campaign;
}

export interface DiffBuilderResult {
  output: AgentOutput;
  diff: ExecutionDiff;
}

/**
 * Builds a deterministic before/after preview from an approved proposal.
 * The result carries `dry_run: true` — schemas reject anything else, so
 * there is no path through this agent that produces a mutation.
 *
 * The diff is purely structural. Estimated impact is left empty here —
 * `core.computeImpact` is the right place to wire that up, and we keep
 * this agent free of any reasoning.
 */
export function makeDiffBuilderAgent(opts: { traceId: string }): {
  agent: Agent;
  build(input: DiffBuilderInput): Promise<DiffBuilderResult>;
} {
  const build = async (input: DiffBuilderInput): Promise<DiffBuilderResult> => {
    const changes: FieldDiff[] = buildChanges(input);
    const diff = ExecutionDiff.parse({
      diff_id: newId("diff"),
      action_id: input.action.action_id,
      entity_id: input.action.target_entity_id,
      changes,
      dry_run: true,
      created_at: nowIso(),
    });
    const input_hash = sha256({
      action_id: input.action.action_id,
      type: input.action.type,
      params: input.action.params,
    });
    const output = AgentOutput.parse({
      agent_id: "diff-builder",
      agent_version: "0.1.0",
      input_hash,
      output_type: "execution.diff",
      confidence: 1,
      evidence_refs: [`action:${input.action.action_id}`],
      proposed_actions: [],
      blocked_actions: [],
      warnings: [],
      trace_id: opts.traceId,
    });
    return { output, diff };
  };
  const agent: Agent = {
    id: "diff-builder",
    version: "0.1.0",
    async run(input: unknown): Promise<AgentOutput> {
      const db = input as DiffBuilderInput;
      const { output } = await build(db);
      return output;
    },
  };
  return { agent, build };
}

function buildChanges(input: DiffBuilderInput): FieldDiff[] {
  const params = input.action.params;
  const changes: FieldDiff[] = [];
  switch (input.action.type) {
    case "budget_shift": {
      const before = input.campaign?.daily_budget ?? null;
      const deltaPct = numericParam(params, "delta_pct");
      let after: number | null = null;
      if (before !== null && deltaPct !== null) {
        after = round2(before * (1 + deltaPct / 100));
      }
      changes.push({ field: "daily_budget", before, after });
      break;
    }
    case "pause_entity": {
      const before = input.campaign?.status ?? null;
      changes.push({ field: "status", before, after: "paused" });
      break;
    }
    case "resume_entity": {
      const before = input.campaign?.status ?? null;
      changes.push({ field: "status", before, after: "active" });
      break;
    }
    case "bid_adjust": {
      const deltaPct = numericParam(params, "delta_pct");
      changes.push({ field: "bid_delta_pct", before: 0, after: deltaPct });
      break;
    }
    case "add_negative_keyword": {
      const term = (params["term"] as string | undefined) ?? null;
      changes.push({ field: "negative_keywords", before: [], after: term ? [term] : [] });
      break;
    }
    case "creative_rotate": {
      changes.push({
        field: "creative_rotation",
        before: params["from"] ?? null,
        after: params["to"] ?? null,
      });
      break;
    }
    case "no_op": {
      changes.push({ field: "noop", before: null, after: null });
      break;
    }
  }
  return changes;
}

function numericParam(params: Record<string, unknown>, key: string): number | null {
  const v = params[key];
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
