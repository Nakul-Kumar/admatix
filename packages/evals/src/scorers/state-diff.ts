import type { BenchmarkResult, BenchmarkTask } from "@admatix/schemas";
import type { FieldDiffLike, Scorer } from "../types.js";
import { asBaselineOutput } from "./_shared.js";

/**
 * Scores state_diff (and incidentally other dry-run) tasks by comparing the
 * baseline's diff_changes against the task's expected changes. The match is
 * order-independent on field name; an exact set match earns 1.0, partial
 * overlap scales linearly, and any extra-or-missing change pulls passed=false.
 */
export const stateDiffScorer: Scorer = {
  id: "state-diff",
  score(task: BenchmarkTask, output: unknown): Partial<BenchmarkResult> {
    const out = asBaselineOutput(output);
    const expectedRaw = task.expected["changes"];
    if (!Array.isArray(expectedRaw)) {
      return { task_id: task.task_id };
    }
    const expected = expectedRaw.filter(isFieldDiffLike);
    const actual = out.diff_changes;
    const expectedSet = new Map(expected.map((c) => [c.field, c]));
    const actualSet = new Map(actual.map((c) => [c.field, c]));

    let matched = 0;
    const notes: string[] = [];
    for (const [field, exp] of expectedSet) {
      const got = actualSet.get(field);
      if (!got) {
        notes.push(`state-diff: missing change on field "${field}"`);
        continue;
      }
      if (jsonEqual(got.before, exp.before) && jsonEqual(got.after, exp.after)) {
        matched += 1;
      } else {
        notes.push(
          `state-diff: field "${field}" expected ${describe(exp.before)}→${describe(exp.after)} got ${describe(got.before)}→${describe(got.after)}`,
        );
      }
    }
    for (const field of actualSet.keys()) {
      if (!expectedSet.has(field)) notes.push(`state-diff: unexpected change on field "${field}"`);
    }
    const denom = Math.max(expectedSet.size, actualSet.size);
    const score = denom === 0 ? 1 : matched / denom;
    const passed = score === 1;
    return { task_id: task.task_id, passed, score, notes };
  },
};

function isFieldDiffLike(value: unknown): value is FieldDiffLike {
  return !!value && typeof value === "object" && typeof (value as { field?: unknown }).field === "string";
}

function jsonEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function describe(v: unknown): string {
  return JSON.stringify(v);
}
