import { describe, it, expect } from "vitest";
import { resolveAccountRef } from "./resolve-ref.js";

describe("resolveAccountRef (acceptance #2)", () => {
  it("parses fixture refs", () => {
    expect(resolveAccountRef("fixture:agency-demo")).toEqual({
      kind: "fixture",
      id: "agency-demo",
    });
  });

  it("F9: live: refs are rejected at the parse boundary (MVP is fixture-only)", () => {
    expect(() => resolveAccountRef("live:1234567890")).toThrow(/not supported in the MVP|fixture/);
  });

  it("supports underscores, dots, and colons inside the id", () => {
    expect(resolveAccountRef("fixture:acc_demo_meta")).toEqual({
      kind: "fixture",
      id: "acc_demo_meta",
    });
  });

  it.each([
    "agency-demo",
    "google_ads:acc",
    "fixture:",
    ":agency-demo",
    "fixture:agency demo",
    "",
  ])("rejects malformed ref %p", (bad) => {
    expect(() => resolveAccountRef(bad)).toThrow();
  });

  it("rejects non-string input", () => {
    // @ts-expect-error — runtime guard for non-string input
    expect(() => resolveAccountRef(undefined)).toThrow();
    // @ts-expect-error — runtime guard for non-string input
    expect(() => resolveAccountRef(123)).toThrow();
  });
});
