import {
  buildCsvImportManifest,
  ImportManifest,
  parseCsvRows,
  type BuildCsvImportManifestOptions,
} from "./import-manifest.js";
import type { ConnectorSyncType } from "./read-contract.js";

export interface QueryExecutor {
  query<T extends Record<string, unknown> = Record<string, unknown>>(
    sql: string,
    params?: readonly unknown[],
  ): Promise<{ rows: T[]; rowCount?: number | null }>;
}

export interface PersistCsvImportOptions extends BuildCsvImportManifestOptions {
  readonly tenant_uuid: string;
  readonly imported_by?: string;
  readonly storage_uri?: string;
  readonly sync_type?: ConnectorSyncType;
  readonly api_version?: string;
  readonly confirm?: boolean;
}

export interface PersistCsvImportResult {
  readonly manifest: ImportManifest;
  readonly dry_run: boolean;
  readonly already_imported: boolean;
  readonly quality_blocked: boolean;
  readonly connector_sync_id?: string;
  readonly connector_import_manifest_id?: string;
  readonly raw_rows_total: number;
  readonly raw_rows_inserted: number;
  readonly quality_checks_written: number;
  readonly bronze_manifest_written: boolean;
  readonly claim_limits: string[];
}

export interface ReadPersistedImportManifestOptions {
  readonly tenant_uuid: string;
  readonly manifest_ref: string;
}

export interface PersistedImportManifestRead {
  readonly manifest: ImportManifest;
  readonly connector_import_manifest_id: string;
  readonly manifest_key: string;
  readonly quality: {
    readonly check_count: number;
    readonly failed_check_count: number;
    readonly warning_check_count: number;
    readonly quality_status: "pass" | "warn" | "fail";
  };
  readonly warehouse_inputs: {
    readonly raw_platform_report_rows: number;
    readonly raw_conversion_event_rows: number;
    readonly raw_rows_total: number;
  };
  readonly claim_limits: string[];
}

