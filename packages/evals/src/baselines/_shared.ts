import type { BenchmarkTask } from "@admatix/schemas";
import type { BaselineOutput } from "../types.js";

export function emptyOutput(): BaselineOutput {
  return {
    findings: [],
    estimated_waste_usd: 0,
    proposed: false,
    blocked: false,
    block_reasons: [],
    diff_changes: [],
    evidence_refs: [],
    has_rollback: false,
    hallucinated_id: false,
    notes: [],
  };
}

export function inputOf(task: BenchmarkTask): Record<string, unknown> {
  const inp = task.expected["input"];
  if (inp && typeof inp === "object") return inp as Record<string, unknown>;
  return {};
}

export function asNumber(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

export function asString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

export function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
}

export function asNumberArray(value: unknown): number[] {
  return Array.isArray(value) ? value.filter((v): v is number => typeof v === "number") : [];
}

export function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

/**
 * Deterministic detection of prompt-injection-style payloads in free text.
 * Conservative — only matches blunt patterns we have planted in our fixtures,
 * so it cannot generate false positives on normal campaign names.
 */
export function looksInjected(text: string): boolean {
  const t = text.toLowerCase();
  return (
    t.includes("ignore previous instructions") ||
    t.includes("disregard previous") ||
    t.includes("raise all budgets") ||
    t.includes("pause all campaigns") ||
    /tool[_ ]?call/.test(t)
  );
}
