import { AgentOutput, type Finding, type H0Packet } from "@admatix/schemas";
import { sha256 } from "@admatix/core";
import {
  verifyEvidence,
  verifyEvidenceWithResolver,
  type EvidenceResolver,
} from "@admatix/policy";
import type { Agent } from "../agent.js";

export interface EvidenceLedgerInput {
  subject: H0Packet | Finding;
}

export interface EvidenceLedgerResult {
  output: AgentOutput;
  ok: boolean;
  missing: string[];
}

/**
 * Mandatory gate #2. Wraps `verifyEvidence`. Fails closed — any packet with
 * a missing ref or a missing rollback never advances past this gate.
 *
 * If a `resolver` is supplied, refs are also resolved against the
 * source-of-truth (fixture rows + Store) and hashes are recomputed and
 * compared. Without a resolver the gate falls back to the structural
 * check — that's enough for unit tests, but the orchestrator and API
 * MUST pass one.
 */
export function makeEvidenceLedgerAgent(opts: {
  traceId: string;
  resolver?: EvidenceResolver;
}): {
  agent: Agent;
  verify(input: EvidenceLedgerInput): Promise<EvidenceLedgerResult>;
} {
  const verify = async (
    input: EvidenceLedgerInput,
  ): Promise<EvidenceLedgerResult> => {
    const { ok, missing } = opts.resolver
      ? await verifyEvidenceWithResolver(input.subject, opts.resolver)
      : verifyEvidence(input.subject);
    const subjectId =
      (input.subject as { packet_id?: string; finding_id?: string }).packet_id ??
      (input.subject as { finding_id?: string }).finding_id ??
      "unknown";
    const input_hash = sha256({ subjectId, kind: "packet_or_finding" });
    const output = AgentOutput.parse({
      agent_id: "evidence-ledger",
      agent_version: "0.1.0",
      input_hash,
      output_type: "evidence.verdict",
      confidence: ok ? 1 : 0,
      evidence_refs: ok
        ? (
            (input.subject as { evidence?: { source: string; ref: string }[] })
              .evidence ?? []
          ).map((e) => `${e.source}:${e.ref}`)
        : [],
      proposed_actions: [],
      blocked_actions: [],
      warnings: ok ? [] : missing.map((m) => `missing: ${m}`),
      trace_id: opts.traceId,
    });
    return { output, ok, missing };
  };
  const agent: Agent = {
    id: "evidence-ledger",
    version: "0.1.0",
    async run(input: unknown): Promise<AgentOutput> {
      const evidence = input as EvidenceLedgerInput;
      const { output } = await verify(evidence);
      return output;
    },
  };
  return { agent, verify };
}
