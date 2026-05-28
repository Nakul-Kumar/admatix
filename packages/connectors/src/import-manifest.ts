import { createHash } from "node:crypto";
import { Platform, z } from "@admatix/schemas";

const UNSAFE_COLUMN =
  /(?:access|refresh)?[_-]?token|secret|password|authorization|cookie|api[_-]?key|email|phone|full[_-]?name|address|ip[_-]?address/i;

export const ConnectorSourceKind = z.enum([
  "csv_upload",
  "manual_export",
  "api_pull",
  "oauth_readonly",
  "platform_mcp",
  "fixture",
]);
export type ConnectorSourceKind = z.infer<typeof ConnectorSourceKind>;

export const ImportObjectType = z.enum([
  "platform_report",
  "entity_snapshot",
  "conversion_event",
  "account",
  "campaign",
  "ad_set",
  "ad",
  "creative",
  "order",
  "payment",
  "unknown",
]);
export type ImportObjectType = z.infer<typeof ImportObjectType>;

export const ImportQualityStatus = z.enum(["pass", "warn", "fail"]);
export type ImportQualityStatus = z.infer<typeof ImportQualityStatus>;

export const ImportQualityCheck = z.object({
  check_id: z.string(),
  status: ImportQualityStatus,
  severity: z.enum(["info", "warning", "error"]),
  message: z.string(),
  affected_rows: z.number().int().nonnegative().optional(),
  metadata: z.record(z.unknown()).default({}),
});
export type ImportQualityCheck = z.infer<typeof ImportQualityCheck>;

export const ImportManifest = z.object({
  schema_version: z.literal("connector-import-manifest/v1"),
  manifest_id: z.string(),
  tenant_id: z.string(),
  source: z.string(),
  source_kind: ConnectorSourceKind,
  platform: Platform,
  object_type: ImportObjectType,
  account_id: z.string().optional(),
  file_name: z.string(),
  imported_at: z.string(),
  row_count: z.number().int().nonnegative(),
  column_count: z.number().int().nonnegative(),
  columns: z.array(z.string()),
  checksum_sha256: z.string().regex(/^[0-9a-f]{64}$/),
  quality: z.object({
    status: ImportQualityStatus,
    checks: z.array(ImportQualityCheck),
  }),
  claim_limits: z.array(z.string()),
});
export type ImportManifest = z.infer<typeof ImportManifest>;

export interface CsvParseResult {
  columns: string[];
  rows: Array<Record<string, string>>;
  issues: Array<{ row: number; message: string }>;
}

export interface BuildCsvImportManifestOptions {
  tenant_id: string;
  source: string;
  source_kind: ConnectorSourceKind;
  platform: z.infer<typeof Platform>;
  object_type: ImportObjectType;
  file_name: string;
  account_id?: string;
  imported_at?: string;
  required_columns?: string[];
  semantic_key_columns?: string[];
}

const NUMERIC_METRIC_COLUMNS = new Set([
  "spend",
  "impressions",
  "clicks",
  "conversions",
  "platform_revenue",
  "revenue",
  "gross_margin",
  "orders",
]);

const DATE_COLUMNS = new Set(["date", "event_date", "report_date"]);

export function parseCsvRows(input: string | Buffer): CsvParseResult {
  const text = stripBom(Buffer.isBuffer(input) ? input.toString("utf8") : input);
  const parsed = parseCsvText(text);
  const rows = parsed.rows.filter((row) => row.some((cell) => cell.trim().length > 0));
  if (rows.length === 0) return { columns: [], rows: [], issues: parsed.issues };

  const columns = rows[0]!.map((column) => column.trim());
  const records: Array<Record<string, string>> = [];
  const issues = [...parsed.issues];
  for (let i = 1; i < rows.length; i += 1) {
    const row = rows[i]!;
    if (row.length !== columns.length) {
      issues.push({
        row: i + 1,
        message: `expected ${columns.length} columns but found ${row.length}`,
      });
    }
    const record: Record<string, string> = {};
    for (let c = 0; c < columns.length; c += 1) {
      const key = columns[c] ?? `column_${c + 1}`;
      record[key] = row[c] ?? "";
    }
    records.push(record);
  }
  return { columns, rows: records, issues };
}

