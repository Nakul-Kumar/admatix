import { describe, expect, it } from "vitest";
import {
  AuditReport,
  BenchmarkRun,
  H0Packet,
} from "@admatix/schemas";
import {
  agencyDemoAudit,
  agencyDemoBenchmark,
  agencyDemoPackets,
} from "./fixtures-fallback.js";

describe("fixtures-fallback (acceptance #2 — cockpit renders with API down)", () => {
  it("agencyDemoAudit parses as a valid AuditReport", () => {
    expect(() => AuditReport.parse(agencyDemoAudit)).not.toThrow();
    expect(agencyDemoAudit.findings.length).toBeGreaterThan(0);
  });

  it("agencyDemoPackets are valid H0 packets", () => {
    for (const p of agencyDemoPackets) {
      expect(() => H0Packet.parse(p)).not.toThrow();
    }
  });

  it("agencyDemoBenchmark parses as a valid BenchmarkRun (acceptance #4)", () => {
    expect(() => BenchmarkRun.parse(agencyDemoBenchmark)).not.toThrow();
  });
});
