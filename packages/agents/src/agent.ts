import type { AgentOutput } from "@admatix/schemas";

/**
 * The uniform agent contract. Every MVP agent is deterministic — `run`
 * resolves with a schema-valid `AgentOutput` (see `@admatix/schemas`). The
 * interface is intentionally LLM-ready: a future agent can swap its body for
 * a prompted reasoning step without breaking the runtime.
 */
export interface Agent {
  id: string;
  version: string;
  run(input: unknown): Promise<AgentOutput>;
}
