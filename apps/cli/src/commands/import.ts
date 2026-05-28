import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import type { Command } from "commander";
import {
  buildCsvImportManifest,
  persistCsvImport,
  type ImportObjectTypeT,
  type QueryExecutor,
} from "@admatix/connectors";
import type { Platform } from "@admatix/schemas";
import type { CliContext } from "../support.js";
import {
  DEFAULT_TENANT,
  actionable,
  stableJson,
  writeResult,
} from "../support.js";

export function registerImportCommand(program: Command, ctx: CliContext): void {
  const importCommand = program
    .command("import")
    .description("preview or persist a read-only CSV/manual export import");

  addImportOptions(importCommand.command("preview", { isDefault: true }).description("emit a provenance manifest without database writes"))
    .action(async (opts: ImportCommandOptions, command: Command) => {
      await previewImport(opts, command, ctx);
    });

  addImportOptions(importCommand.command("persist").description("dry-run or persist a CSV/manual export into warehouse raw tables"))
    .requiredOption("--tenant-uuid <uuid>", "tenant UUID already present in app.tenants")
    .option("--connection-string-ref <ref>", "database URL reference, e.g. env:SUPABASE_DB_URL", "env:SUPABASE_DB_URL")
    .option("--storage-uri <uri>", "immutable bronze storage URI for the source object")
    .option("--imported-by <actor>", "operator/service identity for the import manifest")
    .option("--dry-run", "plan persistence without database writes")
    .option("--confirm", "perform database writes; still idempotent and quality-gated")
    .action(async (opts: ImportCommandOptions & PersistCommandOptions, command: Command) => {
      requireImportOptions(opts);
      const filePath = resolve(opts.file);
      const raw = await readFile(filePath);
      let client: (QueryExecutor & { connect(): Promise<void>; end(): Promise<void> }) | undefined;
      if (opts.confirm) {
        const pg = await import("pg");
        client = new pg.Client({
          connectionString: dbUrlFromRef(opts.connectionStringRef),
          ssl: pgSslConfig(),
        }) as unknown as QueryExecutor & { connect(): Promise<void>; end(): Promise<void> };
        await client.connect();
      }
      try {
        const result = await persistCsvImport(
          raw,
          {
            tenant_id: opts.tenant,
            tenant_uuid: opts.tenantUuid,
            source: opts.source,
            source_kind: opts.sourceKind,
            platform: opts.platform,
            object_type: opts.objectType,
            account_id: opts.account,
            file_name: filePath,
            required_columns: splitCsvOption(opts.requiredColumns),
            semantic_key_columns: splitCsvOption(opts.semanticKey),
            storage_uri: opts.storageUri,
            imported_by: opts.importedBy,
            confirm: opts.confirm === true,
          },
          client,
        );
        writeResult(
          command,
          result,
          (r) =>
            [
              `Import persistence ${r.manifest.manifest_id}`,
              `Dry run: ${r.dry_run}`,
              `Already imported: ${r.already_imported}`,
              `Quality blocked: ${r.quality_blocked}`,
              `Raw rows total: ${r.raw_rows_total}`,
              `Raw rows inserted: ${r.raw_rows_inserted}`,
            ].join("\n") + "\n",
          ctx,
        );
        if (result.quality_blocked) {
          throw actionable(
            `Import quality failed for "${filePath}".`,
            "Fix the failed checks before persisting this import.",
            1,
            "import_quality_failed",
            { manifest_id: result.manifest.manifest_id, checks: result.manifest.quality.checks },
          );
        }
      } finally {
        await client?.end();
      }
    });
}

function addImportOptions(command: Command): Command {
  return command
    .description(command.description() || "preview a read-only CSV/manual export import and emit a provenance manifest")
    .option("--file <path>", "CSV/manual export file to inspect")
    .option("--source <name>", "source label, e.g. google_ads_export")
    .option("--platform <platform>", "platform, e.g. google_ads, meta_ads, first_party")
    .option("--object-type <type>", "object type, e.g. platform_report, conversion_event", "platform_report")
    .option("--source-kind <kind>", "source kind: csv_upload | manual_export | api_pull | oauth_readonly | platform_mcp | fixture", "manual_export")
    .option("--tenant <id>", "tenant id/ref for the manifest", DEFAULT_TENANT)
    .option("--account <id>", "source account id/ref")
    .option("--required-columns <csv>", "comma-separated columns required for the import")
    .option("--semantic-key <csv>", "comma-separated columns used for duplicate detection")
    .option("--out <path>", "write the manifest JSON to a file")
    .option("--json", "emit machine-readable JSON");
}

