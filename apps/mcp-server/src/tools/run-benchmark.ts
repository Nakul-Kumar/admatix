import { BenchmarkRun, z } from "@admatix/schemas";
import { runSuite } from "@admatix/evals";
import {
  okEnvelope,
  refsFromBenchmark,
  traceFor,
  type ToolContext,
  type ToolResultEnvelope,
} from "./common.js";

export const RunBenchmarkInput = z.object({
  suite: z.string(),
}).strict();
export type RunBenchmarkInput = z.infer<typeof RunBenchmarkInput>;

export async function runBenchmarkTool(
  input: RunBenchmarkInput,
  ctx: ToolContext,
): Promise<ToolResultEnvelope<z.infer<typeof BenchmarkRun>>> {
  const parsed = RunBenchmarkInput.parse(input);
  const run = BenchmarkRun.parse(await runSuite(parsed.suite, { store: ctx.store }));
  return okEnvelope({
    trace_id: traceFor("run_benchmark", parsed),
    source_refs: refsFromBenchmark(run),
    risk_level: "low",
    data: run,
  });
}
