import type {
  AuditReport,
  Campaign,
  CampaignDailyMetric,
  Finding,
  FirstPartyRevenueDaily,
  H0Packet,
  NormalizedMetrics,
  PlatformAccount,
} from "@admatix/schemas";

export interface DetectorInput {
  account: PlatformAccount;
  campaigns: Campaign[];
  metrics: NormalizedMetrics[];
  daily: CampaignDailyMetric[];
  firstParty: FirstPartyRevenueDaily[];
}

export type Detector = (input: DetectorInput) => Finding[];

export const detectors: Record<string, Detector> = {
  tracking: () => [],
  pacing: () => [],
  budgetWaste: () => [],
  creativeFatigue: () => [],
  supplyPath: () => [],
};

export function runAudit(_input: DetectorInput, _window: string): AuditReport {
  throw new Error("runAudit is not implemented yet.");
}

export function buildH0Packets(
  _report: AuditReport,
  _goal: string,
  _tenantId: string,
): H0Packet[] {
  throw new Error("buildH0Packets is not implemented yet.");
}
