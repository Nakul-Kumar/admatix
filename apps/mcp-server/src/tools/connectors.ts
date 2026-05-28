import {
  CredentialRef,
  googleAdsReadOnlyCapabilities,
  previewConnector,
} from "@admatix/connectors";
import { z } from "@admatix/schemas";
import {
  okEnvelope,
  traceFor,
} from "./common.js";

export const ConnectorCapabilitiesInput = z.object({
  platform: z.enum(["google_ads", "meta_ads", "shopify", "stripe", "ga4"]).default("google_ads"),
}).strict();
export type ConnectorCapabilitiesInput = z.infer<typeof ConnectorCapabilitiesInput>;

export const ConnectorPreviewInput = z.object({
  platform: z.literal("google_ads"),
  cassette_path: z.string().optional(),
  credential_ref: CredentialRef.optional(),
  developer_token_ref: CredentialRef.optional(),
  account_id: z.string().optional(),
  window: z.string().optional(),
  object_type: z.enum(["platform_report", "campaign", "account"]).default("platform_report"),
  sync_type: z.enum(["account_discovery", "entity_snapshot", "performance_report"]).default("performance_report"),
}).strict();
export type ConnectorPreviewInput = z.infer<typeof ConnectorPreviewInput>;

export async function connectorCapabilitiesTool(input: unknown) {
  const parsed = ConnectorCapabilitiesInput.parse(input);
  const data =
    parsed.platform === "google_ads"
      ? {
          platform: parsed.platform,
          status: "available",
          capabilities: googleAdsReadOnlyCapabilities,
          claim_limits: [
            "Capabilities describe allowed read paths only; they do not imply live credentials are connected.",
            "Google Ads uses a broad adwords OAuth scope, so AdMatix enforces read-only behavior in code.",
          ],
        }
      : {
          platform: parsed.platform,
          status: "planned",
          capabilities: null,
          claim_limits: [
            "This connector is roadmap-only until a cassette and read-only adapter are implemented.",
          ],
        };
  return okEnvelope({
    trace_id: traceFor("connector_capabilities", parsed),
    source_refs: [`connector:${parsed.platform}`],
    data,
  });
}

export async function connectorPreviewTool(input: unknown) {
  const parsed = ConnectorPreviewInput.parse(input);
  const result = await previewConnector({
    request_id: `req_mcp_${traceFor("connector_preview", parsed).slice(-16)}`,
    tenant_id: "tenant_demo",
    platform: parsed.platform,
    source_kind: "oauth_readonly",
    object_type: parsed.object_type,
    sync_type: parsed.sync_type,
    account_id: parsed.account_id,
    window: parsed.window,
    dry_run_only: true,
    params: {},
    cassette_path: parsed.cassette_path,
    credential_ref: parsed.credential_ref,
    developer_token_ref: parsed.developer_token_ref,
  });
  return okEnvelope({
    trace_id: traceFor("connector_preview", parsed),
    source_refs: [result.source_ref],
    data: result,
  });
}
