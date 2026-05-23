import { describe, it, expect } from "vitest";
import type {
  CampaignDailyMetric,
  FirstPartyRevenueDaily,
} from "@admatix/schemas";
import { normalizeMetrics } from "./normalize.js";

const baseRow = (overrides: Partial<CampaignDailyMetric>): CampaignDailyMetric => ({
  date: "2026-05-12",
  account_id: "acc_demo",
  campaign_id: "campaign_a",
  platform: "google_ads",
  spend: 100,
  impressions: 1000,
  clicks: 50,
  conversions: 5,
  platform_revenue: 200,
  ...overrides,
});

const dailyRows: CampaignDailyMetric[] = [
  baseRow({ date: "2026-05-12", campaign_id: "campaign_a", spend: 100, conversions: 5, platform_revenue: 200, clicks: 50, impressions: 1000 }),
  baseRow({ date: "2026-05-13", campaign_id: "campaign_a", spend: 120, conversions: 6, platform_revenue: 240, clicks: 55, impressions: 1100 }),
  baseRow({ date: "2026-05-12", campaign_id: "campaign_b", spend: 200, conversions: 10, platform_revenue: 500, clicks: 100, impressions: 2000 }),
  baseRow({ date: "2026-05-13", campaign_id: "campaign_b", spend: 180, conversions: 9, platform_revenue: 450, clicks: 95, impressions: 1900 }),
];

const fpRows: FirstPartyRevenueDaily[] = [
  { date: "2026-05-12", account_id: "acc_demo", revenue: 600, orders: 30 },
  { date: "2026-05-13", account_id: "acc_demo", revenue: 650, orders: 32 },
];

describe("normalizeMetrics — WP-B acceptance #1 (determinism)", () => {
  it("produces byte-identical output for identical input", () => {
    const a = normalizeMetrics(dailyRows, fpRows, {
      scope: "campaign",
      window: "2026-05-12..2026-05-13",
    });
    const b = normalizeMetrics(dailyRows, fpRows, {
      scope: "campaign",
      window: "2026-05-12..2026-05-13",
    });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it("returns rows sorted by entity_id for stable output", () => {
    const out = normalizeMetrics(dailyRows, fpRows, {
      scope: "campaign",
      window: "2026-05-12..2026-05-13",
    });
    expect(out.map((r) => r.entity_id)).toEqual(["campaign_a", "campaign_b"]);
  });
});

describe("normalizeMetrics — WP-B acceptance #2 (cac semantics)", () => {
  it("cac is null when conversions are 0; never Infinity or NaN", () => {
    const rows: CampaignDailyMetric[] = [
      baseRow({ campaign_id: "c_zero", conversions: 0, spend: 500 }),
    ];
    const [campaign] = normalizeMetrics(rows, undefined, {
      scope: "campaign",
      window: "2026-05-12..2026-05-12",
    });
    expect(campaign!.cac).toBeNull();
    expect(Number.isFinite(campaign!.cac ?? 0)).toBe(true);
  });

  it("cac = spend / conversions when conversions > 0", () => {
    const [campaign] = normalizeMetrics(
      [baseRow({ campaign_id: "c", spend: 220, conversions: 11 })],
      undefined,
      { scope: "campaign", window: "2026-05-12..2026-05-12" },
    );
    expect(campaign!.cac).toBe(20);
  });
});

describe("normalizeMetrics — WP-B acceptance #3 (mer uses first-party only)", () => {
  it("mer is computed from first-party revenue at the account scope", () => {
    const out = normalizeMetrics(dailyRows, fpRows, {
      scope: "account",
      window: "2026-05-12..2026-05-13",
    });
    expect(out.length).toBe(1);
    const account = out[0]!;
    expect(account.scope).toBe("account");
    expect(account.first_party_revenue).toBe(1250); // 600 + 650
    expect(account.mer).toBeCloseTo(1250 / 600); // first-party / spend
  });

  it("mer is null when no first-party data is supplied", () => {
    const out = normalizeMetrics(dailyRows, undefined, {
      scope: "account",
      window: "2026-05-12..2026-05-13",
    });
    expect(out[0]!.mer).toBeNull();
    expect(out[0]!.first_party_revenue).toBeNull();
  });

  it("mer is null at the campaign scope even with first-party data present", () => {
    const out = normalizeMetrics(dailyRows, fpRows, {
      scope: "campaign",
      window: "2026-05-12..2026-05-13",
    });
    for (const row of out) {
      expect(row.scope).toBe("campaign");
      expect(row.mer).toBeNull();
      expect(row.first_party_revenue).toBeNull();
    }
  });
});

describe("normalizeMetrics — WP-B acceptance #5 (raw passthrough)", () => {
  it("preserves unknown platform fields in the raw bag through schema validation", () => {
    const rowWithRaw: CampaignDailyMetric = baseRow({
      raw: { google_ads_campaign_resource: "customers/X/campaigns/Y", network: "search" },
    });
    // The boundary parse should keep raw intact; the normalize function should
    // not crash on rows that carry arbitrary unknown sub-fields.
    const out = normalizeMetrics([rowWithRaw], undefined, {
      scope: "campaign",
      window: "2026-05-12..2026-05-12",
    });
    expect(out.length).toBe(1);
    expect(out[0]!.entity_id).toBe("campaign_a");
  });
});

describe("normalizeMetrics — derived ratios and rollups", () => {
  it("aggregates across days within a campaign", () => {
    const [campaign] = normalizeMetrics(dailyRows, undefined, {
      scope: "campaign",
      window: "2026-05-12..2026-05-13",
    });
    expect(campaign!.entity_id).toBe("campaign_a");
    expect(campaign!.spend).toBe(220);
    expect(campaign!.conversions).toBe(11);
    expect(campaign!.platform_revenue).toBe(440);
    expect(campaign!.cac).toBe(20);
    expect(campaign!.roas).toBe(2);
  });

  it("filters rows outside the requested window", () => {
    const extra = [
      ...dailyRows,
      baseRow({ date: "2026-05-30", campaign_id: "campaign_a", spend: 9999 }),
    ];
    const out = normalizeMetrics(extra, undefined, {
      scope: "campaign",
      window: "2026-05-12..2026-05-13",
    });
    const a = out.find((r) => r.entity_id === "campaign_a")!;
    expect(a.spend).toBe(220); // out-of-window row excluded
  });

  it("returns both campaign and account rows when scope is unset", () => {
    const out = normalizeMetrics(dailyRows, fpRows, {
      scope: undefined as unknown as "account",
      window: "2026-05-12..2026-05-13",
    });
    const scopes = out.map((r) => r.scope).sort();
    expect(scopes).toContain("account");
    expect(scopes).toContain("campaign");
  });

  it("ctr=null when impressions=0, cvr=null when clicks=0, roas=null when spend=0", () => {
    const [campaign] = normalizeMetrics(
      [baseRow({ campaign_id: "c_zero_imps", impressions: 0, clicks: 0, spend: 0, platform_revenue: 0, conversions: 0 })],
      undefined,
      { scope: "campaign", window: "2026-05-12..2026-05-12" },
    );
    expect(campaign!.ctr).toBeNull();
    expect(campaign!.cvr).toBeNull();
    expect(campaign!.roas).toBeNull();
    expect(campaign!.cac).toBeNull();
  });
});
