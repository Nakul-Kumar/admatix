import type { ToolResultEnvelope } from "../server.js";

export interface RunBenchmarkInput {
  suite: string;
}

export async function runBenchmarkTool(
  _input: RunBenchmarkInput,
): Promise<ToolResultEnvelope> {
  throw new Error("runBenchmarkTool: interface stub");
}
