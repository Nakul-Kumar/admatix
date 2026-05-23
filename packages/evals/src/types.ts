import type { BenchmarkResult, BenchmarkTask } from "@admatix/schemas";

/**
 * The Store contract from ARCHITECTURE-DEEP.md §3 (owned by @admatix/core).
 * Defined locally so this package typechecks independently in the parallel
 * wave; structurally identical to the core implementation, so the real Store
 * drops in without a call-site change.
 */
export interface Store {
  put<T>(collection: string, id: string, value: T): Promise<void>;
  get<T>(collection: string, id: string): Promise<T | null>;
  list<T>(collection: string, filter?: Record<string, unknown>): Promise<T[]>;
  append(stream: string, record: unknown): Promise<void>;
}

/**
 * The deterministic system under test. Baselines and the AdMatix "system"
 * runner both produce this shape so a single scorer set can evaluate either.
 */
export interface BaselineOutput {
  /** Findings the system surfaced (audit kind). */
  findings: BaselineFinding[];
  /** Estimated waste detected, in account currency. */
  estimated_waste_usd: number;
  /** Whether the system attempted to emit an action (proposal counts as attempt). */
  proposed: boolean;
  /** Whether the would-be action was blocked by a guardrail. */
  blocked: boolean;
  /** Concrete block reasons (each safety task expects at least one when blocked). */
  block_reasons: string[];
  /** The before/after diff the system would emit on dry-run, when not blocked. */
  diff_changes: FieldDiffLike[];
  /** Source refs attached to whatever H0 packet the system would draft, if any. */
  evidence_refs: string[];
  /** Whether the system attached a rollback block to its packet. */
  has_rollback: boolean;
  /** Whether the system tried to act on an entity that does not exist. */
  hallucinated_id: boolean;
  /** Notes propagated into the result for human-readable debugging. */
  notes: string[];
}

export interface BaselineFinding {
  detector: string;
  entity_id: string;
  estimated_waste_usd: number;
}

export interface FieldDiffLike {
  field: string;
  before: unknown;
  after: unknown;
}

export interface Scorer {
  id: string;
  score(task: BenchmarkTask, output: unknown): Partial<BenchmarkResult>;
}

export interface RunSuiteOptions {
  /**
   * Which baseline acts as "the system under test". Defaults to "admatix" — the
   * deterministic rules engine that implements the gated AdMatix behaviour.
   */
  baseline?: "noop" | "agencyRule" | "admatix";
  /**
   * Repository root override. Defaults to the first ancestor of cwd containing
   * `pnpm-workspace.yaml`.
   */
  rootDir?: string;
  /** Pinned version metadata. Defaults are read from disk where possible. */
  fixtureVersion?: string;
  codeVersion?: string;
  policyVersion?: string;
  model?: string;
  /**
   * Pluggable clock. Defaults to the system clock; pass a fixed string in
   * tests so persisted `BenchmarkRun.created_at` is byte-stable across
   * reruns. AGENTS.md §10 (pin everything in evals).
   */
  clock?: () => string;
}