async function previewImport(
  opts: ImportCommandOptions,
  command: Command,
  ctx: CliContext,
): Promise<void> {
  requireImportOptions(opts);
  const filePath = resolve(opts.file);
  const raw = await readFile(filePath);
  const manifest = buildCsvImportManifest(raw, {
    tenant_id: opts.tenant,
    source: opts.source,
    source_kind: opts.sourceKind,
    platform: opts.platform,
    object_type: opts.objectType,
    account_id: opts.account,
    file_name: filePath,
    required_columns: splitCsvOption(opts.requiredColumns),
    semantic_key_columns: splitCsvOption(opts.semanticKey),
  });

  if (opts.out) {
    const outPath = resolve(opts.out);
    await mkdir(dirname(outPath), { recursive: true });
    await writeFile(outPath, `${stableJson(manifest)}\n`, "utf8");
  }

  writeResult(
    command,
    manifest,
    (m) =>
      [
        `Import manifest ${m.manifest_id}`,
        `Source: ${m.source}`,
        `Platform: ${m.platform}`,
        `Object type: ${m.object_type}`,
        `Rows: ${m.row_count}`,
        `Checksum: ${m.checksum_sha256}`,
        `Quality: ${m.quality.status}`,
        ...m.quality.checks
          .filter((check) => check.status !== "pass")
          .map((check) => `- [${check.status}] ${check.check_id}: ${check.message}`),
      ].join("\n") + "\n",
    ctx,
  );

  if (manifest.quality.status === "fail") {
    throw actionable(
      `Import quality failed for "${filePath}".`,
      "Fix the failed checks in the emitted manifest before promoting this import into evidence.",
      1,
      "import_quality_failed",
      { manifest_id: manifest.manifest_id, checks: manifest.quality.checks },
    );
  }
}

function requireImportOptions(opts: ImportCommandOptions): void {
  const missing = ["file", "source", "platform"].filter((key) => !opts[key as keyof ImportCommandOptions]);
  if (missing.length > 0) {
    throw actionable(
      `Missing required import option(s): ${missing.join(", ")}.`,
      "Provide --file, --source, and --platform.",
      2,
      "missing_import_options",
      { missing },
    );
  }
}

interface ImportCommandOptions {
  file: string;
  source: string;
  platform: Platform;
  objectType: ImportObjectTypeT;
  sourceKind: "csv_upload" | "manual_export" | "api_pull" | "oauth_readonly" | "platform_mcp" | "fixture";
  tenant: string;
  account?: string;
  requiredColumns?: string;
  semanticKey?: string;
  out?: string;
}

interface PersistCommandOptions {
  tenantUuid: string;
  connectionStringRef: string;
  storageUri?: string;
  importedBy?: string;
  dryRun?: boolean;
  confirm?: boolean;
}

function splitCsvOption(value?: string): string[] {
  if (!value) return [];
  return value
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

function dbUrlFromRef(ref: string): string {
  if (!ref.startsWith("env:")) {
    throw actionable(
      `Unsupported database URL reference "${ref}".`,
      "Use an environment reference such as env:SUPABASE_DB_URL; raw database URLs are intentionally rejected.",
      2,
      "unsupported_database_ref",
      { ref_kind: ref.split(":")[0] ?? "unknown" },
    );
  }
  const name = ref.slice("env:".length);
  const value = process.env[name];
  if (!value) {
    throw actionable(
      `Database URL environment variable "${name}" is missing.`,
      "Set the environment variable locally or use --dry-run.",
      2,
      "missing_database_ref",
      { env: name },
    );
  }
  return value;
}

function pgSslConfig(): { rejectUnauthorized: boolean } | undefined {
  if (["0", "false", "off", "no"].includes((process.env["ADMATIX_DB_SSL"] ?? "").toLowerCase())) {
    return undefined;
  }
  return { rejectUnauthorized: false };
}
