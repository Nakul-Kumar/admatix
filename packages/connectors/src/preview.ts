import { createHash } from "node:crypto";
import { z } from "@admatix/schemas";
import {
  ConnectorReadRequest,
  ConnectorSyncType,
} from "./read-contract.js";
import {
  ImportObjectType,
  ConnectorSourceKind,
} from "./import-manifest.js";
import { CredentialRef, redactCredentialRef } from "./credential-ref.js";
import { createCassetteTransport, loadConnectorCassette } from "./cassette-transport.js";
import { googleAdsReadOnlyCapabilities, previewGoogleAds } from "./google-ads-readonly.js";

export const ConnectorPreviewInput = ConnectorReadRequest.extend({
  credential_ref: CredentialRef.optional(),
  developer_token_ref: CredentialRef.optional(),
  cassette_path: z.string().optional(),
  max_rows: z.number().int().positive().max(1000).default(100),
}).strict();
export type ConnectorPreviewInput = z.input<typeof ConnectorPreviewInput>;

export const ConnectorPreviewResult = z.object({
  preview_id: z.string(),
  platform: z.string(),
  source_kind: ConnectorSourceKind,
  object_type: ImportObjectType,
  sync_type: ConnectorSyncType,
  account_id: z.string().optional(),
  window: z.string().optional(),
  row_count: z.number().int().nonnegative(),
  checksum_sha256: z.string().regex(/^[0-9a-f]{64}$/),
  quality: z.object({
    status: z.enum(["pass", "warn", "fail"]),
    checks: z.array(z.object({
      check_id: z.string(),
      status: z.enum(["pass", "warn", "fail"]),
      message: z.string(),
    })),
  }),
  source: z.string(),
  credential_ref: z.string().optional(),
  cassette_path: z.string().optional(),
  origin: z.object({
    kind: z.literal("preview"),
    source: z.string(),
  }),
  proof_ready: z.literal(false),
  causal_status: z.literal("directional_until_lift_test"),
  source_ref: z.string(),
  claim_limits: z.array(z.string()),
  diagnostics: z.record(z.unknown()).default({}),
});
export type ConnectorPreviewResult = z.infer<typeof ConnectorPreviewResult>;

export async function previewConnector(input: ConnectorPreviewInput): Promise<ConnectorPreviewResult> {
  const parsed = ConnectorPreviewInput.parse(input);
  if (parsed.platform !== "google_ads") {
    return unsupportedPreview(parsed, `platform ${parsed.platform} is not implemented yet`);
  }
  if (!parsed.cassette_path) {
    return credentialReadyPreview(parsed);
  }
  const cassette = await loadConnectorCassette(parsed.cassette_path);
  const transport = createCassetteTransport(cassette);
  const rows = await previewGoogleAds({
    request: parsed,
    transport,
    credential_ref: parsed.credential_ref,
    developer_token_ref: parsed.developer_token_ref,
  });
  const rowCount =
    parsed.object_type === "campaign" ? rows.campaigns.length : rows.metrics.length;
  const checksum = rows.checksum_sha256;
  return ConnectorPreviewResult.parse({
    preview_id: `preview_${sha256Json({ parsed, checksum }).slice(0, 16)}`,
    platform: parsed.platform,
    source_kind: parsed.source_kind,
    object_type: parsed.object_type,
    sync_type: parsed.sync_type,
    account_id: parsed.account_id,
    window: parsed.window,
    row_count: rowCount,
    checksum_sha256: checksum,
    quality: {
      status: rowCount > 0 ? "pass" : "fail",
      checks: [
        {
          check_id: "rows_available",
          status: rowCount > 0 ? "pass" : "fail",
          message: rowCount > 0 ? `Preview returned ${rowCount} row(s).` : "Preview returned no rows.",
        },
        {
          check_id: "read_only_capabilities",
          status: "pass",
          message: "Connector declares read-only preview capabilities.",
        },
      ],
    },
    source: googleAdsReadOnlyCapabilities.connector_id,
    credential_ref: parsed.credential_ref ? redactCredentialRef(parsed.credential_ref) : undefined,
    cassette_path: parsed.cassette_path,
    origin: {
      kind: "preview",
      source: "sanitized_cassette",
    },
    proof_ready: false,
    causal_status: "directional_until_lift_test",
    source_ref: `cassette:${parsed.cassette_path}`,
    claim_limits: claimLimits(),
    diagnostics: {
      api_version: cassette.api_version,
      query_name: cassette.query_name,
      capabilities: googleAdsReadOnlyCapabilities,
      sample_campaign_count: rows.campaigns.length,
    },
  });
}

