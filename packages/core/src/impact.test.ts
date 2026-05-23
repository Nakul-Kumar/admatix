import { describe, it, expect } from "vitest";
import type { NormalizedMetrics } from "@admatix/schemas";
import { computeImpact } from "./impact.js";

const m = (overrides: Partial<NormalizedMetrics>): NormalizedMetrics => ({
  scope: "campaign",
  entity_id: "campaign_a",
  window: "2026-05-01..2026-05-21",
  spend: 1000,
  clicks: 500,
  conversions: 50,
  platform_revenue: 2000,
  first_party_revenue: 1800,
  cac: 20,
  roas: 2,
  mer: 1.8,
  ctr: 0.05,
  cvr: 0.1,
  ...overrides,
});

describe("computeImpact", () => {
  it("returns cac_delta_pct = 0 when CAC unchanged", () => {
    const out = computeImpact(m({}), m({}));
    expect(out.cac_delta_pct).toBe(0);
    expect(out.recovered_waste).toBe(0);
  });

  it("computes negative delta when CAC drops, with positive recovered waste", () => {
    const out = computeImpact(
      m({ cac: 18, conversions: 50 }),
      m({ cac: 20, conversions: 40 }),
    );
    expect(out.cac_delta_pct).toBe(-10);
    expect(out.recovered_waste).toBe((20 - 18) * 50);
  });

  it("cac_delta_pct is null when either side has null CAC", () => {
    expect(computeImpact(m({ cac: null }), m({})).cac_delta_pct).toBeNull();
    expect(computeImpact(m({}), m({ cac: null })).cac_delta_pct).toBeNull();
  });

  it("recovered_waste floors at 0 (no negative gains)", () => {
    const out = computeImpact(m({ cac: 25 }), m({ cac: 20 }));
    expect(out.recovered_waste).toBe(0);
  });

  it("margin_adjusted_value is 0 when either side lacks first-party data", () => {
    const out = computeImpact(
      m({ first_party_revenue: null }),
      m({}),
    );
    expect(out.margin_adjusted_value).toBe(0);
  });

  it("margin_adjusted_value = (fp_rev_delta) - (spend_delta)", () => {
    const out = computeImpact(
      m({ first_party_revenue: 2000, spend: 1100 }),
      m({ first_party_revenue: 1800, spend: 1000 }),
    );
    expect(out.margin_adjusted_value).toBe(200 - 100);
  });
});
