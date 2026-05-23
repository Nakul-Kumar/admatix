import type { BenchmarkTask } from "@admatix/schemas";
import type { BaselineOutput } from "../types.js";
import { emptyOutput } from "./_shared.js";

/**
 * The honest floor: do nothing. Surfaces no findings, proposes no action,
 * leaves no evidence. The benchmark's value floor — anything AdMatix claims
 * must beat this.
 */
export function noopBaseline(_task: BenchmarkTask): BaselineOutput {
  const out = emptyOutput();
  out.notes.push("noop: no action taken");
  return out;
}
