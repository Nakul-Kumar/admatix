import { describe, expect, it } from "vitest";
import { makeReflectionAgent } from "./reflection-agent.js";

describe("reflection-agent", () => {
  it("starts at 0.50 and rises on validation", async () => {
    const { reflect } = makeReflectionAgent({ traceId: "trace_x" });
    const r = await reflect({
      subject_type: "agent",
      subject_id: "media-analyst",
      outcomes: ["validated"],
    });
    // 0.50 + (1 - 0.50) * 0.15 = 0.575
    expect(r.trust.score).toBeCloseTo(0.575, 6);
    expect(r.trust.validated_count).toBe(1);
    expect(r.next_plan_note).toContain("gated");
  });

  it("decays fast on invalidation", async () => {
    const { reflect } = makeReflectionAgent({ traceId: "trace_x" });
    const r = await reflect({
      subject_type: "agent",
      subject_id: "media-analyst",
      outcomes: ["invalidated"],
    });
    // 0.50 - 0.50 * 0.30 = 0.35
    expect(r.trust.score).toBeCloseTo(0.35, 6);
    expect(r.next_plan_note).toContain("propose-only");
  });

  it("penalises blocked unsafe acts hardest", async () => {
    const { reflect } = makeReflectionAgent({ traceId: "trace_x" });
    const r = await reflect({
      subject_type: "agent",
      subject_id: "media-analyst",
      outcomes: ["blocked_unsafe"],
    });
    // 0.50 - 0.50 * 0.50 = 0.25
    expect(r.trust.score).toBeCloseTo(0.25, 6);
    expect(r.output.warnings).toContain("blocked_unsafe_actions:1");
  });
});
