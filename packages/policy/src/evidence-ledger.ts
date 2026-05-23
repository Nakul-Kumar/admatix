import type { EvidenceRef, Finding, H0Packet } from "@admatix/schemas";

/**
 * EvidenceLedger — fail-closed check on the provenance of a packet or finding.
 *
 * A subject is `ok: true` only when:
 *   - `evidence` is a non-empty array of refs that each carry both `source` and `ref`.
 *   - If the subject is an `H0Packet`, a `rollback` block exists with both
 *     `method` and `checkpoint_id` populated.
 *
 * Anything else returns `ok:false` with a list of `missing` paths. We never
 * "best-effort" allow on ambiguity.
 */
export function verifyEvidence(
  subject: H0Packet | Finding,
): { ok: boolean; missing: string[] } {
  const missing: string[] = [];

  if (subject === null || typeof subject !== "object") {
    return { ok: false, missing: ["subject"] };
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
    return { ok: false, missing };
  }

  for (let i = 0; i < evidenceUnknown.length; i++) {
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

  return { ok: missing.length === 0, missing };
}
