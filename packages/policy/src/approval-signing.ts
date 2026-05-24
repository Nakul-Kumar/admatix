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

function isProductionEnv(): boolean {
  return (
    process.env["ADMATIX_ENV"] === "production" ||
    process.env["NODE_ENV"] === "production"
  );
}

export function approvalSecret(): string {
  const fromEnv = process.env["ADMATIX_APPROVAL_SECRET"];
  if (typeof fromEnv === "string" && fromEnv.length > 0) {
    if (isProductionEnv() && fromEnv === DEFAULT_DEMO_SECRET) {
      throw new Error(
        "ADMATIX_APPROVAL_SECRET is the demo default secret; set a production secret.",
      );
    }
    return fromEnv;
  }
  if (isProductionEnv()) {
    throw new Error(
      "ADMATIX_APPROVAL_SECRET is required in production; demo default is local-only.",
    );
  }
  return DEFAULT_DEMO_SECRET;
}

/** Canonical payload over which the HMAC is computed. */
export function approvalPayload(
  receipt: Pick<
    ApprovalReceipt,
    | "receipt_id"
    | "packet_id"
    | "action_id"
    | "decided_by"
    | "role"
    | "decided_at"
    | "decision"
    | "expires_at"
  >,
): string {
  return [
    receipt.receipt_id,
    receipt.packet_id,
    receipt.action_id,
    receipt.decided_by,
    receipt.role,
    receipt.decided_at,
    receipt.expires_at ?? "",
    receipt.decision,
  ].join("|");
}

export function signApprovalReceipt(
  receipt: Pick<
    ApprovalReceipt,
    | "receipt_id"
    | "packet_id"
    | "action_id"
    | "decided_by"
    | "role"
    | "decided_at"
    | "decision"
    | "expires_at"
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
  if (!/^[0-9a-f]{64}$/i.test(receipt.signature)) {
    return { ok: false, reason: "invalid_signature_format" };
  }
  if (!Number.isFinite(Date.parse(receipt.decided_at))) {
    return { ok: false, reason: "invalid_decided_at" };
  }
  if (receipt.expires_at !== undefined) {
    const expiresAt = Date.parse(receipt.expires_at);
    if (!Number.isFinite(expiresAt)) {
      return { ok: false, reason: "invalid_expires_at" };
    }
    if (expiresAt <= Date.now()) {
      return { ok: false, reason: "expired" };
    }
  }
  const expected = signApprovalReceipt(receipt, secret);
  const got = receipt.signature;
  const ok = timingSafeEqual(Buffer.from(expected, "utf8"), Buffer.from(got, "utf8"));
  return ok ? { ok: true } : { ok: false, reason: "signature_mismatch" };
}
