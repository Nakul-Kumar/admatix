import { AgentOutput, type H0Packet, type NormalizedMetrics } from "@admatix/schemas";
import { sha256 } from "@admatix/core";
import type { Agent } from "../agent.js";
import type {
  VerifierClient,
  VerifierErrorReason,
  VerifyRequestPayload,
  VerifyResponsePayload,
} from "../verifier-client.js";

export interface MeasurementScientistDeps {
  /** Optional; when absent the agent behaves as the pre-WP-S stub. */
  verifierClient?: VerifierClient;
}

export interface MeasurementScientistInput {
  packet: H0Packet;
  metricsForEntity?: NormalizedMetrics;
  /**
   * When supplied alongside `deps.verifierClient` the agent calls the
   * verifier once and threads the result through `output.warnings` plus
   * `result.verification`. Required for the Phase 3 gate path.
   */
  verifyInput?: {
    data_uri: string;
    metadata_uri?: string;
    action_log_uri?: string;
    hint?: { design?: string };
  };
}

export interface MeasurementScientistResult {
  output: AgentOutput;
  packet: H0Packet;
  caveats: string[];
  /** Present iff `verifierClient` and `verifyInput` were both supplied. */
  verification?: VerifyResponsePayload;
}

/**
 * Adds causal caveats. MeasurementScientist never *approves* a packet — it
 * may only annotate causal_status and append caveats. The strongest claim
 * it can make in the MVP is `directional_until_lift_test`; nothing in the
 * MVP path produces `experimental` or `causal` without a future lift study.
 *
 * Enforced rule: the agent reads but never mutates evidence; rollback is
 * left untouched. This is the "measurement agents cannot approve their own
 * packets" invariant from `ARCHITECTURE-DEEP.md` §6.
 *
 * WP-S extension: when `deps.verifierClient` and `input.verifyInput` are
 * both supplied, the agent calls `/verify` exactly once. The verifier's
 * `verdict` is carried in `result.verification`; the packet schema's
 * allowed `causal_status` values are unchanged (the verifier's
 * `inconclusive` is reflected by leaving the packet at
 * `directional_until_lift_test`). The verifier never approves a packet,
 * never bypasses PolicyGuard/EvidenceLedger, and never produces a
 * ProposedAction — it only annotates.
 */
export function makeMeasurementScientistAgent(opts: {
  traceId: string;
  deps?: MeasurementScientistDeps;
}): {
  agent: Agent;
  review(input: MeasurementScientistInput): Promise<MeasurementScientistResult>;
} {
  const verifierClient = opts.deps?.verifierClient;
  const review = async (
    input: MeasurementScientistInput,
  ): Promise<MeasurementScientistResult> => {
    const caveats: string[] = [];
    const sampleSize = input.metricsForEntity?.conversions ?? 0;
    if (sampleSize < 30) {
      caveats.push(
        `low_conversion_volume:${sampleSize} — effect estimate is directional only`,
      );
    }
    if (input.packet.causal_status !== "directional_until_lift_test") {
      caveats.push(
        `downgraded_causal_status:${input.packet.causal_status} → directional_until_lift_test (no MVP lift test wired)`,
      );
    }
    const annotatedPacket: H0Packet = {
      ...input.packet,
      causal_status: "directional_until_lift_test",
    };

    let verification: VerifyResponsePayload | undefined;
    if (verifierClient && input.verifyInput) {
      const payload: VerifyRequestPayload = {
        packet: {
          packet_id: input.packet.packet_id,
          tenant_id: input.packet.tenant_id,
          account_ref: deriveAccountRef(input.packet),
          goal: input.packet.goal,
          hypothesis: input.packet.hypothesis,
          causal_status: input.packet.causal_status,
          guardrails: { ...input.packet.guardrails },
          evidence_refs: input.packet.evidence.map(
            (e) => `${e.source}:${e.ref}`,
          ),
        },
        data_uri: input.verifyInput.data_uri,
        ...(input.verifyInput.metadata_uri !== undefined
          ? { metadata_uri: input.verifyInput.metadata_uri }
          : {}),
        ...(input.verifyInput.action_log_uri !== undefined
          ? { action_log_uri: input.verifyInput.action_log_uri }
          : {}),
        ...(input.verifyInput.hint !== undefined
          ? { hint: input.verifyInput.hint }
          : {}),
      };
      try {
        verification = await verifierClient.verify(payload);
        caveats.push(`verifier_method:${verification.method}`);
        caveats.push(`verifier_verdict:${verification.verdict}`);
        if (verification.causal_status === "inconclusive") {
          caveats.push(
            "verifier_causal_status:inconclusive — packet stays at directional_until_lift_test",
          );
        }
        for (const conf of verification.confounders) {
          caveats.push(`verifier_confounder:${conf}`);
        }
      } catch (err) {
        const reason = errorReason(err);
        caveats.push(`verifier_unavailable:${reason}`);
      }
    }

    const input_hash = sha256({
      packet_id: input.packet.packet_id,
      conversions: sampleSize,
      verifier_called: verification !== undefined,
      data_uri: input.verifyInput?.data_uri ?? null,
    });
    const output = AgentOutput.parse({
      agent_id: "measurement-scientist",
      agent_version: "0.1.0",
      input_hash,
      output_type: "measurement.caveats",
      confidence: 0.7,
      evidence_refs: [`packet:${input.packet.packet_id}`],
      proposed_actions: [],
      blocked_actions: [],
      warnings: caveats,
      trace_id: opts.traceId,
    });
    const result: MeasurementScientistResult = {
      output,
      packet: annotatedPacket,
      caveats,
    };
    if (verification !== undefined) {
      result.verification = verification;
    }
    return result;
  };
  const agent: Agent = {
    id: "measurement-scientist",
    version: "0.1.0",
    async run(input: unknown): Promise<AgentOutput> {
      const ms = input as MeasurementScientistInput;
      const { output } = await review(ms);
      return output;
    },
  };
  return { agent, review };
}

/**
 * H0Packet does not currently carry an `account_ref` field. The verifier's
 * Pydantic model requires one, but uses it only as metadata (it is not used
 * for any computation). We derive a sensible string from the packet's
 * evidence refs (the detectors emit `campaign:<account>:<campaign>` /
 * `metric:campaign_daily:<account>:<campaign>:<date>`) and fall back to
 * `tenant_id` so we always have a non-empty string to send. This keeps
 * `packages/schemas` frozen; if a future schema PR adds `account_ref`
 * directly, the orchestrator can pass it via `verifyInput` and this
 * helper becomes inert.
 */
function deriveAccountRef(packet: H0Packet): string {
  for (const e of packet.evidence) {
    const parts = e.ref.split(":");
    if (parts[0] === "campaign" && parts[1]) return parts[1];
    if (
      parts[0] === "metric" &&
      parts[1] === "campaign_daily" &&
      parts[2]
    ) {
      return parts[2];
    }
  }
  return packet.tenant_id;
}

function errorReason(err: unknown): VerifierErrorReason | "unknown" {
  if (err && typeof err === "object") {
    const r = (err as { reason?: unknown }).reason;
    if (typeof r === "string") return r as VerifierErrorReason;
  }
  return "unknown";
}
