import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { previewConnector } from "./preview.js";

const cassettePath = join(
  process.cwd(),
  "packages/connectors/testdata/cassettes/google_ads/campaign_metrics.json",
);

describe("connector preview facade", () => {
  it("returns metadata and claim limits for Google Ads cassette previews", async () => {
    const result = await previewConnector({
      request_id: "req_preview_google_ads",
      tenant_id: "tenant_demo",
      platform: "google_ads",
      source_kind: "oauth_readonly",
      object_type: "platform_report",
      sync_type: "performance_report",
      account_id: "1234567890",
      window: "2026-05-20..2026-05-21",
      dry_run_only: true,
      params: {},
      cassette_path: cassettePath,
    });

    expect(result.row_count).toBe(2);
    expect(result.origin.kind).toBe("preview");
    expect(result.proof_ready).toBe(false);
    expect(result.causal_status).toBe("directional_until_lift_test");
    expect(result.claim_limits.join(" ")).toMatch(/do(?:es)? not prove incremental lift/i);
  });

  it("stops before live network calls when only a credential ref is supplied", async () => {
    const result = await previewConnector({
      request_id: "req_preview_no_network",
      tenant_id: "tenant_demo",
      platform: "google_ads",
      source_kind: "oauth_readonly",
      object_type: "platform_report",
      sync_type: "performance_report",
      account_id: "1234567890",
      window: "2026-05-20..2026-05-21",
      dry_run_only: true,
      params: {},
      credential_ref: "env:ADMATIX_GOOGLE_ADS_TOKEN",
    });

    expect(result.row_count).toBe(0);
    expect(result.quality.status).toBe("warn");
    expect(result.quality.checks[0]?.check_id).toBe("no_network_call_made");
    expect(result.source_ref).toBe("credential:env:ADMATIX_GOOGLE_ADS_TOKEN");
  });

  it("rejects raw credential material", async () => {
    await expect(
      previewConnector({
        request_id: "req_preview_bad_secret",
        tenant_id: "tenant_demo",
        platform: "google_ads",
        source_kind: "oauth_readonly",
        object_type: "platform_report",
        sync_type: "performance_report",
        account_id: "1234567890",
        window: "2026-05-20..2026-05-21",
        dry_run_only: true,
        params: {},
        credential_ref: "ya29.a0AfB_byReallySecretTokenMaterial",
      }),
    ).rejects.toThrow();
  });
});
