import { describe, expect, it } from "vitest";
import {
  createEnvCredentialResolver,
  parseCredentialRef,
  redactCredentialRef,
} from "./credential-ref.js";

describe("credential refs", () => {
  it("accepts env, vault, and mcp references", () => {
    expect(parseCredentialRef("env:ADMATIX_GOOGLE_ADS_TOKEN")).toBe(
      "env:ADMATIX_GOOGLE_ADS_TOKEN",
    );
    expect(parseCredentialRef("vault:app.connections/conn_google_1")).toBe(
      "vault:app.connections/conn_google_1",
    );
    expect(parseCredentialRef("mcp:google_ads/conn_google_1")).toBe(
      "mcp:google_ads/conn_google_1",
    );
  });

  it("rejects raw credential material", () => {
    for (const value of [
      "Bearer ya29.raw-token",
      "sk_live_raw",
      '{"access_token":"secret"}',
      "client_secret=abc",
      "refresh_token",
    ]) {
      expect(() => parseCredentialRef(value)).toThrow(/raw credential material|credential ref/);
    }
  });

  it("resolves env refs without exposing the value", async () => {
    const resolver = createEnvCredentialResolver({
      ADMATIX_GOOGLE_ADS_TOKEN: "ya29.fake-access-token",
    });
    const material = await resolver.resolve("env:ADMATIX_GOOGLE_ADS_TOKEN");
    expect(material.ref).toBe("env:ADMATIX_GOOGLE_ADS_TOKEN");
    expect(material.value).toBe("ya29.fake-access-token");
    expect(material.redacted).toBe("ya29...oken");
    expect(redactCredentialRef("vault:app.connections/connection-123456")).toBe(
      "vault:app.connections/conn...",
    );
  });
});
