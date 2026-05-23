/**
 * AdMatix end-to-end demo (WP-K).
 *
 * Wires every shipped package and app into one narratable transcript:
 *
 *   audit → plan → packet → activate (dry-run) → policy-block (unsafe)
 *           → benchmark → MCP read-only surface → ROI / cockpit data
 *
 * The transcript printed to stdout is fully deterministic — same fixtures,
 * same demo, same bytes. `docs/runbooks/demo-script.md` embeds the same
 * transcript and `tests/e2e/demo-flow.test.ts` asserts the bytes match
 * line-for-line.
 *
 * Public surface — also imported by the e2e test:
 *   runDemo({ output? }) → DemoResult
 *   The CLI form `pnpm tsx scripts/demo.ts` calls runDemo with stdout.
 */
import type {
  AuditReport,
  BenchmarkRun,
  ExecutionDiff,
  H0Packet,
  PolicyDecision,
} from "@admatix/schemas";

export interface DemoOptions {
  /** Where to write the human transcript. Defaults to `process.stdout`. */
  readonly output?: NodeJS.WritableStream;
  /**
   * Override the temp data dir. Mostly for tests; defaults to a fresh
   * `mkdtemp` under the OS tmpdir which is cleaned up after the run.
   */
  readonly storeRoot?: string;
}

export interface DemoStepResult {
  readonly id: number;
  readonly title: string;
  readonly ok: boolean;
  /** Optional structured payload for assertions in the e2e test. */
  readonly data?: unknown;
}

export interface DemoResult {
  readonly steps: DemoStepResult[];
  readonly transcript: string;
  readonly storeRoot: string;
  readonly artifacts: {
    readonly audit: AuditReport;
    readonly packets: H0Packet[];
    readonly diff: ExecutionDiff;
    readonly blockDecision: PolicyDecision;
    readonly benchmark: BenchmarkRun;
    readonly cockpit: { healthz: unknown; audits: number; packets: number; receipts: number };
  };
}

/**
 * Run the full 8-step AdMatix demo on fixtures. Throws on any acceptance
 * failure; the CLI entrypoint translates that into a non-zero exit.
 *
 * Stub: full implementation lands in the next commit (interface-first rule).
 */
export async function runDemo(_opts: DemoOptions = {}): Promise<DemoResult> {
  throw new Error("runDemo: not implemented (interface-first stub)");
}
