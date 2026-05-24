import { describe, expect, it } from "vitest";
import { redactConnectorSecrets } from "./redact.js";

describe("connector secret redaction", () => {
  it("redacts common credential fields recursively", () => {
    const redacted = redactConnectorSecrets({
      access_token: "access-secret",
      refreshToken: "refresh-secret",
      client_secret: "client-secret",
      apiKey: "api-secret",
      nested: {
        authorization: "Bearer abc",
        cookie: "sid=abc",
        password: "pw",
      },
      safe: {
        platform: "google_ads",
        account_id: "acc_demo",
        row_count: 42,
      },
    });

    expect(redacted).toEqual({
      access_token: "[REDACTED]",
      refreshToken: "[REDACTED]",
      client_secret: "[REDACTED]",
      apiKey: "[REDACTED]",
      nested: {
        authorization: "[REDACTED]",
        cookie: "[REDACTED]",
        password: "[REDACTED]",
      },
      safe: {
        platform: "google_ads",
        account_id: "acc_demo",
        row_count: 42,
      },
    });
    expect(JSON.stringify(redacted)).not.toContain("access-secret");
    expect(JSON.stringify(redacted)).not.toContain("refresh-secret");
    expect(JSON.stringify(redacted)).not.toContain("client-secret");
    expect(JSON.stringify(redacted)).not.toContain("api-secret");
    expect(JSON.stringify(redacted)).not.toContain("Bearer abc");
  });

  it("redacts secret-bearing values inside arrays without mutating input", () => {
    const input = {
      syncs: [
        { account_id: "acc_demo", accessToken: "tok_123" },
        { account_id: "acc_other", status: "ok" },
      ],
    };

    const redacted = redactConnectorSecrets(input);

    expect(redacted).toEqual({
      syncs: [
        { account_id: "acc_demo", accessToken: "[REDACTED]" },
        { account_id: "acc_other", status: "ok" },
      ],
    });
    expect(input.syncs[0]?.accessToken).toBe("tok_123");
  });
});
