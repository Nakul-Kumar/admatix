import { describe, it, expect } from "vitest";
import {
  approvalSecret,
  approvalPayload,
  signApprovalReceipt,
  verifyApprovalReceipt,
} from "./approval-signing.js";

const SECRET = "test-secret-xyz";
const base = {
  receipt_id: "rec_1",
  packet_id: "h0_01",
  action_id: "act_01",
  decided_by: "media_manager_demo",
  role: "media_manager",
  decided_at: "2026-05-22T12:00:00.000Z",
  expires_at: "2099-05-22T12:15:00.000Z",
  decision: "approved" as const,
};

function withEnv<T>(updates: Record<string, string | undefined>, fn: () => T): T {
  const prev: Record<string, string | undefined> = {};
  for (const key of Object.keys(updates)) {
    prev[key] = process.env[key];
    const next = updates[key];
    if (next === undefined) delete process.env[key];
    else process.env[key] = next;
  }
  try {
    return fn();
  } finally {
    for (const [key, value] of Object.entries(prev)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

describe("approval-signing — HMAC fail-closed", () => {
  it("hard-fails in production when ADMATIX_APPROVAL_SECRET is missing", () => {
    withEnv(
      {
        ADMATIX_ENV: "production",
        NODE_ENV: undefined,
        ADMATIX_APPROVAL_SECRET: undefined,
      },
      () => {
        expect(() => approvalSecret()).toThrow(/ADMATIX_APPROVAL_SECRET/);
      },
    );
  });

  it("hard-fails in production when ADMATIX_APPROVAL_SECRET is the demo default", () => {
    withEnv(
      {
        ADMATIX_ENV: "production",
        NODE_ENV: undefined,
        ADMATIX_APPROVAL_SECRET: "admatix-dev-only-do-not-use-in-prod",
      },
      () => {
        expect(() => approvalSecret()).toThrow(/demo default secret/);
      },
    );
  });

  it("signs and round-trips a receipt", () => {
    const signature = signApprovalReceipt(base, SECRET);
    const r = verifyApprovalReceipt(
      {
        ...base,
        signature,
      },
      SECRET,
    );
    expect(r.ok).toBe(true);
  });

  it("rejects a receipt with no signature (would have caught QA finding #5)", () => {
    const r = verifyApprovalReceipt(
      {
        ...base,
      },
      SECRET,
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("missing_signature");
  });

  it("rejects a receipt whose signature was computed with a different key", () => {
    const signature = signApprovalReceipt(base, "different-secret");
    const r = verifyApprovalReceipt(
      {
        ...base,
        signature,
      },
      SECRET,
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("signature_mismatch");
  });

  it("rejects a receipt whose payload was tampered after signing", () => {
    const signature = signApprovalReceipt(base, SECRET);
    const tampered = {
      ...base,
      decided_by: "evil_user", // mutate after sign
      signature,
    };
    const r = verifyApprovalReceipt(tampered, SECRET);
    expect(r.ok).toBe(false);
  });

  it("rejects a receipt whose receipt_id was tampered after signing", () => {
    const signature = signApprovalReceipt(base, SECRET);
    const r = verifyApprovalReceipt({ ...base, receipt_id: "rec_2", signature }, SECRET);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("signature_mismatch");
  });

  it("rejects a receipt whose role was tampered after signing", () => {
    const signature = signApprovalReceipt(base, SECRET);
    const r = verifyApprovalReceipt({ ...base, role: "finance_director", signature }, SECRET);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("signature_mismatch");
  });

  it("rejects a receipt whose expires_at was tampered after signing", () => {
    const signature = signApprovalReceipt(base, SECRET);
    const r = verifyApprovalReceipt(
      { ...base, expires_at: "2099-05-22T12:45:00.000Z", signature },
      SECRET,
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("signature_mismatch");
  });

  it("rejects expired receipts", () => {
    const expired = { ...base, expires_at: "2020-01-01T00:00:00.000Z" };
    const signature = signApprovalReceipt(expired, SECRET);
    const r = verifyApprovalReceipt({ ...expired, signature }, SECRET);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("expired");
  });

  it("rejects malformed signature hex before timing-safe compare", () => {
    const r = verifyApprovalReceipt({ ...base, signature: "not-hex" }, SECRET);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("invalid_signature_format");
  });

  it("payload is deterministic in field order", () => {
    expect(approvalPayload(base)).toBe(
      [
        base.receipt_id,
        base.packet_id,
        base.action_id,
        base.decided_by,
        base.role,
        base.decided_at,
        base.expires_at,
        base.decision,
      ].join("|"),
    );
  });
});
