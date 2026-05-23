import { describe, it, expect } from "vitest";
import { sha256 } from "./hash.js";

describe("sha256 — stable hashing (WP-B acceptance #6)", () => {
  it("is independent of object key insertion order", () => {
    expect(sha256({ a: 1, b: 2 })).toBe(sha256({ b: 2, a: 1 }));
  });

  it("recurses into nested objects and arrays", () => {
    const a = { outer: { x: 1, y: [3, { p: "q", r: true }] } };
    const b = { outer: { y: [3, { r: true, p: "q" }], x: 1 } };
    expect(sha256(a)).toBe(sha256(b));
  });

  it("produces different hashes for different values", () => {
    expect(sha256({ a: 1 })).not.toBe(sha256({ a: 2 }));
    expect(sha256([1, 2, 3])).not.toBe(sha256([1, 3, 2]));
  });

  it("emits a 64-char hex digest", () => {
    expect(sha256({ ok: true })).toMatch(/^[0-9a-f]{64}$/);
  });

  it("hashes primitives", () => {
    expect(sha256("hello")).toMatch(/^[0-9a-f]{64}$/);
    expect(sha256(42)).toMatch(/^[0-9a-f]{64}$/);
    expect(sha256(null)).toMatch(/^[0-9a-f]{64}$/);
  });
});
