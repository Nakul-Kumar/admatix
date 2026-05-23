import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  Campaign,
  CampaignDailyMetric,
  CreativeDailyMetric,
  FirstPartyRevenueDaily,
  PlatformAccount,
  z,
} from "@admatix/schemas";
import type {
  Campaign as CampaignT,
  CampaignDailyMetric as CampaignDailyMetricT,
  CreativeDailyMetric as CreativeDailyMetricT,
  FirstPartyRevenueDaily as FirstPartyRevenueDailyT,
  Platform,
  PlatformAccount as PlatformAccountT,
} from "@admatix/schemas";
import type { Connector } from "./connector.js";

/**
 * Fixture file envelope. Every known section parses with its `@admatix/schemas`
 * type; unknown keys (e.g. `programmatic_supply_paths`, `_notes`) are stripped
 * by Zod's default object behaviour rather than rejected, so platform-specific
 * extras can live alongside the contract-typed data.
 */
const FixtureFile = z.object({
  fixture_version: z.string(),
  account: PlatformAccount.optional(),
  account_id: z.string().optional(),
  campaigns: z.array(Campaign).optional(),
  campaign_daily_metrics: z.array(CampaignDailyMetric).optional(),
  creative_daily_metrics: z.array(CreativeDailyMetric).optional(),
  first_party_revenue_daily: z.array(FirstPartyRevenueDaily).optional(),
});
type FixtureFile = z.infer<typeof FixtureFile>;

let cachedRoot: string | undefined;

function findFixtureRoot(): string {
  const override = process.env["ADMATIX_FIXTURE_ROOT"];
  if (override) return override;
  if (cachedRoot) return cachedRoot;
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 12; i += 1) {
    const candidate = join(dir, "data", "fixtures");
    if (existsSync(candidate)) {
      cachedRoot = candidate;
      return candidate;
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error(
    "fixtureConnector: could not locate data/fixtures/. Set ADMATIX_FIXTURE_ROOT to point at the fixture directory.",
  );
}

function listJsonFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((entry) => {
      if (!entry.endsWith(".json")) return false;
      try {
        return statSync(join(dir, entry)).isFile();
      } catch {
        return false;
      }
    })
    .map((entry) => join(dir, entry))
    .sort();
}

function loadFixtures(dir: string): FixtureFile[] {
  return listJsonFiles(dir).map((path) => {
    let raw: unknown;
    try {
      raw = JSON.parse(readFileSync(path, "utf8"));
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      throw new Error(`fixtureConnector: ${path} is not valid JSON — ${detail}`);
    }
    try {
      return FixtureFile.parse(raw);
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      throw new Error(`fixtureConnector: ${path} failed schema validation — ${detail}`);
    }
  });
}

function parseWindow(window: string): { start: string; end: string } {
  const parts = window.split("..");
  const start = parts[0];
  const end = parts[1];
  if (parts.length !== 2 || !start || !end) {
    throw new Error(
      `fixtureConnector: invalid window "${window}". Expected "YYYY-MM-DD..YYYY-MM-DD".`,
    );
  }
  return { start, end };
}

function inWindow(date: string, w: { start: string; end: string }): boolean {
  return date >= w.start && date <= w.end;
}

/**
 * Build a read-only `Connector` backed by `data/fixtures/`. `platform` selects
 * the sub-directory to read (default: `google_ads` — the demo account lives
 * there). First-party revenue is always read from `data/fixtures/first_party/`
 * because it is account-keyed, not platform-keyed.
 */
export function fixtureConnector(platform: Platform = "google_ads"): Connector {
  const root = findFixtureRoot();
  const platformFixtures = loadFixtures(join(root, platform));
  const firstPartyFixtures = loadFixtures(join(root, "first_party"));

  const accountsById = new Map<string, PlatformAccountT>();
  const campaigns: CampaignT[] = [];
  const campaignDaily: CampaignDailyMetricT[] = [];
  const creativeDaily: CreativeDailyMetricT[] = [];
  const firstParty: FirstPartyRevenueDailyT[] = [];
  const campaignToAccount = new Map<string, string>();

  for (const f of platformFixtures) {
    if (f.account && f.account.platform === platform) {
      accountsById.set(f.account.account_id, f.account);
    }
    for (const c of f.campaigns ?? []) {
      if (c.platform === platform) {
        campaigns.push(c);
        campaignToAccount.set(c.campaign_id, c.account_id);
      }
    }
    for (const m of f.campaign_daily_metrics ?? []) {
      if (m.platform === platform) campaignDaily.push(m);
    }
    for (const m of f.creative_daily_metrics ?? []) {
      creativeDaily.push(m);
    }
  }
  for (const f of firstPartyFixtures) {
    for (const r of f.first_party_revenue_daily ?? []) firstParty.push(r);
  }

  return {
    platform,
    async listAccounts() {
      return Array.from(accountsById.values()).map((a) => PlatformAccount.parse(a));
    },
    async getCampaigns(accountId) {
      return campaigns
        .filter((c) => c.account_id === accountId)
        .map((c) => Campaign.parse(c));
    },
    async getCampaignDailyMetrics(accountId, window) {
      const w = parseWindow(window);
      return campaignDaily
        .filter((m) => m.account_id === accountId && inWindow(m.date, w))
        .map((m) => CampaignDailyMetric.parse(m));
    },
    async getCreativeDailyMetrics(accountId, window) {
      const w = parseWindow(window);
      return creativeDaily
        .filter((m) => {
          const owner = campaignToAccount.get(m.campaign_id);
          return owner === accountId && inWindow(m.date, w);
        })
        .map((m) => CreativeDailyMetric.parse(m));
    },
    async getFirstPartyRevenue(accountId, window) {
      const w = parseWindow(window);
      return firstParty
        .filter((r) => r.account_id === accountId && inWindow(r.date, w))
        .map((r) => FirstPartyRevenueDaily.parse(r));
    },
    async healthCheck() {
      return {
        ok: true,
        detail: `fixture connector for "${platform}" loaded ${accountsById.size} account(s), ${campaigns.length} campaign(s) from ${root}`,
      };
    },
  };
}
