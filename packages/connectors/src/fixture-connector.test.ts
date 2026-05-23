import { describe, it, expect } from "vitest";
import {
  Campaign,
  CampaignDailyMetric,
  CreativeDailyMetric,
  FirstPartyRevenueDaily,
  PlatformAccount,
} from "@admatix/schemas";
import { fixtureConnector } from "./fixture-connector.js";

describe("fixtureConnector (acceptance #1)", () => {
  it("returns schema-valid Campaign[] and CampaignDailyMetric[] for the agency-demo dataset", async () => {
    const connector = fixtureConnector(); // defaults to google_ads
    expect(connector.platform).toBe("google_ads");

    const accounts = await connector.listAccounts();
    expect(accounts.length).toBeGreaterThan(0);
    for (const a of accounts) {
      expect(() => PlatformAccount.parse(a)).not.toThrow();
    }

    const demo = accounts.find((a) => a.account_id === "acc_demo");
    expect(demo, "the agency-demo google_ads account should be loaded").toBeDefined();

    const campaigns = await connector.getCampaigns("acc_demo");
    expect(campaigns.length).toBeGreaterThan(0);
    for (const c of campaigns) {
      expect(() => Campaign.parse(c)).not.toThrow();
      expect(c.account_id).toBe("acc_demo");
      expect(c.platform).toBe("google_ads");
    }

    const metrics = await connector.getCampaignDailyMetrics(
      "acc_demo",
      "2026-05-12..2026-05-21",
    );
    expect(metrics.length).toBeGreaterThan(0);
    for (const m of metrics) {
      expect(() => CampaignDailyMetric.parse(m)).not.toThrow();
      expect(m.account_id).toBe("acc_demo");
      expect(m.date >= "2026-05-12" && m.date <= "2026-05-21").toBe(true);
    }
  });

  it("filters daily metrics outside the requested window", async () => {
    const connector = fixtureConnector();
    const narrow = await connector.getCampaignDailyMetrics(
      "acc_demo",
      "2026-05-20..2026-05-21",
    );
    for (const m of narrow) {
      expect(["2026-05-20", "2026-05-21"]).toContain(m.date);
    }
  });

  it("rejects malformed window strings", async () => {
    const connector = fixtureConnector();
    await expect(
      connector.getCampaignDailyMetrics("acc_demo", "2026-05-20"),
    ).rejects.toThrow(/invalid window/);
  });

  it("returns the meta creative-fatigue series with rising frequency and falling CTR", async () => {
    const connector = fixtureConnector("meta_ads");
    const metrics = await connector.getCreativeDailyMetrics(
      "acc_demo_meta",
      "2026-05-08..2026-05-21",
    );
    const fatigue = metrics
      .filter((m) => m.creative_id === "creative_fatigue_1")
      .sort((a, b) => a.date.localeCompare(b.date));
    expect(fatigue.length).toBe(14);
    for (const m of fatigue) {
      expect(() => CreativeDailyMetric.parse(m)).not.toThrow();
    }
    const first = fatigue[0]!;
    const last = fatigue[fatigue.length - 1]!;
    expect(last.frequency!).toBeGreaterThan(first.frequency!);
    const firstCtr = first.clicks / first.impressions;
    const lastCtr = last.clicks / last.impressions;
    expect(lastCtr).toBeLessThan(firstCtr);
  });

  it("returns first-party revenue scoped by account and window", async () => {
    const connector = fixtureConnector();
    const fp = await connector.getFirstPartyRevenue(
      "acc_demo",
      "2026-05-12..2026-05-21",
    );
    expect(fp.length).toBeGreaterThan(0);
    for (const r of fp) {
      expect(() => FirstPartyRevenueDaily.parse(r)).not.toThrow();
      expect(r.account_id).toBe("acc_demo");
    }
  });
});

describe("fixtureConnector healthCheck (acceptance #5)", () => {
  it("returns a structured { ok, detail } result", async () => {
    const connector = fixtureConnector();
    const result = await connector.healthCheck();
    expect(result).toEqual({
      ok: expect.any(Boolean),
      detail: expect.any(String),
    });
    expect(result.ok).toBe(true);
    expect(result.detail.length).toBeGreaterThan(0);
  });
});

describe("Connector exposes only read methods (acceptance #4)", () => {
  it("has no write-capable method on the returned object", async () => {
    const connector = fixtureConnector();
    const forbidden = [
      "create",
      "update",
      "delete",
      "remove",
      "patch",
      "put",
      "post",
      "write",
      "set",
      "mutate",
      "send",
      "execute",
      "upload",
      "publish",
      "pause",
      "resume",
      "activate",
      "deactivate",
    ];
    const keys = Object.keys(connector);
    for (const key of keys) {
      const lower = key.toLowerCase();
      for (const verb of forbidden) {
        expect(
          lower.includes(verb),
          `connector exposes a method named "${key}" — write-like verbs are forbidden`,
        ).toBe(false);
      }
    }
  });

  it("only exposes the contract-defined read methods plus platform", () => {
    const connector = fixtureConnector();
    const keys = Object.keys(connector).sort();
    expect(keys).toEqual(
      [
        "getCampaignDailyMetrics",
        "getCampaigns",
        "getCreativeDailyMetrics",
        "getFirstPartyRevenue",
        "healthCheck",
        "listAccounts",
        "platform",
      ].sort(),
    );
  });
});
