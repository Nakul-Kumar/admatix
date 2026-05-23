import { describe, expect, it } from "vitest";
import { APPROVED_TOOL_NAMES } from "./server.js";

describe("MCP server public API stubs", () => {
  it("declares the approved tool names", () => {
    expect(APPROVED_TOOL_NAMES).toEqual([
      "audit_account",
      "create_plan",
      "show_h0_packet",
      "validate_h0_packet",
      "activate_dry_run",
      "run_benchmark",
    ]);
  });
});
