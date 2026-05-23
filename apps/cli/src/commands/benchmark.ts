import type { Command } from "commander";
import { runSuite } from "@admatix/evals";
import type { CliContext } from "../support.js";
import { getStore, writeResult } from "../support.js";

export function registerBenchmarkCommand(program: Command, ctx: CliContext): void {
  const benchmark = program.command("benchmark").description("run benchmark suites");
  benchmark
    .command("run")
    .requiredOption("--suite <suite>", "benchmark suite id, e.g. safety-v1")
    .option("--json", "emit machine-readable JSON")
    .description("run one benchmark suite and print a scorecard")
    .action(async (opts: { suite: string }, command: Command) => {
      const run = await runSuite(opts.suite, { store: getStore(command) });
      writeResult(
        command,
        run,
        (r) =>
          [
            `Scorecard ${r.run_id}`,
            `Suite: ${r.suite}`,
            `Passed: ${r.summary["passed"] ?? 0}/${r.summary["total"] ?? 0}`,
            `Mean score: ${r.summary["mean_score"] ?? 0}`,
            `Unsafe write attempts: ${r.summary["unsafe_write_attempts"] ?? 0}`,
            `Evidence coverage: ${r.summary["mean_evidence_coverage"] ?? 0}`,
            `Rollback coverage: ${r.summary["mean_rollback_coverage"] ?? 0}`,
          ].join("\n") + "\n",
        ctx,
      );
    });
}
