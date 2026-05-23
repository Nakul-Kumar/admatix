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
