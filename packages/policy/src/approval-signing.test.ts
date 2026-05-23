import { describe, it, expect } from "vitest";
import {
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

describe("approval-signing — HMAC fail-closed", () => {
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
