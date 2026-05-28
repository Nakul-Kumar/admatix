import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  assertReadOnlyCapabilities,
  GOOGLE_ADS_REPORTING_SCOPE,
  loadConnectorCassette,
  createCassetteTransport,
} from "./index.js";
import {
  googleAdsReadOnlyCapabilities,
  previewGoogleAds,
} from "./google-ads-readonly.js";

const cassettePath = join(
  process.cwd(),
  "packages/connectors/testdata/cassettes/google_ads/campaign_metrics.json",
);

describe("Google Ads read-only preview", () => {
  it("declares Google Ads reporting as read-only even though the OAuth scope is broad", () => {
    const parsed = assertReadOnlyCapabilities(googleAdsReadOnlyCapabilities);
    expect(parsed.platform).toBe("google_ads");
    expect(parsed.source_kind).toBe("oauth_readonly");
    expect(parsed.scopes).toContain(GOOGLE_ADS_REPORTING_SCOPE);
    expect(parsed.methods).toEqual([
      "listAccessibleCustomers",
      "searchCampaignMetrics",
      "searchCampaignSnapshots",
    ]);
  });

  it("maps a sanitized cassette into normalized campaign metric rows", async () => {
    const cassette = await loadConnectorCassette(cassettePath);
    const result = await previewGoogleAds({
      request: {
        request_id: "req_google_ads_preview_test",
        tenant_id: "tenant_demo",
        platform: "google_ads",
        source_kind: "oauth_readonly",
        object_type: "platform_report",
        sync_type: "performance_report",
        account_id: "1234567890",
        window: "2026-05-20..2026-05-21",
        dry_run_only: true,
        params: {},
      },
      transport: createCassetteTransport(cassette),
    });

    expect(result.metrics).toHaveLength(2);
    expect(result.checksum_sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(result.metrics.map((row) => row.spend)).toEqual([120, 130]);
  });
});
