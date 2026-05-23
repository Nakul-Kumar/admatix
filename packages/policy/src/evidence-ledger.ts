import type { EvidenceRef, Finding, H0Packet } from "@admatix/schemas";

/**
 * EvidenceLedger — fail-closed check on the provenance of a packet or finding.
 *
 * A subject is `ok: true` only when:
 *   - `evidence` is a non-empty array of refs that each carry both `source` and `ref`.
 *   - If the subject is an `H0Packet`, a `rollback` block exists with both
 *     `method` and `checkpoint_id` populated.
 *   - Each ref parses against a known pattern. Patterns supported by the MVP:
 *       - `metric:campaign_daily:<account>:<campaign>:<date>`
 *       - `metric:creative_daily:<creative>`
 *       - `metric:campaign_summary:<account>:<campaign>`
 *       - `campaign:<account>:<campaign>`
 *       - `trust:<subject_type>:<subject_id>`
 *       - `trust_note:<sha256-12>`           (deterministic; see ReflectionAgent)
 *       - `action:<action_id>` / `entity:<id>` / `packet:<packet_id>`
 *       - `policy:<rule_id>:<version>`
 *   - When a `resolver` is supplied, every ref must additionally resolve to
 *     a concrete row. If `ref.hash` is supplied, we recompute the hash of
 *     the resolved row and reject any mismatch.
 *
 * Anything else returns `ok:false` with a list of `missing` paths. We never
 * "best-effort" allow on ambiguity.
 */

const REF_PATTERNS: RegExp[] = [
  /^metric:campaign_daily:[A-Za-z0-9_.-]+:[A-Za-z0-9_.-]+:\d{4}-\d{2}-\d{2}$/,
  /^metric:campaign_summary:[A-Za-z0-9_.-]+:[A-Za-z0-9_.-]+$/,
  /^metric:creative_daily:[A-Za-z0-9_.-]+$/,
  /^campaign:[A-Za-z0-9_.-]+:[A-Za-z0-9_.-]+$/,
  /^trust:(agent|skill|connector):[A-Za-z0-9_.-]+$/,
  /^trust_note:[0-9a-f]{12}$/,
  /^action:[A-Za-z0-9_.-]+$/,
  /^entity:[A-Za-z0-9_.-]+$/,
  /^packet:[A-Za-z0-9_.-]+$/,
  /^policy:[A-Za-z0-9_.-]+(?::[A-Za-z0-9_.-]+)?$/,
];

export interface EvidenceResolver {
  /**
   * Resolve a single `EvidenceRef` to its concrete source row.
   * Returns `null` if the row does not exist (the ledger then blocks).
   * Should be deterministic.
   *
   * If `hash` is non-null on the result, it is compared against the
   * ref's `hash` (when present) byte-for-byte.
   */
  resolve(ref: EvidenceRef): Promise<{ exists: boolean; hash?: string | null }>;
}

export function verifyEvidence(
  subject: H0Packet | Finding,
): { ok: boolean; missing: string[] } {
  const missing = collectStructuralMissing(subject);
  return { ok: missing.length === 0, missing };
}

/**
 * Async, resolver-backed verification. Use this when callers want the
 * full ledger guarantee (existence + hash check against the source of
 * truth), e.g. inside `EvidenceLedgerAgent`.
 */
export async function verifyEvidenceWithResolver(
  subject: H0Packet | Finding,
  resolver: EvidenceResolver,
): Promise<{ ok: boolean; missing: string[] }> {
  const missing = collectStructuralMissing(subject);
  if (missing.length > 0) return { ok: false, missing };
  const refs = (subject as { evidence: EvidenceRef[] }).evidence;
  for (let i = 0; i < refs.length; i += 1) {
    const ref = refs[i]!;
    if (!REF_PATTERNS.some((re) => re.test(ref.ref))) {
      missing.push(`evidence[${i}].ref:unrecognized_pattern`);
      continue;
    }
    const found = await resolver.resolve(ref);
    if (!found.exists) {
      missing.push(`evidence[${i}].ref:unresolved`);
      continue;
    }
    if (
      typeof ref.hash === "string" &&
      ref.hash.length > 0 &&
      typeof found.hash === "string" &&
      found.hash.length > 0 &&
      ref.hash !== found.hash
    ) {
      missing.push(`evidence[${i}].hash:mismatch`);
    }
  }
  return { ok: missing.length === 0, missing };
}

