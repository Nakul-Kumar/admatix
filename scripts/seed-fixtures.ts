import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import process from "node:process";
import {
  Campaign,
  CampaignDailyMetric,
  FirstPartyRevenueDaily,
  PlatformAccount,
  z,
} from "@admatix/schemas";

const fixtureRoot = join(process.cwd(), "data", "fixtures");

const FixtureFile = z.object({
  fixture_version: z.string(),
  account: PlatformAccount.optional(),
  account_id: z.string().optional(),
  campaigns: z.array(Campaign).optional(),
  campaign_daily_metrics: z.array(CampaignDailyMetric).optional(),
  first_party_revenue_daily: z.array(FirstPartyRevenueDaily).optional(),
  _notes: z.string().optional(),
});

function listJsonFiles(dir: string): string[] {
  return readdirSync(dir)
    .flatMap((entry) => {
      const path = join(dir, entry);
      if (statSync(path).isDirectory()) return listJsonFiles(path);
      return path.endsWith(".json") ? [path] : [];
    })
    .sort();
}

let fileCount = 0;
let recordCount = 0;
const failures: string[] = [];

for (const path of listJsonFiles(fixtureRoot)) {
  const label = relative(process.cwd(), path);
  try {
    const parsed = FixtureFile.parse(JSON.parse(readFileSync(path, "utf8")));
    fileCount += 1;
    recordCount += Number(Boolean(parsed.account));
    recordCount += parsed.campaigns?.length ?? 0;
    recordCount += parsed.campaign_daily_metrics?.length ?? 0;
    recordCount += parsed.first_party_revenue_daily?.length ?? 0;
    console.log(`[fixture] ${label} ok`);
  } catch (error) {
    failures.push(`${label}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

if (failures.length > 0) {
  console.error("\nfixture validation failed:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(`\nseed-fixtures: validated ${fileCount} file(s), ${recordCount} record(s).`);
