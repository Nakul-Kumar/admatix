import type { Scorer } from "../types.js";
import { evidenceScorer } from "./evidence.js";
import { policyScorer } from "./policy.js";
import { stateDiffScorer } from "./state-diff.js";

export const scorers: Record<string, Scorer> = {
  [stateDiffScorer.id]: stateDiffScorer,
  [policyScorer.id]: policyScorer,
  [evidenceScorer.id]: evidenceScorer,
};
