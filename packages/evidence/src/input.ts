import {
  Campaign,
  CampaignDailyMetric,
  FirstPartyRevenueDaily,
  NormalizedMetrics,
  PlatformAccount,
  z,
} from "@admatix/schemas";
import type { DetectorInput } from "./index.js";

export const DetectorInputSchema = z.object({
  account: PlatformAccount,
  campaigns: z.array(Campaign),
  metrics: z.array(NormalizedMetrics),
  daily: z.array(CampaignDailyMetric),
  firstParty: z.array(FirstPartyRevenueDaily),
});

export function parseDetectorInput(input: DetectorInput): DetectorInput {
  return DetectorInputSchema.parse(input);
}
