import { describe, expect, it } from "vitest";
import { budgetWasteDetector } from "./budget-waste.js";
import { creativeFatigueDetector } from "./creative-fatigue.js";
import { pacingDetector } from "./pacing.js";
import { supplyPathDetector } from "./supply-path.js";
import { trackingDetector } from "./tracking.js";
import {
  cloneInput,
  loadCampaignInput,
  loadCreativeInput,
  loadSupplyInput,
} from "../test-utils.js";

describe("detectors", () => {
  it("tracking has positive and negative fixture coverage", () => {
    expect(trackingDetector(loadCampaignInput("google_ads", "demo_tracking_break.json"))).toHaveLength(1);
    expect(trackingDetector(loadCampaignInput("google_ads", "demo_tracking_clean.json"))).toHaveLength(0);
  });

  it("pacing has positive and negative fixture coverage", () => {
    const positive = pacingDetector(loadCampaignInput("google_ads", "demo_campaigns.json"));
    expect(positive.map((finding) => finding.entity_id)).toContain("campaign_a");
    const negative = pacingDetector(loadCampaignInput("google_ads", "demo_tracking_clean.json"));
    expect(negative).toHaveLength(0);
  });

  it("budget-waste flags Campaign A in agency-demo and has a negative fixture", () => {
    const positive = budgetWasteDetector(loadCampaignInput("google_ads", "demo_campaigns.json"));
    expect(positive.map((finding) => finding.entity_id)).toContain("campaign_a");
    expect(positive).toHaveLength(2);
    expect(budgetWasteDetector(loadCampaignInput("google_ads", "demo_tracking_clean.json"))).toHaveLength(0);
  });

  it("creative-fatigue has positive and negative fixture coverage", () => {
    expect(creativeFatigueDetector(loadCreativeInput("demo_creative_fatigue.json"))).toHaveLength(1);
    expect(creativeFatigueDetector(loadCreativeInput("demo_creative_healthy.json"))).toHaveLength(0);
  });

  it("supply-path has positive and negative fixture coverage", () => {
    expect(supplyPathDetector(loadSupplyInput("demo_supply_paths.json"))).toHaveLength(1);
    expect(supplyPathDetector(loadSupplyInput("demo_supply_paths_clean.json"))).toHaveLength(0);
  });

  it("every detector finding has evidence", () => {
    const allFindings = [
      ...trackingDetector(loadCampaignInput("google_ads", "demo_tracking_break.json")),
      ...pacingDetector(loadCampaignInput("google_ads", "demo_campaigns.json")),
      ...budgetWasteDetector(loadCampaignInput("google_ads", "demo_campaigns.json")),
      ...creativeFatigueDetector(loadCreativeInput("demo_creative_fatigue.json")),
      ...supplyPathDetector(loadSupplyInput("demo_supply_paths.json")),
    ];
    expect(allFindings.length).toBeGreaterThan(0);
    for (const finding of allFindings) {
      expect(finding.evidence.length).toBeGreaterThan(0);
      expect(finding.causal_status).toBe("directional_until_lift_test");
    }
  });

  // QA finding #11 (HIGH): pacing detector divided by zero when a
  // campaign's daily_budget was 0, producing Infinity drift and a
  // "NaN%" description. Reproduce the input shape directly.
  it("F11: pacing skips campaigns whose daily_budget is 0 (no Infinity)", () => {
    const input = {
      account: {
        account_id: "acc_test",
        platform: "google_ads" as const,
        tenant_id: "tenant_t",
        name: "test",
        currency: "USD",
        timezone: "UTC",
      },
      campaigns: [
        {
          campaign_id: "campaign_zero",
          account_id: "acc_test",
          platform: "google_ads" as const,
          name: "Zero-budget campaign",
          status: "active" as const,
          objective: "conversions",
          daily_budget: 0,
        },
      ],
      metrics: [],
      firstParty: [],
      daily: [
        { date: "2026-05-12", account_id: "acc_test", campaign_id: "campaign_zero", platform: "google_ads" as const, spend: 50, impressions: 1000, clicks: 40, conversions: 1, platform_revenue: 100 },
        { date: "2026-05-13", account_id: "acc_test", campaign_id: "campaign_zero", platform: "google_ads" as const, spend: 60, impressions: 1100, clicks: 45, conversions: 1, platform_revenue: 110 },
        { date: "2026-05-14", account_id: "acc_test", campaign_id: "campaign_zero", platform: "google_ads" as const, spend: 70, impressions: 1200, clicks: 50, conversions: 1, platform_revenue: 120 },
      ],
    };
    const findings = pacingDetector(input);
    expect(findings).toEqual([]);
    for (const f of findings) {
      expect(f.description).not.toMatch(/NaN|Infinity/);
    }
  });

  it("detectors do not mutate their input", () => {
    const cases = [
      [trackingDetector, loadCampaignInput("google_ads", "demo_tracking_break.json")] as const,
      [pacingDetector, loadCampaignInput("google_ads", "demo_campaigns.json")] as const,
      [budgetWasteDetector, loadCampaignInput("google_ads", "demo_campaigns.json")] as const,
      [creativeFatigueDetector, loadCreativeInput("demo_creative_fatigue.json")] as const,
      [supplyPathDetector, loadSupplyInput("demo_supply_paths.json")] as const,
    ];
    for (const [detector, input] of cases) {
      const before = cloneInput(input);
      detector(input);
      expect(input).toEqual(before);
    }
  });
});