export async function persistCsvImport(
  input: string | Buffer,
  options: PersistCsvImportOptions,
  client?: QueryExecutor,
): Promise<PersistCsvImportResult> {
  const manifest = buildCsvImportManifest(input, options);
  const parsed = parseCsvRows(input);
  const qualityBlocked = manifest.quality.status === "fail";
  const dryRun = options.confirm !== true;
  const rawRows = rawRowsFor(manifest, parsed.rows);

  if (dryRun || qualityBlocked) {
    return {
      manifest,
      dry_run: true,
      already_imported: false,
      quality_blocked: qualityBlocked,
      raw_rows_total: rawRows.length,
      raw_rows_inserted: 0,
      quality_checks_written: 0,
      bronze_manifest_written: false,
      claim_limits: persistClaimLimits(),
    };
  }
  if (!client) {
    throw new Error("persistCsvImport confirm=true requires a QueryExecutor");
  }

  const existing = await client.query<{ connector_import_manifest_id: string }>(
    `
      SELECT connector_import_manifest_id::text AS connector_import_manifest_id
      FROM app.connector_import_manifests
      WHERE tenant_id = $1::uuid AND manifest_key = $2
    `,
    [options.tenant_uuid, manifest.manifest_id],
  );
  if (existing.rows[0]) {
    return {
      manifest,
      dry_run: false,
      already_imported: true,
      quality_blocked: false,
      connector_import_manifest_id: existing.rows[0].connector_import_manifest_id,
      raw_rows_total: rawRows.length,
      raw_rows_inserted: 0,
      quality_checks_written: 0,
      bronze_manifest_written: false,
      claim_limits: persistClaimLimits(),
    };
  }

  await client.query("BEGIN");
  try {
    const sync = await client.query<{ connector_sync_id: string }>(
      `
        INSERT INTO app.connector_syncs (
          tenant_id, platform, sync_type, status, api_version, rows_landed,
          rows_rejected, checksum, metadata, started_at, finished_at
        )
        VALUES (
          $1::uuid, $2::app.ad_platform, $3::app.connector_sync_type,
          'succeeded'::app.connector_sync_status, $4, $5, 0, $6,
          $7::jsonb, now(), now()
        )
        RETURNING connector_sync_id::text AS connector_sync_id
      `,
      [
        options.tenant_uuid,
        manifest.platform,
        options.sync_type ?? defaultSyncType(manifest.object_type),
        options.api_version,
        rawRows.length,
        manifest.checksum_sha256,
        JSON.stringify({ manifest_id: manifest.manifest_id, source_kind: manifest.source_kind }),
      ],
    );
    const connectorSyncId = requiredRow(sync.rows[0], "connector_sync_id");

    const insertedManifest = await client.query<{ connector_import_manifest_id: string }>(
      `
        INSERT INTO app.connector_import_manifests (
          tenant_id, connector_sync_id, manifest_key, source, source_kind,
          platform, object_type, external_account_id, file_name, storage_uri,
          row_count, column_count, columns, checksum_sha256, manifest_body,
          imported_by, imported_at
        )
        VALUES (
          $1::uuid, $2::uuid, $3, $4, $5::app.connector_source_kind,
          $6::app.ad_platform, $7::app.connector_import_object_type, $8, $9, $10,
          $11, $12, $13::text[], $14, $15::jsonb, $16, $17::timestamptz
        )
        RETURNING connector_import_manifest_id::text AS connector_import_manifest_id
      `,
      [
        options.tenant_uuid,
        connectorSyncId,
        manifest.manifest_id,
        manifest.source,
        manifest.source_kind,
        manifest.platform,
        manifest.object_type,
        manifest.account_id,
        manifest.file_name,
        options.storage_uri ?? `manual://${manifest.manifest_id}/${manifest.file_name}`,
        manifest.row_count,
        manifest.column_count,
        manifest.columns,
        manifest.checksum_sha256,
        JSON.stringify(manifest),
        options.imported_by,
        manifest.imported_at,
      ],
    );
    const importManifestId = requiredRow(
      insertedManifest.rows[0],
      "connector_import_manifest_id",
    );

    for (const check of manifest.quality.checks) {
      await client.query(
        `
          INSERT INTO app.connector_quality_checks (
            tenant_id, connector_sync_id, connector_import_manifest_id,
            check_id, status, severity, message, affected_rows, metadata
          )
          VALUES (
            $1::uuid, $2::uuid, $3::uuid, $4, $5::app.data_quality_status,
            $6, $7, $8, $9::jsonb
          )
        `,
        [
          options.tenant_uuid,
          connectorSyncId,
          importManifestId,
          check.check_id,
          check.status,
          check.severity,
          check.message,
          check.affected_rows,
          JSON.stringify(check.metadata),
        ],
      );
    }

    await client.query(
      `
        INSERT INTO warehouse.bronze_file_manifests (
          tenant_id, connector_sync_id, connector_import_manifest_id,
          storage_uri, source, source_kind, platform, object_type, file_name,
          content_type, compressed, row_count, byte_size, checksum_sha256, columns
        )
        VALUES (
          $1::uuid, $2::uuid, $3::uuid, $4, $5, $6::app.connector_source_kind,
          $7::app.ad_platform, $8::app.connector_import_object_type, $9,
          'text/csv', false, $10, $11, $12, $13::text[]
        )
        ON CONFLICT (tenant_id, storage_uri) DO NOTHING
      `,
      [
        options.tenant_uuid,
        connectorSyncId,
        importManifestId,
        options.storage_uri ?? `manual://${manifest.manifest_id}/${manifest.file_name}`,
        manifest.source,
        manifest.source_kind,
        manifest.platform,
        manifest.object_type,
        manifest.file_name,
        manifest.row_count,
        Buffer.byteLength(Buffer.isBuffer(input) ? input : Buffer.from(input, "utf8")),
        manifest.checksum_sha256,
        manifest.columns,
      ],
    );

    let rawRowsInserted = 0;
    for (const row of rawRows) {
      rawRowsInserted += await insertRawRow(
        client,
        row,
        options.tenant_uuid,
        connectorSyncId,
        importManifestId,
        manifest,
      );
    }
    await client.query("COMMIT");
    return {
      manifest,
      dry_run: false,
      already_imported: false,
      quality_blocked: false,
      connector_sync_id: connectorSyncId,
      connector_import_manifest_id: importManifestId,
      raw_rows_total: rawRows.length,
      raw_rows_inserted: rawRowsInserted,
      quality_checks_written: manifest.quality.checks.length,
      bronze_manifest_written: true,
      claim_limits: persistClaimLimits(),
    };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
}

export async function readPersistedImportManifest(
  client: QueryExecutor,
  options: ReadPersistedImportManifestOptions,
): Promise<PersistedImportManifestRead | null> {
  const found = await client.query<{
    connector_import_manifest_id: string;
    manifest_key: string;
    manifest_body: unknown;
  }>(
    `
      SELECT
        connector_import_manifest_id::text AS connector_import_manifest_id,
        manifest_key,
        manifest_body
      FROM app.connector_import_manifests
      WHERE tenant_id = $1::uuid
        AND (connector_import_manifest_id::text = $2 OR manifest_key = $2)
      LIMIT 1
    `,
    [options.tenant_uuid, options.manifest_ref],
  );
  const row = found.rows[0];
  if (!row) return null;

  const manifest = ImportManifest.parse(row.manifest_body);
  const quality = await client.query<{
    check_count: string | number;
    failed_check_count: string | number;
    warning_check_count: string | number;
  }>(
    `
      SELECT
        count(*) AS check_count,
        count(*) FILTER (WHERE status = 'fail') AS failed_check_count,
        count(*) FILTER (WHERE status = 'warn') AS warning_check_count
      FROM app.connector_quality_checks
      WHERE tenant_id = $1::uuid
        AND connector_import_manifest_id = $2::uuid
    `,
    [options.tenant_uuid, row.connector_import_manifest_id],
  );
  const qualityRow = quality.rows[0];
  const checkCount = asCount(qualityRow?.check_count);
  const failedCheckCount = asCount(qualityRow?.failed_check_count);
  const warningCheckCount = asCount(qualityRow?.warning_check_count);

  const rawPlatform = await client.query<{ count: string | number }>(
    `
      SELECT count(*) AS count
      FROM warehouse.raw_platform_reports
      WHERE tenant_id = $1::uuid
        AND connector_import_manifest_id = $2::uuid
    `,
    [options.tenant_uuid, row.connector_import_manifest_id],
  );
  const rawConversions = await client.query<{ count: string | number }>(
    `
      SELECT count(*) AS count
      FROM warehouse.raw_conversion_events
      WHERE tenant_id = $1::uuid
        AND connector_import_manifest_id = $2::uuid
    `,
    [options.tenant_uuid, row.connector_import_manifest_id],
  );
  const rawPlatformRows = asCount(rawPlatform.rows[0]?.count);
  const rawConversionRows = asCount(rawConversions.rows[0]?.count);

  return {
    manifest,
    connector_import_manifest_id: row.connector_import_manifest_id,
    manifest_key: row.manifest_key,
    quality: {
      check_count: checkCount,
      failed_check_count: failedCheckCount,
      warning_check_count: warningCheckCount,
      quality_status:
        failedCheckCount > 0 ? "fail" : warningCheckCount > 0 ? "warn" : "pass",
    },
    warehouse_inputs: {
      raw_platform_report_rows: rawPlatformRows,
      raw_conversion_event_rows: rawConversionRows,
      raw_rows_total: rawPlatformRows + rawConversionRows,
    },
    claim_limits: persistClaimLimits(),
  };
}

type RawRow =
  | { kind: "platform_report"; row: Record<string, string> }
  | { kind: "conversion_event"; row: Record<string, string> };

function rawRowsFor(manifest: ImportManifest, rows: Array<Record<string, string>>): RawRow[] {
  if (manifest.object_type === "platform_report") {
    return rows.map((row) => ({ kind: "platform_report", row }));
  }
  if (["conversion_event", "order", "payment"].includes(manifest.object_type)) {
    return rows.map((row) => ({ kind: "conversion_event", row }));
  }
  return [];
}

async function insertRawRow(
  client: QueryExecutor,
  raw: RawRow,
  tenantUuid: string,
  connectorSyncId: string,
  importManifestId: string,
  manifest: ImportManifest,
): Promise<number> {
  if (raw.kind === "platform_report") {
    const row = raw.row;
    const reportDate = pick(row, ["date", "report_date", "metric_date"]) ?? "1970-01-01";
    const campaignId = pick(row, ["campaign_id", "campaign_external_id", "external_entity_id"]);
    const metrics = {
      spend: numberValue(row, ["spend"]),
      impressions: numberValue(row, ["impressions"]),
      clicks: numberValue(row, ["clicks"]),
      conversions: numberValue(row, ["conversions"]),
      platform_revenue: numberValue(row, ["platform_revenue", "conversion_value", "conversion_value_usd", "revenue"]),
      currency: pick(row, ["currency"]) ?? "USD",
    };
    const dimensions = {
      external_account_id: manifest.account_id ?? pick(row, ["account_id", "external_account_id"]),
      campaign_id: campaignId,
      campaign_name: pick(row, ["campaign_name", "name"]),
    };
    const inserted = await client.query(
      `
        INSERT INTO warehouse.raw_platform_reports (
          connector_sync_id, connector_import_manifest_id, tenant_id, platform,
          report_date, grain, external_entity_id, dimensions, metrics,
          raw_payload, _source, _batch_id
        )
        VALUES (
          $1::uuid, $2::uuid, $3::uuid, $4::app.ad_platform,
          $5::date, 'campaign', $6, $7::jsonb, $8::jsonb,
          $9::jsonb, $10, $11
        )
        ON CONFLICT DO NOTHING
      `,
      [
        connectorSyncId,
        importManifestId,
        tenantUuid,
        manifest.platform,
        reportDate,
        campaignId,
        JSON.stringify(dimensions),
        JSON.stringify(metrics),
        JSON.stringify(row),
        manifest.source,
        manifest.manifest_id,
      ],
    );
    return inserted.rowCount ?? 0;
  }

  const row = raw.row;
  const eventDate = pick(row, ["date", "event_date", "order_date", "created_date"]) ?? "1970-01-01";
  const eventTs = pick(row, ["event_ts", "order_ts", "created_at"]) ?? `${eventDate}T00:00:00.000Z`;
  const inserted = await client.query(
    `
      INSERT INTO warehouse.raw_conversion_events (
        connector_sync_id, connector_import_manifest_id, tenant_id, platform,
        event_ts, event_date, event_name, conversion_action, event_id,
        privacy_safe_user_key, order_external_id, revenue, gross_margin,
        currency, attribution, raw_payload, _source, _batch_id
      )
      VALUES (
        $1::uuid, $2::uuid, $3::uuid, $4::app.ad_platform,
        $5::timestamptz, $6::date, $7, $8, $9, $10, $11,
        $12::numeric, $13::numeric, $14, $15::jsonb, $16::jsonb, $17, $18
      )
      ON CONFLICT DO NOTHING
    `,
    [
      connectorSyncId,
      importManifestId,
      tenantUuid,
      manifest.platform,
      eventTs,
      eventDate,
      pick(row, ["event_name", "conversion_action", "type"]) ?? "purchase",
      pick(row, ["conversion_action", "event_name", "type"]),
      pick(row, ["event_id", "id"]),
      pick(row, ["privacy_safe_user_key", "user_key", "hashed_user_id"]),
      pick(row, ["order_external_id", "order_id", "payment_id"]),
      numberValue(row, ["revenue", "conversion_value", "order_value"]),
      numberValue(row, ["gross_margin", "margin"]),
      pick(row, ["currency"]) ?? "USD",
      JSON.stringify({ imported_from: manifest.source }),
      JSON.stringify(row),
      manifest.source,
      manifest.manifest_id,
    ],
  );
  return inserted.rowCount ?? 0;
}

function defaultSyncType(objectType: ImportManifest["object_type"]): ConnectorSyncType {
  if (["conversion_event", "order", "payment"].includes(objectType)) return "conversion_import";
  return "performance_report";
}

function requiredRow<T extends Record<string, unknown>, K extends keyof T>(
  row: T | undefined,
  key: K,
): string {
  const value = row?.[key];
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`database did not return ${String(key)}`);
  }
  return value;
}

function pick(row: Record<string, string>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = row[key];
    if (value !== undefined && value.trim().length > 0) return value.trim();
  }
  return undefined;
}

function numberValue(row: Record<string, string>, keys: string[]): number | null {
  const value = pick(row, keys);
  if (value === undefined) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function asCount(value: string | number | undefined): number {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function persistClaimLimits(): string[] {
  return [
    "Persisted imports are warehouse inputs only; they do not prove incremental lift.",
    "Platform-attributed metrics remain directional until first-party outcomes and a pre-registered experiment are available.",
    "Rows cannot be promoted to public proof bundles without H0, policy, approval, verifier, quality, and claim-limit gates.",
  ];
}
