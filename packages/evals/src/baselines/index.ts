import type { BenchmarkTask } from "@admatix/schemas";
import { noopBaseline } from "./noop.js";
import { agencyRuleBaseline } from "./agency-rule.js";
import { admatixBaseline } from "./admatix.js";

export const baselines: Record<string, (task: BenchmarkTask) => unknown> = {
  noop: noopBaseline,
  agencyRule: agencyRuleBaseline,
  admatix: admatixBaseline,
};
