import { z } from "zod";
import { Platform } from "./account.js";

/** Raw daily campaign performance as imported from a platform (bronze/silver). */
export const CampaignDailyMetric = z.object({
  date: z.string(), // YYYY-MM-DD
  account_id: z.string(),
  campaign_id: z.string(),
  platform: Platform,
  spend: z.number().nonnegative(),
  impressions: z.number().nonnegative(),
  clicks: z.number().nonnegative(),
  conversions: z.number().nonnegative(),
  /** Platform-attributed revenue. Directional, NOT causal. */
  platform_revenue: z.number().nonnegative(),
  raw: z.record(z.unknown()).optional(),
});
export type CampaignDailyMetric = z.infer<typeof CampaignDailyMetric>;

export const CreativeDailyMetric = z.object({
  date: z.string(),
  creative_id: z.string(),
  campaign_id: z.string(),
  spend: z.number().nonnegative(),
  impressions: z.number().nonnegative(),
  clicks: z.number().nonnegative(),
  conversions: z.number().nonnegative(),
  frequency: z.number().nonnegative().optional(),
});
export type CreativeDailyMetric = z.infer<typeof CreativeDailyMetric>;

/** First-party / warehouse revenue. The truth source for MER and margin. */
export const FirstPartyRevenueDaily = z.object({
  date: z.string(),
  account_id: z.string(),
  revenue: z.number().nonnegative(),
  orders: z.number().nonnegative(),
  gross_margin: z.number().optional(),
});
export type FirstPartyRevenueDaily = z.infer<typeof FirstPartyRevenueDaily>;

/** Derived, normalized metrics consumed by detectors and the impact engine. */
export const NormalizedMetrics = z.object({
  scope: z.enum(["account", "campaign", "creative"]),
  entity_id: z.string(),
  window: z.string(), // e.g. "2026-05-01..2026-05-21"
  spend: z.number().nonnegative(),
  clicks: z.number().nonnegative(),
  conversions: z.number().nonnegative(),
  platform_revenue: z.number().nonnegative(),
  first_party_revenue: z.number().nonnegative().nullable(),
  cac: z.number().nullable(), // spend / conversions
  roas: z.number().nullable(), // platform_revenue / spend — directional
  mer: z.number().nullable(), // first_party_revenue / spend
  ctr: z.number().nullable(),
  cvr: z.number().nullable(),
});
export type NormalizedMetrics = z.infer<typeof NormalizedMetrics>;
