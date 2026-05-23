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

  // QA finding #13 (HIGH): evidence_refs contained `trust_note:<ulid>`,
  // which made the AgentOutput non-deterministic across reruns. The fix
  // derives the note id from `{subject_type, subject_id, outcomes}` so
  // identical inputs yield byte-identical outputs.
  it("F13: evidence_refs are deterministic across reruns on identical input", async () => {
    const a = await makeReflectionAgent({ traceId: "trace_x" }).reflect({
      subject_type: "agent",
      subject_id: "media-analyst",
      outcomes: ["validated", "blocked_unsafe"],
    });
    const b = await makeReflectionAgent({ traceId: "trace_y" }).reflect({
      subject_type: "agent",
      subject_id: "media-analyst",
      outcomes: ["validated", "blocked_unsafe"],
    });
    // evidence_refs must match byte-for-byte (the trust_note suffix is now
    // a sha256 prefix, not a ulid).
    expect(b.output.evidence_refs).toEqual(a.output.evidence_refs);
    expect(b.output.evidence_refs.find((ref) => ref.startsWith("trust_note:"))).toMatch(
      /^trust_note:[0-9a-f]{12}$/,
    );
  });
});