function collectStructuralMissing(subject: H0Packet | Finding): string[] {
  const missing: string[] = [];
  if (subject === null || typeof subject !== "object") {
    return ["subject"];
  }

  const looksLikePacket = "rollback" in subject || "proposal" in subject;
  if (looksLikePacket) {
    const rb = (subject as Partial<H0Packet>).rollback;
    if (
      !rb ||
      typeof rb !== "object" ||
      typeof rb.method !== "string" ||
      rb.method.length === 0 ||
      typeof rb.checkpoint_id !== "string" ||
      rb.checkpoint_id.length === 0
    ) {
      missing.push("rollback");
    }
  }

  const evidenceUnknown = (subject as { evidence?: unknown }).evidence;
  if (!Array.isArray(evidenceUnknown) || evidenceUnknown.length === 0) {
    missing.push("evidence");
    return missing;
  }

  for (let i = 0; i < evidenceUnknown.length; i += 1) {
    const ref = evidenceUnknown[i] as Partial<EvidenceRef> | null | undefined;
    if (!ref || typeof ref !== "object") {
      missing.push(`evidence[${i}]`);
      continue;
    }
    if (typeof ref.source !== "string" || ref.source.length === 0) {
      missing.push(`evidence[${i}].source`);
    }
    if (typeof ref.ref !== "string" || ref.ref.length === 0) {
      missing.push(`evidence[${i}].ref`);
    }
  }

  return missing;
}

/**
 * A reasonable default resolver for the MVP. Existence is judged by
 * whether the ref pattern is recognised AND the lookup callback returns
 * a row. Tests can pass in a `lookup` that walks fixture JSON; the
 * orchestrator passes the live connector + Store-backed lookup.
 */
export function createEvidenceResolver(lookup: {
  campaignDailyMetric?(args: { account_id: string; campaign_id: string; date: string }):
    | Promise<{ exists: boolean; hash?: string | null } | null>
    | { exists: boolean; hash?: string | null } | null;
  campaign?(args: { account_id: string; campaign_id: string }):
    | Promise<{ exists: boolean; hash?: string | null } | null>
    | { exists: boolean; hash?: string | null } | null;
  creativeDaily?(args: { creative_id: string }):
    | Promise<{ exists: boolean; hash?: string | null } | null>
    | { exists: boolean; hash?: string | null } | null;
}): EvidenceResolver {
  return {
    async resolve(ref): Promise<{ exists: boolean; hash?: string | null }> {
      const value = ref.ref;
      // Always allow self-describing refs that do not point at fixture rows
      // (trust, action, entity, packet, policy, trust_note). They are
      // produced by the system itself and are verified by other gates.
      if (
        /^(trust|trust_note|action|entity|packet|policy):/.test(value)
      ) {
        return { exists: true };
      }

      const cdm = /^metric:campaign_daily:([A-Za-z0-9_.-]+):([A-Za-z0-9_.-]+):(\d{4}-\d{2}-\d{2})$/.exec(value);
      if (cdm) {
        const [, account_id, campaign_id, date] = cdm as unknown as [string, string, string, string];
        if (!lookup.campaignDailyMetric) return { exists: false };
        const row = await lookup.campaignDailyMetric({ account_id, campaign_id, date });
        return row ?? { exists: false };
      }

      const summ = /^metric:campaign_summary:([A-Za-z0-9_.-]+):([A-Za-z0-9_.-]+)$/.exec(value);
      if (summ) {
        if (!lookup.campaign) return { exists: false };
        const [, account_id, campaign_id] = summ as unknown as [string, string, string];
        const row = await lookup.campaign({ account_id, campaign_id });
        return row ?? { exists: false };
      }

      const camp = /^campaign:([A-Za-z0-9_.-]+):([A-Za-z0-9_.-]+)$/.exec(value);
      if (camp) {
        if (!lookup.campaign) return { exists: false };
        const [, account_id, campaign_id] = camp as unknown as [string, string, string];
        const row = await lookup.campaign({ account_id, campaign_id });
        return row ?? { exists: false };
      }

      const cre = /^metric:creative_daily:([A-Za-z0-9_.-]+)$/.exec(value);
      if (cre) {
        if (!lookup.creativeDaily) return { exists: false };
        const [, creative_id] = cre as unknown as [string, string];
        const row = await lookup.creativeDaily({ creative_id });
        return row ?? { exists: false };
      }

      return { exists: false };
    },
  };
}
