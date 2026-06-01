import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import type { Command } from "commander";
import {
  ImportManifest,
  readPersistedImportManifest,
  type QueryExecutor,
} from "@admatix/connectors";
import type { CliContext } from "../support.js";
import {
  actionable,
  dbUrlFromRef,
  pgSslConfig,
  writeResult,
} from "../support.js";

export function registerIngestCommand(program: Command, ctx: CliContext): void {
  const ingest = program
    .command("ingest")
    .description("inspect imported live data without promoting it to proof");

  ingest
    .command("audit")
    .description("summarize an import manifest as directional-only H0 input")
    .requiredOption("--manifest <path-or-id>", "manifest JSON path or manifest id")
    .option("--tenant-uuid <uuid>", "tenant UUID for database manifest ids")
    .option("--connection-string-ref <ref>", "database URL reference for manifest ids", "env:SUPABASE_DB_URL")
    .option("--json", "emit machine-readable JSON")
    .action(async (opts: IngestAuditOptions, command: Command) => {
      const result = await auditManifest(opts.manifest, {
        tenantUuid: opts.tenantUuid,
        connectionStringRef: opts.connectionStringRef,
      });
      writeResult(
        command,
        result,
        (value) =>
          [
            `Ingest audit ${value.audit_id}`,
            `Manifest: ${value.manifest_ref}`,
            `Causal status: ${value.causal_status}`,
            `Proof ready: ${value.proof_ready}`,
            `H0 packets emitted: ${value.h0_packets.length}`,
          ].join("\n") + "\n",
        ctx,
      );
    });
}

export interface IngestAuditOptions {
  manifest: string;
  tenantUuid?: string;
  connectionStringRef?: string;
}

interface AuditManifestOptions {
  tenantUuid?: string;
  connectionStringRef?: string;
}

export async function auditManifest(
  manifestRef: string,
  opts: AuditManifestOptions = {},
  client?: QueryExecutor,
) {
  const maybePath = resolve(manifestRef);
  if (!existsSync(maybePath)) {
    return auditPersistedManifest(manifestRef, opts, client);
  }

  const manifest = ImportManifest.parse(JSON.parse(await readFile(maybePath, "utf8")));
  return {
    audit_id: `ingest_audit_${safeId(manifest.manifest_id)}`,
    manifest_ref: manifest.manifest_id,
    status: manifest.quality.status === "fail" ? "blocked_quality_failed" : "directional_ready_for_metrics",
    causal_status: "directional_until_lift_test",
    proof_ready: false,
    imported_rows: manifest.row_count,
    source: manifest.source,
    platform: manifest.platform,
    object_type: manifest.object_type,
    quality: manifest.quality,
    findings: [],
    h0_packets: [],
    claim_limits: claimLimits(),
    next_required_step:
      "Load normalized campaign/conversion metrics, run detectors, and pre-register an experiment before any lift claim.",
  };
}

async function auditPersistedManifest(
  manifestRef: string,
  opts: AuditManifestOptions,
  suppliedClient?: QueryExecutor,
) {
  if (!opts.tenantUuid) {
    throw actionable(
      `Manifest "${manifestRef}" is not a local file path.`,
      "Provide --tenant-uuid to read a persisted import manifest, or pass a local manifest JSON path.",
      2,
      "missing_manifest_reader_options",
      { manifest_ref: manifestRef },
    );
  }

  let client = suppliedClient as (QueryExecutor & { connect?(): Promise<void>; end?(): Promise<void> }) | undefined;
  if (!client) {
    const pg = await import("pg");
    client = new pg.Client({
      connectionString: dbUrlFromRef(opts.connectionStringRef ?? "env:SUPABASE_DB_URL"),
      ssl: pgSslConfig(),
    }) as unknown as QueryExecutor & { connect(): Promise<void>; end(): Promise<void> };
    await client.connect?.();
  }

  try {
    const persisted = await readPersistedImportManifest(client, {
      tenant_uuid: opts.tenantUuid,
      manifest_ref: manifestRef,
    });
    if (!persisted) {
      throw actionable(
        `Import manifest "${manifestRef}" was not found.`,
        "Check the manifest id/key and tenant UUID, then rerun ingest audit.",
        2,
        "import_manifest_not_found",
        { manifest_ref: manifestRef, tenant_uuid: opts.tenantUuid },
      );
    }

    return {
      audit_id: `ingest_audit_${safeId(persisted.manifest.manifest_id)}`,
      manifest_ref: persisted.manifest.manifest_id,
      connector_import_manifest_id: persisted.connector_import_manifest_id,
      manifest_key: persisted.manifest_key,
      status:
        persisted.quality.quality_status === "fail"
          ? "blocked_quality_failed"
          : "directional_ready_for_metrics",
      causal_status: "directional_until_lift_test",
      proof_ready: false,
      imported_rows: persisted.manifest.row_count,
      source: persisted.manifest.source,
      platform: persisted.manifest.platform,
      object_type: persisted.manifest.object_type,
      quality: persisted.quality,
      warehouse_inputs: persisted.warehouse_inputs,
      findings: [],
      h0_packets: [],
      claim_limits: claimLimits(),
      next_required_step:
        "Run detectors over normalized metrics and pre-register an experiment before any lift claim or proof promotion.",
    };
  } finally {
    await client?.end?.();
  }
}

function claimLimits(): string[] {
  return [
    "Ingest audits over imports are directional until a pre-registered lift test exists.",
    "A passing quality manifest is not a proof bundle and must not be shown as live spend lift.",
    "H0 packets from imported data must keep causal_status=directional_until_lift_test until verifier evidence is available.",
  ];
}

function safeId(value: string): string {
  return value.replace(/[^a-zA-Z0-9_:-]/g, "_").slice(0, 48);
}
