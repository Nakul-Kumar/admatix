import { existsSync } from "node:fs";
import { join } from "node:path";
import { findRepoRoot, readJson } from "../paths.js";

export interface CampaignDailyRow {
  date: string;
  account_id: string;
  campaign_id: string;
  spend: number;
  impressions: number;
  clicks: number;
  conversions: number;
  platform_revenue: number;
}

export interface FixtureSnapshot {
  fixture_version: string;
  account_id: string;
  daily: CampaignDailyRow[];
  known_entities: string[];
}

const EMPTY: FixtureSnapshot = {
  fixture_version: "unknown",
  account_id: "unknown",
  daily: [],
  known_entities: [],
};

/**
 * Load the campaign-daily snapshot for a known fixture name. The MVP only
 * recognises "agency-demo"; anything else returns an empty snapshot so the
 * baselines stay deterministic on synthetic tasks that name no fixture.
 */
export function loadFixture(name: string, rootDir?: string): FixtureSnapshot {
  if (name !== "agency-demo") return EMPTY;
  const root = rootDir ?? findRepoRoot();
  const path = join(root, "data", "fixtures", "google_ads", "demo_campaigns.json");
  if (!existsSync(path)) return EMPTY;
  const raw = readJson<{
    fixture_version?: string;
    account?: { account_id?: string };
    campaigns?: { campaign_id: string }[];
    campaign_daily_metrics?: CampaignDailyRow[];
  }>(path);
  return {
    fixture_version: raw.fixture_version ?? "unknown",
    account_id: raw.account?.account_id ?? "unknown",
    daily: Array.isArray(raw.campaign_daily_metrics) ? raw.campaign_daily_metrics : [],
    known_entities: Array.isArray(raw.campaigns) ? raw.campaigns.map((c) => c.campaign_id) : [],
  };
}

export interface SpikeSignal {
  campaign_id: string;
  early_mean_spend: number;
  late_mean_spend: number;
  early_mean_cvr: number;
  late_mean_cvr: number;
  excess_spend: number;
  spike_pct: number;
}

/**
 * Pure, deterministic spend-spike detector. Splits each campaign's daily rows
 * in half, compares mean spend and mean conversion rate, and reports any
 * campaign whose late-half spend rose >= `minSpikePct` while its CVR did not
 * keep pace (>= `cvrTolerancePct` worse than early-half).
 */
export function detectSpendSpikes(
  daily: CampaignDailyRow[],
  opts: { minSpikePct: number; cvrTolerancePct: number },
): SpikeSignal[] {
  const byCampaign = new Map<string, CampaignDailyRow[]>();
  for (const row of daily) {
    const list = byCampaign.get(row.campaign_id) ?? [];
    list.push(row);
    byCampaign.set(row.campaign_id, list);
  }
  const signals: SpikeSignal[] = [];
  for (const [campaignId, rowsUnsorted] of byCampaign) {
    const rows = [...rowsUnsorted].sort((a, b) => a.date.localeCompare(b.date));
    if (rows.length < 4) continue;
    const mid = Math.floor(rows.length / 2);
    const early = rows.slice(0, mid);
    const late = rows.slice(mid);
    const earlyMeanSpend = mean(early.map((r) => r.spend));
    const lateMeanSpend = mean(late.map((r) => r.spend));
    const earlyMeanCvr = safeCvr(early);
    const lateMeanCvr = safeCvr(late);
    if (earlyMeanSpend === 0) continue;
    const spikePct = ((lateMeanSpend - earlyMeanSpend) / earlyMeanSpend) * 100;
    if (spikePct < opts.minSpikePct) continue;
    const cvrDropPct = earlyMeanCvr === 0 ? 0 : ((earlyMeanCvr - lateMeanCvr) / earlyMeanCvr) * 100;
    if (cvrDropPct < opts.cvrTolerancePct) continue;
    const excessSpend = (lateMeanSpend - earlyMeanSpend) * late.length;
    signals.push({
      campaign_id: campaignId,
      early_mean_spend: round(earlyMeanSpend),
      late_mean_spend: round(lateMeanSpend),
      early_mean_cvr: round(earlyMeanCvr, 4),
      late_mean_cvr: round(lateMeanCvr, 4),
      excess_spend: round(excessSpend),
      spike_pct: round(spikePct, 1),
    });
  }
  return signals;
}

function mean(xs: number[]): number {
  if (xs.length === 0) return 0;
  let total = 0;
  for (const x of xs) total += x;
  return total / xs.length;
}

function safeCvr(rows: CampaignDailyRow[]): number {
  let clicks = 0;
  let conversions = 0;
  for (const r of rows) {
    clicks += r.clicks;
    conversions += r.conversions;
  }
  if (clicks === 0) return 0;
  return conversions / clicks;
}

function round(n: number, decimals = 2): number {
  const factor = 10 ** decimals;
  return Math.round(n * factor) / factor;
}
