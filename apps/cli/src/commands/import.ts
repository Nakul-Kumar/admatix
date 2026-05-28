import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import type { Command } from "commander";
import {
  buildCsvImportManifest,
  type ImportObjectTypeT,
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
  program
    .command("import")
    .description("preview a read-only CSV/manual export import and emit a provenance manifest")
    .requiredOption("--file <path>", "CSV/manual export file to inspect")
    .requiredOption("--source <name>", "source label, e.g. google_ads_export")
    .requiredOption("--platform <platform>", "platform, e.g. google_ads, meta_ads, first_party")
    .option("--object-type <type>", "object type, e.g. platform_report, conversion_event", "platform_report")
    .option("--source-kind <kind>", "source kind: csv_upload | manual_export | api_pull | oauth_readonly | platform_mcp | fixture", "manual_export")
    .option("--tenant <id>", "tenant id/ref for the manifest", DEFAULT_TENANT)
    .option("--account <id>", "source account id/ref")
    .option("--required-columns <csv>", "comma-separated columns required for the import")
    .option("--semantic-key <csv>", "comma-separated columns used for duplicate detection")
    .option("--out <path>", "write the manifest JSON to a file")
    .option("--json", "emit machine-readable JSON")
    .action(async (opts: ImportCommandOptions, command: Command) => {
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
    });
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

function splitCsvOption(value?: string): string[] {
  if (!value) return [];
  return value
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}