function credentialReadyPreview(parsed: ConnectorPreviewInput): ConnectorPreviewResult {
  const hasCredential = Boolean(parsed.credential_ref);
  const checksum = sha256Json({
    platform: parsed.platform,
    account_id: parsed.account_id,
    window: parsed.window,
    credential_ref: parsed.credential_ref ? redactCredentialRef(parsed.credential_ref) : undefined,
  });
  return ConnectorPreviewResult.parse({
    preview_id: `preview_${checksum.slice(0, 16)}`,
    platform: parsed.platform,
    source_kind: parsed.source_kind,
    object_type: parsed.object_type,
    sync_type: parsed.sync_type,
    account_id: parsed.account_id,
    window: parsed.window,
    row_count: 0,
    checksum_sha256: checksum,
    quality: {
      status: hasCredential ? "warn" : "fail",
      checks: [
        {
          check_id: hasCredential ? "no_network_call_made" : "credential_ref_present",
          status: hasCredential ? "pass" : "fail",
          message: hasCredential
            ? "Credential reference is present, but this preview stopped before network access. Operator-gated live smoke requires an explicit live transport."
            : "Provide a cassette path or credential reference.",
        },
      ],
    },
    source: googleAdsReadOnlyCapabilities.connector_id,
    credential_ref: parsed.credential_ref ? redactCredentialRef(parsed.credential_ref) : undefined,
    origin: {
      kind: "preview",
      source: "credential_ref_only",
    },
    proof_ready: false,
    causal_status: "directional_until_lift_test",
    source_ref: parsed.credential_ref
      ? `credential:${redactCredentialRef(parsed.credential_ref)}`
      : "credential:missing",
    claim_limits: claimLimits(),
    diagnostics: {
      live_smoke_ready: hasCredential,
      api_version: googleAdsReadOnlyCapabilities.api_version,
      no_network_call_made: true,
    },
  });
}

function unsupportedPreview(parsed: ConnectorPreviewInput, message: string): ConnectorPreviewResult {
  const checksum = sha256Json({ parsed, message });
  return ConnectorPreviewResult.parse({
    preview_id: `preview_${checksum.slice(0, 16)}`,
    platform: parsed.platform,
    source_kind: parsed.source_kind,
    object_type: parsed.object_type,
    sync_type: parsed.sync_type,
    account_id: parsed.account_id,
    window: parsed.window,
    row_count: 0,
    checksum_sha256: checksum,
    quality: {
      status: "fail",
      checks: [{ check_id: "connector_implemented", status: "fail", message }],
    },
    source: "unsupported_connector",
    origin: {
      kind: "preview",
      source: "unsupported_connector",
    },
    proof_ready: false,
    causal_status: "directional_until_lift_test",
    source_ref: "unsupported_connector",
    claim_limits: claimLimits(),
    diagnostics: {},
  });
}

function claimLimits(): string[] {
  return [
    "Connector previews prove only read-only access shape and source provenance; they do not prove incremental lift.",
    "Platform-attributed conversions and ROAS remain directional until reconciled against first-party outcomes or a pre-registered experiment.",
    "Preview output must not be promoted to dashboard proof bundles without H0, policy, approval, measurement, and claim-limit gates.",
  ];
}

function sha256Json(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(sortJson(value))).digest("hex");
}

function sortJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortJson);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, v]) => v !== undefined)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => [k, sortJson(v)]),
    );
  }
  return value;
}
