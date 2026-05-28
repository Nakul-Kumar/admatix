import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import type { Command } from "commander";
import { ImportManifest } from "@admatix/connectors";
import type { CliContext } from "../support.js";
import { writeResult } from "../support.js";

export function registerIngestCommand(program: Command, ctx: CliContext): void {
  const ingest = program
    .command("ingest")
    .description("inspect imported live data without promoting it to proof");

  ingest
    .command("audit")
    .description("summarize an import manifest as directional-only H0 input")
    .requiredOption("--manifest <path-or-id>", "manifest JSON path or manifest id")
    .option("--json", "emit machine-readable JSON")
    .action(async (opts: { manifest: string }, command: Command) => {
      const result = await auditManifest(opts.manifest);
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

async function auditManifest(manifestRef: string) {
  const maybePath = resolve(manifestRef);
  if (!existsSync(maybePath)) {
    return {
      audit_id: `ingest_audit_${safeId(manifestRef)}`,
      manifest_ref: manifestRef,
      status: "blocked_pending_manifest_reader",
      causal_status: "directional_until_lift_test",
      proof_ready: false,
      findings: [],
      h0_packets: [],
      claim_limits: claimLimits(),
      next_required_step:
        "Provide a local manifest JSON path or wire a database manifest reader before running detectors.",
    };
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
