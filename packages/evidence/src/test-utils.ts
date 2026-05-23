import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { normalizeMetrics } from "@admatix/core";
import {
  Campaign,
  CampaignDailyMetric,
  CreativeDailyMetric,
  FirstPartyRevenueDaily,
  PlatformAccount,
  z,
} from "@admatix/schemas";
import type { CampaignDailyMetric as CampaignDailyMetricT } from "@admatix/schemas";
import type { DetectorInput } from "./index.js";

const FixtureFile = z.object({
  account: PlatformAccount,
  campaigns: z.array(Campaign),
  campaign_daily_metrics: z.array(CampaignDailyMetric).optional(),
  creative_daily_metrics: z.array(CreativeDailyMetric).optional(),
});

const FirstPartyFixture = z.object({
  first_party_revenue_daily: z.array(FirstPartyRevenueDaily),
});

interface SupplyPathFixture {
  account: z.infer<typeof PlatformAccount>;
  campaigns: z.infer<typeof Campaign>[];
  programmatic_supply_paths: Array<{
    date: string;
    account_id: string;
    campaign_id: string;
    seller_id: string;
    seller_name: string;
    spend: number;
    impressions: number;
    viewability: number;
    mfa_flag: boolean;
    ivt_rate: number;
  }>;
}

export function loadCampaignInput(
  platform: "google_ads",
  filename: string,
  firstPartyFilename = "demo_orders.json",
): DetectorInput {
  const fixture = FixtureFile.parse(readJson(`data/fixtures/${platform}/${filename}`));
  const firstParty = FirstPartyFixture.parse(
    readJson(`data/fixtures/first_party/${firstPartyFilename}`),
  ).first_party_revenue_daily.filter((row) => row.account_id === fixture.account.account_id);
  const daily = fixture.campaign_daily_metrics ?? [];
  return {
    account: fixture.account,
    campaigns: fixture.campaigns,
    daily,
    firstParty,
    metrics: normalizeMetrics(daily, firstParty, {
      scope: "campaign",
      window: deriveWindow(daily),
    }),
  };
}

export function loadCreativeInput(filename: string): DetectorInput {
  const fixture = FixtureFile.parse(readJson(`data/fixtures/meta_ads/${filename}`));
  const daily = (fixture.creative_daily_metrics ?? []).map((row): CampaignDailyMetricT =>
    CampaignDailyMetric.parse({
      date: row.date,
      account_id: fixture.account.account_id,
      campaign_id: row.campaign_id,
      platform: fixture.account.platform,
      spend: row.spend,
      impressions: row.impressions,
      clicks: row.clicks,
      conversions: row.conversions,
      platform_revenue: row.conversions * 100,
      raw: {
        creative_id: row.creative_id,
        frequency: row.frequency,
      },
    }),
  );
  return {
    account: fixture.account,
    campaigns: fixture.campaigns,
    daily,
    firstParty: [],
    metrics: normalizeMetrics(daily, [], {
      scope: "campaign",
      window: deriveWindow(daily),
    }),
  };
}

export function loadSupplyInput(filename: string): DetectorInput {
  const fixture = readJson(`data/fixtures/dv360/${filename}`) as SupplyPathFixture;
  const account = PlatformAccount.parse(fixture.account);
  const campaigns = fixture.campaigns.map((campaign) => Campaign.parse(campaign));
  const daily = fixture.programmatic_supply_paths.map((row): CampaignDailyMetricT =>
    CampaignDailyMetric.parse({
      date: row.date,
      account_id: row.account_id,
      campaign_id: row.campaign_id,
      platform: account.platform,
      spend: row.spend,
      impressions: row.impressions,
      clicks: Math.round(row.impressions * 0.001),
      conversions: 0,
      platform_revenue: 0,
      raw: {
        seller_id: row.seller_id,
        seller_name: row.seller_name,
        viewability: row.viewability,
        mfa_flag: row.mfa_flag,
        ivt_rate: row.ivt_rate,
      },
    }),
  );
  return {
    account,
    campaigns,
    daily,
    firstParty: [],
    metrics: normalizeMetrics(daily, [], {
      scope: "campaign",
      window: deriveWindow(daily),
    }),
  };
}

export function cloneInput(input: DetectorInput): DetectorInput {
  return structuredClone(input) as DetectorInput;
}

function readJson(pathFromRoot: string): unknown {
  return JSON.parse(readFileSync(join(repoRoot(), pathFromRoot), "utf8")) as unknown;
}

function deriveWindow(rows: CampaignDailyMetricT[]): string {
  const dates = rows.map((row) => row.date).sort();
  const first = dates[0] ?? "unknown";
  const last = dates.at(-1) ?? "unknown";
  return `${first}..${last}`;
}

function repoRoot(): string {
  let dir = process.cwd();
  for (let i = 0; i < 8; i += 1) {
    if (existsSync(join(dir, "data", "fixtures"))) return dir;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error("Could not locate repo root with data/fixtures.");
}
