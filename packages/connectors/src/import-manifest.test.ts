import { describe, expect, it } from "vitest";
import {
  buildCsvImportManifest,
  parseCsvRows,
} from "./import-manifest.js";

const GOOD_GOOGLE_ADS_CSV = [
  "date,account_id,campaign_id,spend,impressions,clicks,conversions,platform_revenue",
  "2026-05-20,acc_1,campaign_1,120.50,10000,250,12,650.25",
  "2026-05-21,acc_1,campaign_1,130.00,11000,260,13,700.00",
].join("\n");

describe("CSV import manifest", () => {
  it("creates a deterministic provenance manifest without storing raw rows", () => {
    const manifest = buildCsvImportManifest(GOOD_GOOGLE_ADS_CSV, {
      tenant_id: "tenant_demo",
      source: "google_ads_export",
      source_kind: "manual_export",
      platform: "google_ads",
      object_type: "platform_report",
      account_id: "acc_1",
      file_name: "google-ads.csv",
      imported_at: "2026-05-27T00:00:00.000Z",
      required_columns: ["date", "campaign_id", "spend", "impressions", "clicks"],
      semantic_key_columns: ["date", "campaign_id"],
    });

    expect(manifest).toMatchObject({
      manifest_id: "import_ac38a6b7ed70f039",
      tenant_id: "tenant_demo",
      source: "google_ads_export",
      source_kind: "manual_export",
      platform: "google_ads",
      object_type: "platform_report",
      account_id: "acc_1",
      row_count: 2,
      column_count: 8,
      quality: { status: "pass" },
    });
    expect(manifest.columns).toEqual([
      "date",
      "account_id",
      "campaign_id",
      "spend",
      "impressions",
      "clicks",
      "conversions",
      "platform_revenue",
    ]);
    expect(manifest.checksum_sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(manifest)).not.toContain("120.50");
    expect(manifest.claim_limits).toContain(
      "CSV/manual imports provide source-data provenance only; they do not prove incremental lift.",
    );
  });

  it("fails closed on missing required columns, negative metrics, and duplicate semantic keys", () => {
    const badCsv = [
      "date,campaign_id,spend,clicks",
      "2026-05-20,campaign_1,-10,4",
      "2026-05-20,campaign_1,10,5",
    ].join("\n");

    const manifest = buildCsvImportManifest(badCsv, {
      tenant_id: "tenant_demo",
      source: "meta_export",
      source_kind: "manual_export",
      platform: "meta_ads",
      object_type: "platform_report",
      file_name: "bad.csv",
      imported_at: "2026-05-27T00:00:00.000Z",
      required_columns: ["date", "campaign_id", "spend", "impressions"],
      semantic_key_columns: ["date", "campaign_id"],
    });

    expect(manifest.quality.status).toBe("fail");
    expect(manifest.quality.checks.map((check) => check.check_id)).toEqual(
      expect.arrayContaining([
        "required_columns_present",
        "non_negative_numeric_metrics",
        "duplicate_semantic_key",
      ]),
    );
  });

  it("fails closed when secret-bearing columns are present", () => {
    const csv = [
      "date,campaign_id,spend,access_token",
      "2026-05-20,campaign_1,10,secret-token",
    ].join("\n");

    const manifest = buildCsvImportManifest(csv, {
      tenant_id: "tenant_demo",
      source: "unsafe_export",
      source_kind: "csv_upload",
      platform: "google_ads",
      object_type: "platform_report",
      file_name: "unsafe.csv",
      imported_at: "2026-05-27T00:00:00.000Z",
    });

    expect(manifest.quality.status).toBe("fail");
    expect(manifest.quality.checks).toContainEqual(
      expect.objectContaining({
        check_id: "secret_columns_absent",
        status: "fail",
      }),
    );
    expect(JSON.stringify(manifest)).not.toContain("secret-token");
  });

  it("parses quoted CSV values and reports consistent row counts", () => {
    const parsed = parseCsvRows(
      'date,campaign_id,name,spend\n2026-05-20,campaign_1,"Brand, US",10\n',
    );
    expect(parsed.columns).toEqual(["date", "campaign_id", "name", "spend"]);
    expect(parsed.rows).toEqual([
      {
        date: "2026-05-20",
        campaign_id: "campaign_1",
        name: "Brand, US",
        spend: "10",
      },
    ]);
    expect(parsed.issues).toEqual([]);
  });
});
