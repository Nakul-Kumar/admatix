import { createHash } from "node:crypto";
import { Campaign, CampaignDailyMetric, PlatformAccount } from "@admatix/schemas";
import {
  assertReadOnlyCapabilities,
  type ConnectorReadRequest,
  type ReadOnlyConnectorCapabilities,
} from "./read-contract.js";
import { parseCredentialRef, type CredentialResolver, type CredentialRef } from "./credential-ref.js";
import { type HttpTransport } from "./http-transport.js";

export const GOOGLE_ADS_API_VERSION = "v20";
export const GOOGLE_ADS_REPORTING_SCOPE = "https://www.googleapis.com/auth/adwords";

export const googleAdsReadOnlyCapabilities: ReadOnlyConnectorCapabilities =
  assertReadOnlyCapabilities({
    connector_id: "google_ads_readonly",
    connector_version: "0.1.0",
    source_kind: "oauth_readonly",
    platform: "google_ads",
    supported_sync_types: ["account_discovery", "entity_snapshot", "performance_report"],
    supported_object_types: ["account", "campaign", "platform_report"],
    api_version: GOOGLE_ADS_API_VERSION,
    scopes: [GOOGLE_ADS_REPORTING_SCOPE],
    methods: ["listAccessibleCustomers", "searchCampaignMetrics", "searchCampaignSnapshots"],
    notes: [
      "Google Ads exposes a broad adwords OAuth scope; AdMatix enforces read-only by allowing only search/reporting calls.",
    ],
  });

export interface GoogleAdsPreviewOptions {
  readonly request: ConnectorReadRequest;
  readonly transport: HttpTransport;
  readonly credential_ref?: CredentialRef;
  readonly developer_token_ref?: CredentialRef;
  readonly credentialResolver?: CredentialResolver;
}

export interface GoogleAdsPreviewRows {
  readonly campaigns: Campaign[];
  readonly metrics: CampaignDailyMetric[];
  readonly accounts: PlatformAccount[];
  readonly checksum_sha256: string;
}

export async function previewGoogleAds(options: GoogleAdsPreviewOptions): Promise<GoogleAdsPreviewRows> {
  const request = options.request;
  if (request.platform !== "google_ads") {
    throw new Error(`google ads preview received platform ${request.platform}`);
  }
  if (options.credential_ref && options.credentialResolver) {
    await options.credentialResolver.resolve(parseCredentialRef(options.credential_ref));
  }
  if (options.developer_token_ref && options.credentialResolver) {
    await options.credentialResolver.resolve(parseCredentialRef(options.developer_token_ref));
  }
  const customerId = normalizeCustomerId(request.account_id ?? "customers/0000000000");
  const response = await options.transport.request({
    method: "POST",
    url: `https://googleads.googleapis.com/${GOOGLE_ADS_API_VERSION}/${customerId}/googleAds:searchStream`,
    query_name: "google_ads_campaign_metrics",
    body: { query: campaignMetricsQuery(request.window) },
  });
  if (response.status < 200 || response.status >= 300) {
    throw new Error(`google ads preview failed with status ${response.status}`);
  }
  const rows = extractRows(response.body);
  const metrics = rows.map(mapMetricRow);
  const campaignMap = new Map<string, Campaign>();
  for (const row of rows) {
    const campaign = mapCampaignRow(row);
    campaignMap.set(campaign.campaign_id, campaign);
  }
  const account = PlatformAccount.parse({
    account_id: customerId,
    platform: "google_ads",
    tenant_id: request.tenant_id,
    name: customerId,
    currency: "USD",
    timezone: "UTC",
  });
  const normalized = {
    campaigns: Array.from(campaignMap.values()).sort((a, b) => a.campaign_id.localeCompare(b.campaign_id)),
    metrics,
    accounts: [account],
  };
  return {
    ...normalized,
    checksum_sha256: createHash("sha256").update(JSON.stringify(normalized)).digest("hex"),
  };
}

function campaignMetricsQuery(window?: string): string {
  const [start, end] = (window ?? "2026-05-01..2026-05-07").split("..");
  return [
    "SELECT",
    "segments.date, customer.id, customer.descriptive_name, campaign.id, campaign.name, campaign.status,",
    "metrics.cost_micros, metrics.impressions, metrics.clicks, metrics.conversions, metrics.conversions_value",
    "FROM campaign",
    `WHERE segments.date BETWEEN '${start}' AND '${end ?? start}'`,
  ].join(" ");
}

function extractRows(body: unknown): Array<Record<string, unknown>> {
  if (!body || typeof body !== "object") return [];
  const obj = body as Record<string, unknown>;
  const direct = obj["results"];
  if (Array.isArray(direct)) return direct as Array<Record<string, unknown>>;
  if (Array.isArray(body)) {
    return (body as unknown[]).flatMap((chunk) => {
      if (chunk && typeof chunk === "object" && Array.isArray((chunk as Record<string, unknown>)["results"])) {
        return (chunk as Record<string, unknown>)["results"] as Array<Record<string, unknown>>;
      }
      return [];
    });
  }
  return [];
}

function mapMetricRow(row: Record<string, unknown>): CampaignDailyMetric {
  const segments = record(row["segments"]);
  const customer = record(row["customer"]);
  const campaign = record(row["campaign"]);
  const metrics = record(row["metrics"]);
  const accountId = String(customer["id"] ?? "unknown");
  const campaignId = String(campaign["id"] ?? "unknown");
  return CampaignDailyMetric.parse({
    date: String(segments["date"] ?? "1970-01-01"),
    account_id: normalizeCustomerId(accountId),
    campaign_id: campaignId,
    platform: "google_ads",
    spend: Number(metrics["costMicros"] ?? metrics["cost_micros"] ?? 0) / 1_000_000,
    impressions: Number(metrics["impressions"] ?? 0),
    clicks: Number(metrics["clicks"] ?? 0),
    conversions: Number(metrics["conversions"] ?? 0),
    platform_revenue: Number(metrics["conversionsValue"] ?? metrics["conversions_value"] ?? 0),
    raw: row,
  });
}

function mapCampaignRow(row: Record<string, unknown>): Campaign {
  const customer = record(row["customer"]);
  const campaign = record(row["campaign"]);
  const campaignId = String(campaign["id"] ?? "unknown");
  return Campaign.parse({
    campaign_id: campaignId,
    account_id: normalizeCustomerId(String(customer["id"] ?? "unknown")),
    platform: "google_ads",
    name: String(campaign["name"] ?? campaignId),
    status: statusOf(String(campaign["status"] ?? "active")),
    raw: row,
  });
}

function normalizeCustomerId(value: string): string {
  return value.startsWith("customers/") ? value : `customers/${value}`;
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function statusOf(value: string): "active" | "paused" | "removed" | "draft" {
  const lower = value.toLowerCase();
  if (lower.includes("pause")) return "paused";
  if (lower.includes("remove")) return "removed";
  if (lower.includes("draft")) return "draft";
  return "active";
}
