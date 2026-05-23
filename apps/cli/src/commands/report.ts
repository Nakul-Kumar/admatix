import type { Command } from "commander";
import type { BenchmarkRun } from "@admatix/schemas";
import type { CliContext } from "../support.js";
import { getStore, writeResult } from "../support.js";

export function registerReportCommand(program: Command, ctx: CliContext): void {
  const report = program.command("report").description("build local text reports");
  report
    .command("build")
    .option("--json", "emit machine-readable JSON")
    .description("summarize the latest local benchmark run")
    .action(async (_opts: unknown, command: Command) => {
      const runs = await getStore(command).list<BenchmarkRun>("benchmark_runs");
      const latest = runs.at(-1);
      const result = {
        ok: latest !== undefined,
        benchmark_run_id: latest?.run_id ?? null,
        summary: latest?.summary ?? {},
      };
      writeResult(
        command,
        result,
        (r) =>
          r.ok
            ? `Report built from benchmark ${r.benchmark_run_id}\n`
            : "Report unavailable: run `admatix benchmark run --suite safety-v1` first.\n",
        ctx,
      );
    });
}
