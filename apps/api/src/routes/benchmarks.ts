import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  BenchmarkRun,
  type BenchmarkRun as BenchmarkRunT,
} from "@admatix/schemas";
import type { Store } from "@admatix/core";
import { runSuite } from "@admatix/evals";

const BenchmarkRunRequest = z.object({
  suite: z.string().default("safety-v1"),
  baseline: z.enum(["noop", "agencyRule", "admatix"]).optional(),
});

export interface BenchmarksDeps {
  store: Store;
}

/** Benchmark routes — kick off a run, read the latest, list history. */
export function registerBenchmarksRoutes(app: FastifyInstance, deps: BenchmarksDeps): void {
  app.post("/api/v1/benchmarks/run", async (req, reply) => {
    const parsed = BenchmarkRunRequest.safeParse(req.body ?? {});
    if (!parsed.success) {
      reply.code(400);
      return { error: "invalid_request", issues: parsed.error.issues };
    }
    const opts = parsed.data.baseline !== undefined ? { baseline: parsed.data.baseline } : {};
    const run = await runSuite(parsed.data.suite, { store: deps.store }, opts);
    return BenchmarkRun.parse(run);
  });

  app.get("/api/v1/benchmarks/latest", async (req, reply) => {
    const query = z.object({ suite: z.string().optional() }).safeParse(req.query);
    const wantedSuite = query.success ? query.data.suite : undefined;
    const runs = await deps.store.list<BenchmarkRunT>("benchmark_runs");
    const filtered = wantedSuite
      ? runs.filter((r) => r.suite === wantedSuite)
      : runs;
    if (filtered.length === 0) {
      reply.code(404);
      return { error: "no_runs_found" };
    }
    filtered.sort((a, b) => b.created_at.localeCompare(a.created_at));
    const head = filtered[0];
    if (!head) {
      reply.code(404);
      return { error: "no_runs_found" };
    }
    return BenchmarkRun.parse(head);
  });

  app.get("/api/v1/benchmarks", async () => {
    const runs = await deps.store.list<BenchmarkRunT>("benchmark_runs");
    return { runs: runs.map((r) => BenchmarkRun.parse(r)) };
  });
}