export function buildCsvImportManifest(
  input: string | Buffer,
  options: BuildCsvImportManifestOptions,
): ImportManifest {
  const parsedOptions = {
    ...options,
    platform: Platform.parse(options.platform),
    source_kind: ConnectorSourceKind.parse(options.source_kind),
    object_type: ImportObjectType.parse(options.object_type),
  };
  const raw = Buffer.isBuffer(input) ? input : Buffer.from(input, "utf8");
  const parsed = parseCsvRows(raw);
  const checks = evaluateQuality(parsed, parsedOptions);
  const status = summarizeChecks(checks);
  const checksum = createHash("sha256").update(raw).digest("hex");
  const importedAt = options.imported_at ?? new Date().toISOString();
  const base = {
    tenant_id: parsedOptions.tenant_id,
    source: parsedOptions.source,
    source_kind: parsedOptions.source_kind,
    platform: parsedOptions.platform,
    object_type: parsedOptions.object_type,
    account_id: parsedOptions.account_id,
    file_name: parsedOptions.file_name,
    imported_at: importedAt,
    row_count: parsed.rows.length,
    column_count: parsed.columns.length,
    columns: parsed.columns,
    checksum_sha256: checksum,
  };
  const manifest = {
    schema_version: "connector-import-manifest/v1" as const,
    manifest_id: `import_${sha256Json(base).slice(0, 16)}`,
    ...base,
    quality: { status, checks },
    claim_limits: claimLimitsFor(parsedOptions.object_type),
  };
  return ImportManifest.parse(manifest);
}

function evaluateQuality(
  parsed: CsvParseResult,
  options: BuildCsvImportManifestOptions,
): ImportQualityCheck[] {
  return [
    checkNonEmpty(parsed),
    checkRowCount(parsed),
    checkDuplicateColumns(parsed),
    checkRequiredColumns(parsed, options.required_columns ?? []),
    checkParseIssues(parsed),
    checkUnsafeColumns(parsed),
    checkNumericMetrics(parsed),
    checkDates(parsed),
    checkDuplicateSemanticKey(parsed, options.semantic_key_columns ?? []),
  ];
}

function checkNonEmpty(parsed: CsvParseResult): ImportQualityCheck {
  const ok = parsed.columns.length > 0;
  return check("non_empty_file", ok, "CSV has a header row.", "CSV is empty or missing a header row.");
}

function checkRowCount(parsed: CsvParseResult): ImportQualityCheck {
  const ok = parsed.rows.length > 0;
  return check(
    "row_count_positive",
    ok,
    `CSV contains ${parsed.rows.length} data row(s).`,
    "CSV has no data rows.",
    ok ? undefined : 0,
  );
}

function checkDuplicateColumns(parsed: CsvParseResult): ImportQualityCheck {
  const seen = new Set<string>();
  const duplicates = parsed.columns.filter((column) => {
    const key = column.toLowerCase();
    if (seen.has(key)) return true;
    seen.add(key);
    return false;
  });
  return check(
    "unique_columns",
    duplicates.length === 0,
    "Column names are unique.",
    `Duplicate columns found: ${duplicates.join(", ")}.`,
    duplicates.length || undefined,
    { duplicates },
  );
}

function checkRequiredColumns(
  parsed: CsvParseResult,
  required: string[],
): ImportQualityCheck {
  const lower = new Set(parsed.columns.map((column) => column.toLowerCase()));
  const missing = required.filter((column) => !lower.has(column.toLowerCase()));
  return check(
    "required_columns_present",
    missing.length === 0,
    "Required columns are present.",
    `Missing required columns: ${missing.join(", ")}.`,
    missing.length || undefined,
    { required, missing },
  );
}

function checkParseIssues(parsed: CsvParseResult): ImportQualityCheck {
  return check(
    "consistent_columns",
    parsed.issues.length === 0,
    "Every row has the expected column count.",
    "One or more rows have malformed CSV structure.",
    parsed.issues.length || undefined,
    { issues: parsed.issues },
  );
}

function checkUnsafeColumns(parsed: CsvParseResult): ImportQualityCheck {
  const bad = parsed.columns.filter((column) => UNSAFE_COLUMN.test(column));
  return check(
    "secret_columns_absent",
    bad.length === 0,
    "No secret- or PII-bearing columns detected.",
    `Secret- or PII-bearing columns must not be imported: ${bad.join(", ")}.`,
    bad.length || undefined,
    { columns: bad },
  );
}

function checkNumericMetrics(parsed: CsvParseResult): ImportQualityCheck {
  const affected = parsed.rows.filter((row) =>
    Object.entries(row).some(([key, value]) => {
      if (!NUMERIC_METRIC_COLUMNS.has(key)) return false;
      if (value.trim().length === 0) return false;
      const n = Number(value);
      return Number.isNaN(n) || n < 0;
    }),
  ).length;
  return check(
    "non_negative_numeric_metrics",
    affected === 0,
    "Numeric metric columns are non-negative.",
    "Numeric metric columns must be non-negative numbers.",
    affected || undefined,
  );
}

