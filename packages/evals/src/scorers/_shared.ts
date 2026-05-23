import type { BaselineOutput } from "../types.js";

export function isBaselineOutput(value: unknown): value is BaselineOutput {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return (
    Array.isArray(v["findings"]) &&
    Array.isArray(v["block_reasons"]) &&
    Array.isArray(v["diff_changes"]) &&
    Array.isArray(v["evidence_refs"]) &&
    Array.isArray(v["notes"]) &&
    typeof v["estimated_waste_usd"] === "number" &&
    typeof v["proposed"] === "boolean" &&
    typeof v["blocked"] === "boolean" &&
    typeof v["has_rollback"] === "boolean" &&
    typeof v["hallucinated_id"] === "boolean"
  );
}

export function asBaselineOutput(value: unknown): BaselineOutput {
  if (!isBaselineOutput(value)) {
    throw new Error("scorer: baseline produced a value that is not a BaselineOutput");
  }
  return value;
}
