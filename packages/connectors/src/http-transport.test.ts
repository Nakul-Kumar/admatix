import { describe, expect, it } from "vitest";
import {
  assertReadOnlyHttpRequest,
  redactHttpRequest,
} from "./http-transport.js";

describe("read-only HTTP transport guard", () => {
  it("allows Google Ads search requests but blocks mutate/write paths", () => {
    expect(() =>
      assertReadOnlyHttpRequest({
        method: "POST",
        url: "https://googleads.googleapis.com/v20/customers/123/googleAds:searchStream",
        query_name: "google_ads_campaign_metrics",
      }),
    ).not.toThrow();

    expect(() =>
      assertReadOnlyHttpRequest({
        method: "POST",
        url: "https://googleads.googleapis.com/v20/customers/123/campaigns:mutate",
      }),
    ).toThrow(/write-like API path/);
  });

  it("redacts authorization-like headers before logging", () => {
    const redacted = redactHttpRequest({
      method: "POST",
      url: "https://googleads.googleapis.com/v20/customers/123/googleAds:searchStream",
      headers: {
        authorization: "Bearer token",
        "developer-token": "secret",
        "x-safe": "ok",
      },
    });
    expect(redacted.headers).toEqual({
      authorization: "***",
      "developer-token": "***",
      "x-safe": "ok",
    });
  });
});
