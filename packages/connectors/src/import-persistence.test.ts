import { describe, expect, it } from "vitest";
import {
  persistCsvImport,
  type QueryExecutor,
} from "./import-persistence.js";

const goodCsv = [
  "date,account_id,campaign_id,spend,impressions,clicks",
  "2026-05-20,acc_1,campaign_1,100,1000,50",
].join("\n");

const baseOptions = {
  tenant_id: "tenant_demo",
  tenant_uuid: "00000000-0000-0000-0000-000000000001",
  source: "google_ads_export",
  source_kind: "manual_export" as const,
  platform: "google_ads" as const,
  object_type: "platform_report" as const,
  file_name: "google-ads.csv",
  account_id: "acc_1",
  required_columns: ["date", "campaign_id", "spend", "impressions", "clicks"],
};

describe("CSV import persistence", () => {
  it("dry-runs raw row promotion without requiring a database", async () => {
    const result = await persistCsvImport(goodCsv, baseOptions);
    expect(result.dry_run).toBe(true);
    expect(result.already_imported).toBe(false);
    expect(result.quality_blocked).toBe(false);
    expect(result.raw_rows_total).toBe(1);
    expect(result.raw_rows_inserted).toBe(0);
    expect(result.claim_limits.join(" ")).toMatch(/do not prove incremental lift/i);
  });

  it("blocks failed quality checks before persistence", async () => {
    const result = await persistCsvImport(
      "date,account_id,campaign_id,spend\n2026-05-20,acc_1,campaign_1,-100",
      { ...baseOptions, required_columns: ["date", "campaign_id", "spend"] },
      fakeClient(),
    );
    expect(result.dry_run).toBe(true);
    expect(result.quality_blocked).toBe(true);
    expect(result.raw_rows_inserted).toBe(0);
  });

  it("returns already_imported for duplicate manifest keys", async () => {
    const result = await persistCsvImport(
      goodCsv,
      { ...baseOptions, confirm: true },
      fakeClient({ existingManifestId: "11111111-1111-1111-1111-111111111111" }),
    );
    expect(result.dry_run).toBe(false);
    expect(result.already_imported).toBe(true);
    expect(result.raw_rows_inserted).toBe(0);
  });
});

function fakeClient(opts: { existingManifestId?: string } = {}): QueryExecutor {
  return {
    async query<T extends Record<string, unknown> = Record<string, unknown>>(sql: string) {
      if (/SELECT connector_import_manifest_id/.test(sql) && opts.existingManifestId) {
        return {
          rows: [{ connector_import_manifest_id: opts.existingManifestId } as unknown as T],
          rowCount: 1,
        };
      }
      return { rows: [], rowCount: 0 };
    },
  };
}
