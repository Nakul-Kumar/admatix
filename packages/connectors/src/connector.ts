import type {
  Campaign,
  CampaignDailyMetric,
  CreativeDailyMetric,
  FirstPartyRevenueDaily,
  Platform,
  PlatformAccount,
} from "@admatix/schemas";

/**
 * Uniform read-only platform adapter. Every method returns schema-validated
 * data. No write methods exist on this interface — adding one would violate
 * golden rule #3 (dry-run only) and rule #7 (read tools and write tools are
 * separated).
 */
export interface Connector {
  readonly platform: Platform;
  listAccounts(): Promise<PlatformAccount[]>;
  getCampaigns(accountId: string): Promise<Campaign[]>;
  getCampaignDailyMetrics(accountId: string, window: string): Promise<CampaignDailyMetric[]>;
  getCreativeDailyMetrics(accountId: string, window: string): Promise<CreativeDailyMetric[]>;
  getFirstPartyRevenue(accountId: string, window: string): Promise<FirstPartyRevenueDaily[]>;
  healthCheck(): Promise<{ ok: boolean; detail: string }>;
}
