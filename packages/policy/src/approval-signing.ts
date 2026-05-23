import { createHmac, timingSafeEqual } from "node:crypto";
import type { ApprovalReceipt } from "@admatix/schemas";

/**
 * Approval receipts are signed with a per-tenant HMAC-SHA256 over a stable
 * canonical payload. activate_dry_run verifies the signature before
 * building a diff so a network caller cannot manufacture an approval as
 * `finance_director` by POSTing fields directly.
 *
 * Secret source: `ADMATIX_APPROVAL_SECRET`. The MVP is single-tenant on
 * the demo path; the secret default below exists only so tests don't
 * need to set the env var, and `verifyApprovalReceipt` will still reject
 * a receipt missing a signature.
 */
const DEFAULT_DEMO_SECRET = "admatix-dev-only-do-not-use-in-prod";

export function approvalSecret(): string {
  const fromEnv = process.env["ADMATIX_APPROVAL_SECRET"];
  if (typeof fromEnv === "string" && fromEnv.length > 0) return fromEnv;
  return DEFAULT_DEMO_SECRET;
}

/** Canonical payload over which the HMAC is computed. */
export function approvalPayload(
  receipt: Pick<
    ApprovalReceipt,
    "packet_id" | "action_id" | "decided_by" | "decided_at" | "decision"
  >,
): string {
  return [
    receipt.packet_id,
    receipt.action_id,
    receipt.decided_by,
    receipt.decided_at,
    receipt.decision,
  ].join("|");
}

export function signApprovalReceipt(
  receipt: Pick<
    ApprovalReceipt,
    "packet_id" | "action_id" | "decided_by" | "decided_at" | "decision"
  >,
  secret: string = approvalSecret(),
): string {
  return createHmac("sha256", secret).update(approvalPayload(receipt)).digest("hex");
}

export function verifyApprovalReceipt(
  receipt: ApprovalReceipt,
  secret: string = approvalSecret(),
): { ok: true } | { ok: false; reason: string } {
  if (typeof receipt.signature !== "string" || receipt.signature.length === 0) {
    return { ok: false, reason: "missing_signature" };
  }
  const expected = signApprovalReceipt(receipt, secret);
  const got = receipt.signature;
  if (expected.length !== got.length) {
    return { ok: false, reason: "signature_mismatch" };
  }
  const ok = timingSafeEqual(Buffer.from(expected, "utf8"), Buffer.from(got, "utf8"));
  return ok ? { ok: true } : { ok: false, reason: "signature_mismatch" };
}
