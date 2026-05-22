import { z } from "zod";

/** Platforms AdMatix can read from. `first_party` is the truth source for MER. */
export const Platform = z.enum([
  "google_ads",
  "meta_ads",
  "tiktok_ads",
  "dv360",
  "trade_desk",
  "linkedin_ads",
  "amazon_ads",
  "first_party",
]);
export type Platform = z.infer<typeof Platform>;

export const EntityStatus = z.enum(["active", "paused", "removed", "draft"]);
export type EntityStatus = z.infer<typeof EntityStatus>;

/** A connected ad account. `raw` preserves unknown platform fields losslessly. */
export const PlatformAccount = z.object({
  account_id: z.string(),
  platform: Platform,
  tenant_id: z.string(),
  name: z.string(),
  currency: z.string().default("USD"),
  timezone: z.string().default("UTC"),
  raw: z.record(z.unknown()).optional(),
});
export type PlatformAccount = z.infer<typeof PlatformAccount>;

export const Campaign = z.object({
  campaign_id: z.string(),
  account_id: z.string(),
  platform: Platform,
  name: z.string(),
  status: EntityStatus,
  objective: z.string().optional(),
  daily_budget: z.number().nonnegative().optional(),
  lifetime_budget: z.number().nonnegative().optional(),
  start_date: z.string().optional(),
  end_date: z.string().optional(),
  raw: z.record(z.unknown()).optional(),
});
export type Campaign = z.infer<typeof Campaign>;

export const AdGroup = z.object({
  ad_group_id: z.string(),
  campaign_id: z.string(),
  name: z.string(),
  status: EntityStatus,
  raw: z.record(z.unknown()).optional(),
});
export type AdGroup = z.infer<typeof AdGroup>;

export const Creative = z.object({
  creative_id: z.string(),
  campaign_id: z.string(),
  ad_group_id: z.string().optional(),
  format: z.string(),
  headline: z.string().optional(),
  body: z.string().optional(),
  final_url: z.string().optional(),
  created_at: z.string().optional(),
  policy_status: z.string().optional(),
  raw: z.record(z.unknown()).optional(),
});
export type Creative = z.infer<typeof Creative>;

export const Ad = z.object({
  ad_id: z.string(),
  ad_group_id: z.string(),
  campaign_id: z.string(),
  creative_id: z.string().optional(),
  status: EntityStatus,
  raw: z.record(z.unknown()).optional(),
});
export type Ad = z.infer<typeof Ad>;
