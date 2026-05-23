import Fastify, {
  type FastifyInstance,
  type FastifyServerOptions,
} from "fastify";
import { createStore, type Store } from "@admatix/core";
import { registerAuditRoutes } from "./routes/audit.js";
import { registerPacketsRoutes } from "./routes/packets.js";
import { registerApprovalsRoutes } from "./routes/approvals.js";
import { registerBenchmarksRoutes } from "./routes/benchmarks.js";

export interface ApiDeps {
  /** Override the default JSON-on-disk Store. */
  store?: Store;
}

export interface ApiOptions extends FastifyServerOptions {
  host?: string;
  port?: number;
  deps?: ApiDeps;
}

/** Build a Fastify instance with every AdMatix route registered. */
export async function buildServer(opts: ApiOptions = {}): Promise<FastifyInstance> {
  const { host: _host, port: _port, deps: _deps, ...fastifyOpts } = opts;
  const app = Fastify({ logger: { level: "info" }, ...fastifyOpts });
  const store = opts.deps?.store ?? createStore();

  app.get("/healthz", async () => ({ ok: true, service: "admatix-api" }));

  await app.register((instance, _o, done) => {
    registerAuditRoutes(instance, { store });
    registerPacketsRoutes(instance, { store });
    registerApprovalsRoutes(instance, { store });
    registerBenchmarksRoutes(instance, { store });
    done();
  });

  return app;
}

/** Build + listen. Returns the running instance. */
export async function startServer(opts: ApiOptions = {}): Promise<FastifyInstance> {
  const app = await buildServer(opts);
  const port = opts.port ?? Number(process.env["ADMATIX_API_PORT"] ?? 4001);
  const host = opts.host ?? process.env["ADMATIX_API_HOST"] ?? "127.0.0.1";
  await app.listen({ port, host });
  return app;
}

const isMain =
  typeof process !== "undefined" &&
  Array.isArray(process.argv) &&
  process.argv[1] !== undefined &&
  /server\.(t|j)s$/.test(process.argv[1]);
if (isMain) {
  startServer().catch((err) => {
    // eslint-disable-next-line no-console
    console.error("[admatix-api] failed to start:", err);
    process.exit(1);
  });
}