function checkDates(parsed: CsvParseResult): ImportQualityCheck {
  const dateColumns = parsed.columns.filter((column) => DATE_COLUMNS.has(column));
  const affected = parsed.rows.filter((row) =>
    dateColumns.some((column) => {
      const value = row[column] ?? "";
      return value.length > 0 && !/^\d{4}-\d{2}-\d{2}$/.test(value);
    }),
  ).length;
  return check(
    "date_columns_iso8601",
    affected === 0,
    "Date columns use YYYY-MM-DD format.",
    "Date columns must use YYYY-MM-DD format.",
    affected || undefined,
    { date_columns: dateColumns },
  );
}

function checkDuplicateSemanticKey(
  parsed: CsvParseResult,
  semanticKeyColumns: string[],
): ImportQualityCheck {
  if (semanticKeyColumns.length === 0) {
    return {
      check_id: "duplicate_semantic_key",
      status: "pass",
      severity: "info",
      message: "No semantic key configured for duplicate detection.",
      metadata: {},
    };
  }
  const missing = semanticKeyColumns.filter((column) => !parsed.columns.includes(column));
  if (missing.length > 0) {
    return {
      check_id: "duplicate_semantic_key",
      status: "fail",
      severity: "error",
      message: `Semantic key columns are missing: ${missing.join(", ")}.`,
      affected_rows: missing.length,
      metadata: { semantic_key_columns: semanticKeyColumns, missing },
    };
  }
  const seen = new Set<string>();
  let duplicates = 0;
  for (const row of parsed.rows) {
    const key = semanticKeyColumns.map((column) => row[column] ?? "").join("\u001f");
    if (seen.has(key)) duplicates += 1;
    seen.add(key);
  }
  return check(
    "duplicate_semantic_key",
    duplicates === 0,
    "No duplicate semantic keys detected.",
    `Duplicate semantic keys detected across ${duplicates} row(s).`,
    duplicates || undefined,
    { semantic_key_columns: semanticKeyColumns },
  );
}

function check(
  checkId: string,
  ok: boolean,
  okMessage: string,
  failMessage: string,
  affectedRows?: number,
  metadata: Record<string, unknown> = {},
): ImportQualityCheck {
  return ImportQualityCheck.parse({
    check_id: checkId,
    status: ok ? "pass" : "fail",
    severity: ok ? "info" : "error",
    message: ok ? okMessage : failMessage,
    affected_rows: affectedRows,
    metadata,
  });
}

function summarizeChecks(checks: ImportQualityCheck[]): ImportQualityStatus {
  if (checks.some((item) => item.status === "fail")) return "fail";
  if (checks.some((item) => item.status === "warn")) return "warn";
  return "pass";
}

function claimLimitsFor(objectType: ImportObjectType): string[] {
  const limits = [
    "CSV/manual imports provide source-data provenance only; they do not prove incremental lift.",
    "Platform-attributed conversions and ROAS are directional until reconciled against first-party outcomes or a pre-registered experiment.",
  ];
  if (objectType === "conversion_event" || objectType === "order" || objectType === "payment") {
    limits.push(
      "First-party conversion rows support revenue reconciliation, but not incrementality without an experiment design.",
    );
  }
  return limits;
}

function stripBom(value: string): string {
  return value.charCodeAt(0) === 0xfeff ? value.slice(1) : value;
}

function parseCsvText(text: string): {
  rows: string[][];
  issues: Array<{ row: number; message: string }>;
} {
  const rows: string[][] = [];
  const issues: Array<{ row: number; message: string }> = [];
  let row: string[] = [];
  let cell = "";
  let inQuotes = false;
  let rowNumber = 1;

  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i]!;
    const next = text[i + 1];
    if (inQuotes) {
      if (ch === '"' && next === '"') {
        cell += '"';
        i += 1;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        cell += ch;
      }
      continue;
    }

    if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      row.push(cell);
      cell = "";
    } else if (ch === "\n") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
      rowNumber += 1;
    } else if (ch === "\r") {
      if (next === "\n") continue;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
      rowNumber += 1;
    } else {
      cell += ch;
    }
  }

  if (inQuotes) {
    issues.push({ row: rowNumber, message: "unclosed quoted field" });
  }
  if (cell.length > 0 || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  return { rows, issues };
}

function sha256Json(value: unknown): string {
  return createHash("sha256").update(canonicalize(value)).digest("hex");
}

function canonicalize(value: unknown): string {
  if (value === null || value === undefined) return "null";
  if (typeof value === "number" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => canonicalize(item)).join(",")}]`;
  if (typeof value === "object") {
    const obj = value as Record<string, unknown>;
    return `{${Object.keys(obj)
      .sort()
      .filter((key) => obj[key] !== undefined)
      .map((key) => `${JSON.stringify(key)}:${canonicalize(obj[key])}`)
      .join(",")}}`;
  }
  throw new Error(`unsupported JSON value type: ${typeof value}`);
}
