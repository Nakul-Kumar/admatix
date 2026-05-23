import { describe, it, expect } from "vitest";
import { resolveAccountRef } from "./resolve-ref.js";

describe("resolveAccountRef (acceptance #2)", () => {
  it("parses fixture refs", () => {
    expect(resolveAccountRef("fixture:agency-demo")).toEqual({
      kind: "fixture",
      id: "agency-demo",
    });
  });

  it("parses live refs", () => {
    expect(resolveAccountRef("live:1234567890")).toEqual({
      kind: "live",
      id: "1234567890",
    });
  });

  it("supports underscores, dots, and colons inside the id", () => {
    expect(resolveAccountRef("fixture:acc_demo_meta")).toEqual({
      kind: "fixture",
      id: "acc_demo_meta",
    });
    expect(resolveAccountRef("live:tenant.acct-1")).toEqual({
      kind: "live",
      id: "tenant.acct-1",
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
