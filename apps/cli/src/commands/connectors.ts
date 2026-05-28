import type { Command } from "commander";
import {
  googleAdsReadOnlyCapabilities,
  previewConnector,
} from "@admatix/connectors";
import type { CliContext } from "../support.js";
import {
  DEFAULT_TENANT,
  stableJson,
  writeResult,
} from "../support.js";

export function registerConnectorsCommand(program: Command, ctx: CliContext): void {
  const connectors = program
    .command("connectors")
    .description("preview read-only ad platform connector access without mutating accounts");

  connectors
    .command("capabilities")
    .description("show read-only connector capabilities")
    .requiredOption("--platform <platform>", "connector platform, e.g. google_ads")
    .option("--json", "emit machine-readable JSON")
    .action(async (opts: { platform: string }, command: Command) => {
      const result =
        opts.platform === "google_ads"
          ? {
              platform: opts.platform,
              status: "available",
              capabilities: googleAdsReadOnlyCapabilities,
              claim_limits: [
                "Capabilities describe allowed read paths only; they do not imply live credentials are connected.",
                "Google Ads uses a broad adwords OAuth scope, so AdMatix enforces read-only behavior in code.",
              ],
            }
          : {
              platform: opts.platform,
              status: "planned",
              capabilities: null,
              claim_limits: [
                "This connector is roadmap-only until a cassette and read-only adapter are implemented.",
              ],
            };
      writeResult(command, result, (value) => `${stableJson(value)}\n`, ctx);
    });

  connectors
    .command("preview")
    .description("run a read-only connector preview from a sanitized cassette or credential reference")
    .requiredOption("--platform <platform>", "connector platform, e.g. google_ads")
    .option("--cassette <path>", "sanitized cassette path for offline preview")
    .option("--credential-ref <ref>", "credential reference, e.g. env:ADMATIX_GOOGLE_ADS_TOKEN")
    .option("--developer-token-ref <ref>", "Google Ads developer token reference")
    .option("--account <id>", "platform account/customer id")
    .option("--window <range>", "date range, YYYY-MM-DD..YYYY-MM-DD")
    .option("--tenant <id>", "tenant id/ref for preview metadata", DEFAULT_TENANT)
    .option("--object-type <type>", "object type to preview", "platform_report")
    .option("--sync-type <type>", "sync type to preview", "performance_report")
    .option("--source-kind <kind>", "source kind", "oauth_readonly")
    .option("--json", "emit machine-readable JSON")
    .action(async (opts: ConnectorPreviewCommandOptions, command: Command) => {
      const result = await previewConnector({
        request_id: `req_cli_${Date.now()}`,
        tenant_id: opts.tenant,
        platform: opts.platform,
        source_kind: opts.sourceKind,
        object_type: opts.objectType,
        sync_type: opts.syncType,
        account_id: opts.account,
        window: opts.window,
        dry_run_only: true,
        params: {},
        cassette_path: opts.cassette,
        credential_ref: opts.credentialRef,
        developer_token_ref: opts.developerTokenRef,
      });
      writeResult(
        command,
        result,
        (value) =>
          [
            `Connector preview ${value.preview_id}`,
            `Platform: ${value.platform}`,
            `Rows: ${value.row_count}`,
            `Quality: ${value.quality.status}`,
            `Causal status: ${value.causal_status}`,
            `Proof ready: ${value.proof_ready}`,
          ].join("\n") + "\n",
        ctx,
      );
    });
}

interface ConnectorPreviewCommandOptions {
  platform: "google_ads" | "meta_ads" | "tiktok_ads" | "dv360" | "trade_desk" | "linkedin_ads" | "amazon_ads" | "first_party";
  cassette?: string;
  credentialRef?: string;
  developerTokenRef?: string;
  account?: string;
  window?: string;
  tenant: string;
  objectType: "platform_report" | "campaign" | "account" | "conversion_event" | "order" | "payment" | "unknown";
  syncType: "account_discovery" | "entity_snapshot" | "performance_report" | "conversion_import" | "experiment_import";
  sourceKind: "csv_upload" | "manual_export" | "api_pull" | "oauth_readonly" | "platform_mcp" | "fixture";
}
