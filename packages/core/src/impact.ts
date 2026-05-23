import { NormalizedMetrics } from "@admatix/schemas";

export interface ImpactResult {
  /** Percent change in CAC vs. baseline. `null` if either CAC is unknown. */
  cac_delta_pct: number | null;
  /**
   * Spend that would have been wasted at the baseline CAC and is avoided at
   * the current CAC, scaled by current conversions. Floored at 0 — gains, not
   * regressions. `0` if either CAC is unknown.
   */
  recovered_waste: number;
  /**
   * First-party revenue lift, adjusted for spend so the value is comparable
   * across windows. `(current.fp_rev - baseline.fp_rev) - (current.spend - baseline.spend)`.
   * `0` if either side lacks first-party data.
   */
  margin_adjusted_value: number;
}

/**
 * Pure, deterministic impact math. Same inputs → same numeric output.
 * Operates on already-normalized metrics so the caller controls scope/window.
 */
export function computeImpact(
  current: NormalizedMetrics,
  baseline: NormalizedMetrics,
): ImpactResult {
  const c = NormalizedMetrics.parse(current);
  const b = NormalizedMetrics.parse(baseline);

  const cac_delta_pct =
    c.cac !== null && b.cac !== null && b.cac > 0
      ? ((c.cac - b.cac) / b.cac) * 100
      : null;

  const recovered_waste =
    c.cac !== null && b.cac !== null && b.cac > c.cac
      ? (b.cac - c.cac) * c.conversions
      : 0;

  const margin_adjusted_value =
    c.first_party_revenue !== null && b.first_party_revenue !== null
      ? c.first_party_revenue - b.first_party_revenue - (c.spend - b.spend)
      : 0;

  return { cac_delta_pct, recovered_waste, margin_adjusted_value };
}
