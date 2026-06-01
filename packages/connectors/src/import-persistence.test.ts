import { describe, expect, it } from "vitest";
import {
  persistCsvImport,
  readPersistedImportManifest,
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

  it("reads a persisted manifest by key with quality and warehouse row counts", async () => {
    const planned = await persistCsvImport(goodCsv, baseOptions);
    const client = fakeReaderClient({
      manifestId: "22222222-2222-2222-2222-222222222222",
      manifestKey: planned.manifest.manifest_id,
      manifestBody: planned.manifest,
      quality: { checkCount: 7, failed: 0, warnings: 1 },
      platformRows: 2,
      conversionRows: 0,
    });

    const result = await readPersistedImportManifest(client, {
      tenant_uuid: baseOptions.tenant_uuid,
      manifest_ref: planned.manifest.manifest_id,
    });

    expect(result).toMatchObject({
      connector_import_manifest_id: "22222222-2222-2222-2222-222222222222",
      manifest_key: planned.manifest.manifest_id,
      quality: {
        check_count: 7,
        failed_check_count: 0,
        warning_check_count: 1,
        quality_status: "warn",
      },
      warehouse_inputs: {
        raw_platform_report_rows: 2,
        raw_conversion_event_rows: 0,
        raw_rows_total: 2,
      },
    });
    expect(result?.manifest.platform).toBe("google_ads");
    expect(client.sql.join("\n")).not.toMatch(/\b(INSERT|UPDATE|DELETE|TRUNCATE)\b/i);
    expect(client.sql.join("\n")).not.toMatch(/proof_bundles|h0_packets/i);
  });

  it("reads a persisted manifest by database id", async () => {
    const planned = await persistCsvImport(goodCsv, baseOptions);
    const client = fakeReaderClient({
      manifestId: "33333333-3333-3333-3333-333333333333",
      manifestKey: planned.manifest.manifest_id,
      manifestBody: planned.manifest,
      quality: { checkCount: 6, failed: 0, warnings: 0 },
      platformRows: 1,
      conversionRows: 0,
    });

    const result = await readPersistedImportManifest(client, {
      tenant_uuid: baseOptions.tenant_uuid,
      manifest_ref: "33333333-3333-3333-3333-333333333333",
    });

    expect(result?.connector_import_manifest_id).toBe("33333333-3333-3333-3333-333333333333");
    expect(result?.quality.quality_status).toBe("pass");
  });

  it("returns null when the persisted manifest is missing", async () => {
    const client = fakeReaderClient();
    const result = await readPersistedImportManifest(client, {
      tenant_uuid: baseOptions.tenant_uuid,
      manifest_ref: "import_missing",
    });

    expect(result).toBeNull();
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

interface ReaderClientOptions {
  manifestId: string;
  manifestKey: string;
  manifestBody: unknown;
  quality: { checkCount: number; failed: number; warnings: number };
  platformRows: number;
  conversionRows: number;
}

function fakeReaderClient(opts?: ReaderClientOptions): QueryExecutor & { sql: string[] } {
  const sql: string[] = [];
  return {
    sql,
    async query<T extends Record<string, unknown> = Record<string, unknown>>(statement: string) {
      sql.push(statement);
      if (/FROM app\.connector_import_manifests/.test(statement)) {
        if (!opts) return { rows: [], rowCount: 0 };
        return {
          rows: [
            {
              connector_import_manifest_id: opts.manifestId,
              manifest_key: opts.manifestKey,
              manifest_body: opts.manifestBody,
            } as unknown as T,
          ],
          rowCount: 1,
        };
      }
      if (/FROM app\.connector_quality_checks/.test(statement)) {
        return {
          rows: [
            {
              check_count: String(opts?.quality.checkCount ?? 0),
              failed_check_count: String(opts?.quality.failed ?? 0),
              warning_check_count: String(opts?.quality.warnings ?? 0),
            } as unknown as T,
          ],
          rowCount: 1,
        };
      }
      if (/FROM warehouse\.raw_platform_reports/.test(statement)) {
        return { rows: [{ count: String(opts?.platformRows ?? 0) } as unknown as T], rowCount: 1 };
      }
      if (/FROM warehouse\.raw_conversion_events/.test(statement)) {
        return { rows: [{ count: String(opts?.conversionRows ?? 0) } as unknown as T], rowCount: 1 };
      }
      throw new Error(`unexpected query: ${statement}`);
    },
  };
}
