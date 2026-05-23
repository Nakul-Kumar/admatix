import { sha256 } from "@admatix/core";
import { EvidenceRef, Finding } from "@admatix/schemas";
import type { Campaign, CampaignDailyMetric } from "@admatix/schemas";

export const DIRECTIONAL_CAUSAL_STATUS = "directional_until_lift_test" as const;

export function findingId(
  detector: string,
  entityId: string,
  reason: string,
): string {
  return `finding_${detector}_${sha256({ detector, entityId, reason }).slice(0, 12)}`;
}

export function sourceFor(row: CampaignDailyMetric): string {
  return `${row.platform}_fixture`;
}

export function metricEvidence(
  row: CampaignDailyMetric,
  metric: string,
  value: number,
): EvidenceRef {
  return EvidenceRef.parse({
    source: sourceFor(row),
    ref: `metric:campaign_daily:${row.account_id}:${row.campaign_id}:${row.date}`,
    entity_id: row.campaign_id,
    metric,
    value,
    hash: sha256(row),
  });
}

export function campaignEvidence(campaign: Campaign): EvidenceRef {
  return EvidenceRef.parse({
    source: `${campaign.platform}_fixture`,
    ref: `campaign:${campaign.account_id}:${campaign.campaign_id}`,
    entity_id: campaign.campaign_id,
    hash: sha256(campaign),
  });
}

export function parseFinding(value: Finding): Finding {
  return Finding.parse(value);
}

export function rowsByCampaign(rows: CampaignDailyMetric[]): Map<string, CampaignDailyMetric[]> {
  const grouped = new Map<string, CampaignDailyMetric[]>();
  for (const row of rows) {
    const current = grouped.get(row.campaign_id) ?? [];
    current.push(row);
    grouped.set(row.campaign_id, current);
  }
  for (const [campaignId, groupedRows] of grouped) {
    grouped.set(
      campaignId,
      [...groupedRows].sort((a, b) => a.date.localeCompare(b.date)),
    );
  }
  return grouped;
}

export function avg(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

export function pctDelta(current: number, baseline: number): number | null {
  if (baseline === 0) return null;
  return (current - baseline) / baseline;
}

export function splitWindow<T>(rows: T[]): { baseline: T[]; recent: T[] } {
  const midpoint = Math.floor(rows.length / 2);
  return {
    baseline: rows.slice(0, midpoint),
    recent: rows.slice(midpoint),
  };
}

export function deterministicCreatedAt(rows: CampaignDailyMetric[]): string {
  const last = rows.map((row) => row.date).sort().at(-1) ?? "1970-01-01";
  return `${last}T00:00:00.000Z`;
}

export function numberFromRaw(raw: Record<string, unknown> | undefined, key: string): number | null {
  const value = raw?.[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function booleanFromRaw(
  raw: Record<string, unknown> | undefined,
  key: string,
): boolean | null {
  const value = raw?.[key];
  return typeof value === "boolean" ? value : null;
}

export function stringFromRaw(
  raw: Record<string, unknown> | undefined,
  key: string,
): string | null {
  const value = raw?.[key];
  return typeof value === "string" ? value : null;
}
