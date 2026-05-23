import {
  CampaignDailyMetric,
  FirstPartyRevenueDaily,
  NormalizedMetrics,
} from "@admatix/schemas";

interface NormalizeOpts {
  scope: "account" | "campaign";
  window: string;
}

interface AggregateAccumulator {
  scope: "account" | "campaign";
  entity_id: string;
  spend: number;
  clicks: number;
  impressions: number;
  conversions: number;
  platform_revenue: number;
}

/**
 * Aggregate raw daily platform rows into windowed `NormalizedMetrics`.
 *
 * Returns one row per campaign **and** one row per account by default. When
 * `opts.scope` is supplied, only rows at that scope are returned. First-party
 * revenue is attached only at the account scope — MER is meaningless at the
 * campaign level because warehouse revenue is not campaign-attributed.
 *
 * The function is deterministic: identical input → byte-identical output.
 */
export function normalizeMetrics(
  rows: CampaignDailyMetric[],
  firstParty?: FirstPartyRevenueDaily[],
  opts?: NormalizeOpts,
): NormalizedMetrics[] {
  const parsedRows = rows.map((r) => CampaignDailyMetric.parse(r));
  const parsedFp = (firstParty ?? []).map((r) => FirstPartyRevenueDaily.parse(r));

  const window = opts?.window ?? deriveWindow(parsedRows, parsedFp);
  const filteredRows = filterByWindow(parsedRows, window);
  const filteredFp = filterFpByWindow(parsedFp, window);

  const campaignAgg = new Map<string, AggregateAccumulator>();
  const accountAgg = new Map<string, AggregateAccumulator>();

  for (const row of filteredRows) {
    addInto(campaignAgg, row.campaign_id, "campaign", row);
    addInto(accountAgg, row.account_id, "account", row);
  }

  const fpByAccount = new Map<string, { revenue: number; orders: number }>();
  for (const r of filteredFp) {
    const cur = fpByAccount.get(r.account_id) ?? { revenue: 0, orders: 0 };
    cur.revenue += r.revenue;
    cur.orders += r.orders;
    fpByAccount.set(r.account_id, cur);
  }

  const wantAccount = opts?.scope === undefined || opts.scope === "account";
  const wantCampaign = opts?.scope === undefined || opts.scope === "campaign";

  const results: NormalizedMetrics[] = [];

  if (wantCampaign) {
    const sorted = [...campaignAgg.values()].sort((a, b) =>
      a.entity_id < b.entity_id ? -1 : a.entity_id > b.entity_id ? 1 : 0,
    );
    for (const agg of sorted) {
      results.push(finalize(agg, window, null));
    }
  }

  if (wantAccount) {
    const sorted = [...accountAgg.values()].sort((a, b) =>
      a.entity_id < b.entity_id ? -1 : a.entity_id > b.entity_id ? 1 : 0,
    );
    for (const agg of sorted) {
      const fp = fpByAccount.get(agg.entity_id);
      const fpRevenue = fp ? fp.revenue : null;
      results.push(finalize(agg, window, fpRevenue));
    }
  }

  return results.map((r) => NormalizedMetrics.parse(r));
}

function addInto(
  bucket: Map<string, AggregateAccumulator>,
  id: string,
  scope: "account" | "campaign",
  row: CampaignDailyMetric,
): void {
  const cur =
    bucket.get(id) ??
    ({
      scope,
      entity_id: id,
      spend: 0,
      clicks: 0,
      impressions: 0,
      conversions: 0,
      platform_revenue: 0,
    } satisfies AggregateAccumulator);
  cur.spend += row.spend;
  cur.clicks += row.clicks;
  cur.impressions += row.impressions;
  cur.conversions += row.conversions;
  cur.platform_revenue += row.platform_revenue;
  bucket.set(id, cur);
}

function finalize(
  agg: AggregateAccumulator,
  window: string,
  firstPartyRevenue: number | null,
): NormalizedMetrics {
  const cac = agg.conversions > 0 ? agg.spend / agg.conversions : null;
  const roas = agg.spend > 0 ? agg.platform_revenue / agg.spend : null;
  const mer =
    firstPartyRevenue !== null && agg.spend > 0
      ? firstPartyRevenue / agg.spend
      : null;
  const ctr = agg.impressions > 0 ? agg.clicks / agg.impressions : null;
  const cvr = agg.clicks > 0 ? agg.conversions / agg.clicks : null;
  return {
    scope: agg.scope,
    entity_id: agg.entity_id,
    window,
    spend: agg.spend,
    clicks: agg.clicks,
    conversions: agg.conversions,
    platform_revenue: agg.platform_revenue,
    first_party_revenue: firstPartyRevenue,
    cac,
    roas,
    mer,
    ctr,
    cvr,
  };
}

function deriveWindow(
  rows: CampaignDailyMetric[],
  fp: FirstPartyRevenueDaily[],
): string {
  const dates = [...rows.map((r) => r.date), ...fp.map((r) => r.date)].sort();
  if (dates.length === 0) return "unknown..unknown";
  const start = dates[0];
  const end = dates[dates.length - 1];
  return `${start}..${end}`;
}

function parseWindow(window: string): { start: string; end: string } | null {
  const parts = window.split("..");
  if (parts.length !== 2) return null;
  const [start, end] = parts;
  if (!start || !end) return null;
  return { start, end };
}

function filterByWindow(
  rows: CampaignDailyMetric[],
  window: string,
): CampaignDailyMetric[] {
  const range = parseWindow(window);
  if (!range) return rows;
  return rows.filter((r) => r.date >= range.start && r.date <= range.end);
}

function filterFpByWindow(
  rows: FirstPartyRevenueDaily[],
  window: string,
): FirstPartyRevenueDaily[] {
  const range = parseWindow(window);
  if (!range) return rows;
  return rows.filter((r) => r.date >= range.start && r.date <= range.end);
}
