import { describe, it, expect } from "vitest";
import { emitEvent, AdmatixEvent } from "./events.js";
import type { EventStore } from "./events.js";

function memoryStore(): EventStore & { lines: { stream: string; record: unknown }[] } {
  const lines: { stream: string; record: unknown }[] = [];
  return {
    lines,
    async append(stream: string, record: unknown): Promise<void> {
      lines.push({ stream, record });
    },
  };
}

const sample: AdmatixEvent = {
  ts: "2026-05-22T10:00:00.000Z",
  trace_id: "trace_42",
  workflow_id: "wf_01",
  step: "plan",
  agent_id: "PolicyGuardAgent@0.1.0",
  type: "decision_recorded",
  payload_hash: "sha256:abc",
  level: "info",
};

describe("emitEvent — acceptance tests", () => {
  it("AT-6: produces a line that JSON.parses and carries a trace_id", async () => {
    const store = memoryStore();
    await emitEvent(store, sample);
    expect(store.lines).toHaveLength(1);
    const first = store.lines[0]!;
    expect(first.stream).toBe("events/wf_01");
    // Round-trip through JSON to mirror the JSONL write the Store performs.
    const serialised = JSON.stringify(first.record);
    const parsed = JSON.parse(serialised) as AdmatixEvent;
    expect(parsed.trace_id).toBe("trace_42");
    expect(parsed.workflow_id).toBe("wf_01");
    expect(parsed.step).toBe("plan");
  });
});

describe("emitEvent — fail-closed behaviour", () => {
  it("throws when the store is missing append", async () => {
    await expect(
      emitEvent({} as unknown as EventStore, sample),
    ).rejects.toThrow(/append/);
  });

  it("throws on a malformed event (missing trace_id)", async () => {
    const store = memoryStore();
    const bad = { ...sample, trace_id: "" } as AdmatixEvent;
    await expect(emitEvent(store, bad)).rejects.toThrow();
    expect(store.lines).toHaveLength(0);
  });

  it("throws on an invalid step", async () => {
    const store = memoryStore();
    const bad = { ...sample, step: "nope" as unknown as AdmatixEvent["step"] };
    await expect(emitEvent(store, bad)).rejects.toThrow();
  });
});
