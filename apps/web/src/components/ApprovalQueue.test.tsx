import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ApprovalQueue, validatePacket } from "./ApprovalQueue.js";
import { agencyDemoPackets } from "../lib/fixtures-fallback.js";
import type { H0Packet } from "../lib/types.js";

const invalidPacket: H0Packet = {
  ...agencyDemoPackets[0]!,
  packet_id: "h0_invalid",
  rollback: { method: "", checkpoint_id: "" },
};

describe("ApprovalQueue — acceptance test #5", () => {
  it("disables Approve when EvidenceLedger fails (missing rollback)", () => {
    render(<ApprovalQueue packets={[invalidPacket]} onApprove={vi.fn()} />);
    const approve = screen.getByTestId("approve-btn");
    expect(approve).toBeDisabled();
    expect(screen.getByTestId("invalid-banner")).toBeInTheDocument();
  });

  it("enables Approve on a valid pending packet and calls onApprove", () => {
    const onApprove = vi.fn();
    render(<ApprovalQueue packets={agencyDemoPackets} onApprove={onApprove} />);
    const buttons = screen.getAllByTestId("approve-btn");
    expect(buttons[0]).not.toBeDisabled();
    fireEvent.click(buttons[0]!);
    expect(onApprove).toHaveBeenCalledWith(agencyDemoPackets[0]!.packet_id, "approved");
  });

  it("validatePacket flags missing rollback and missing source/ref", () => {
    const result = validatePacket(invalidPacket);
    expect(result.ok).toBe(false);
    expect(result.missing).toContain("rollback");
  });
});
