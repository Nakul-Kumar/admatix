import { describe, it, expect } from "vitest";
import { newId, nowIso } from "./id.js";

describe("newId / nowIso", () => {
  it("prefixes the id and produces a 26-char ULID body", () => {
    const id = newId("h0");
    expect(id.startsWith("h0_")).toBe(true);
    expect(id.length).toBe("h0_".length + 26);
    expect(id.slice(3)).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
  });

  it("rejects unsafe prefixes", () => {
    expect(() => newId("BAD-PREFIX")).toThrow();
    expect(() => newId("")).toThrow();
    expect(() => newId("h0/x")).toThrow();
  });

  it("returns unique ids on repeated calls", () => {
    const a = newId("a");
    const b = newId("a");
    expect(a).not.toBe(b);
  });

  it("nowIso returns an ISO-8601 timestamp", () => {
    const t = nowIso();
    expect(t).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
    expect(Number.isFinite(Date.parse(t))).toBe(true);
  });
});
