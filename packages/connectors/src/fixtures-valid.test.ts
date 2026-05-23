import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";
import {
  Campaign,
  CampaignDailyMetric,
  CreativeDailyMetric,
  FirstPartyRevenueDaily,
  PlatformAccount,
  z,
} from "@admatix/schemas";

function findFixtureRoot(): string {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 12; i += 1) {
    const candidate = join(dir, "data", "fixtures");
    try {
      if (statSync(candidate).isDirectory()) return candidate;
    } catch {
      // keep walking
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error("could not locate data/fixtures/ from the test file");
}

function listJsonFilesRecursive(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    const stat = statSync(path);
    if (stat.isDirectory()) out.push(...listJsonFilesRecursive(path));
    else if (entry.endsWith(".json")) out.push(path);
  }
  return out.sort();
}

const FixtureEnvelope = z.object({
  fixture_version: z.string().min(1),
  account: PlatformAccount.optional(),
  account_id: z.string().optional(),
  campaigns: z.array(Campaign).optional(),
  campaign_daily_metrics: z.array(CampaignDailyMetric).optional(),
  creative_daily_metrics: z.array(CreativeDailyMetric).optional(),
  first_party_revenue_daily: z.array(FirstPartyRevenueDaily).optional(),
});

const fixtureRoot = findFixtureRoot();
const files = listJsonFilesRecursive(fixtureRoot);

describe("every fixture validates against @admatix/schemas (acceptance #3)", () => {
  it("the fixture tree is non-empty", () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it.each(files.map((f) => [relative(fixtureRoot, f), f]))(
    "%s parses and every typed section validates",
    (_label, path) => {
      const raw = JSON.parse(readFileSync(path, "utf8"));
      const parsed = FixtureEnvelope.parse(raw);

      if (parsed.account) {
        expect(() => PlatformAccount.parse(parsed.account)).not.toThrow();
      }
      for (const c of parsed.campaigns ?? []) {
        expect(() => Campaign.parse(c)).not.toThrow();
      }
      for (const m of parsed.campaign_daily_metrics ?? []) {
        expect(() => CampaignDailyMetric.parse(m)).not.toThrow();
      }
      for (const m of parsed.creative_daily_metrics ?? []) {
        expect(() => CreativeDailyMetric.parse(m)).not.toThrow();
      }
      for (const r of parsed.first_party_revenue_daily ?? []) {
        expect(() => FirstPartyRevenueDaily.parse(r)).not.toThrow();
      }
    },
  );
});
