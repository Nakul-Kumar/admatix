import { describe, it, expect } from "vitest";
import {
  approvalSecret,
  approvalPayload,
  signApprovalReceipt,
  verifyApprovalReceipt,
} from "./approval-signing.js";

const SECRET = "test-secret-xyz";
const base = {
  packet_id: "h0_01",
  action_id: "act_01",
  decided_by: "media_manager_demo",
  decided_at: "2026-05-22T12:00:00.000Z",
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
        receipt_id: "rec_1",
        ...base,
        role: "media_manager",
        signature,
      },
      SECRET,
    );
    expect(r.ok).toBe(true);
  });

  it("rejects a receipt with no signature (would have caught QA finding #5)", () => {
    const r = verifyApprovalReceipt(
      {
        receipt_id: "rec_1",
        ...base,
        role: "finance_director", // forged role
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
        receipt_id: "rec_1",
        ...base,
        role: "media_manager",
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
      receipt_id: "rec_1",
      ...base,
      decided_by: "evil_user", // mutate after sign
      role: "media_manager",
      signature,
    };
    const r = verifyApprovalReceipt(tampered, SECRET);
    expect(r.ok).toBe(false);
  });

  it("payload is deterministic in field order", () => {
    expect(approvalPayload(base)).toBe(
      [
        base.packet_id,
        base.action_id,
        base.decided_by,
        base.decided_at,
        base.decision,
      ].join("|"),
    );
  });
});
