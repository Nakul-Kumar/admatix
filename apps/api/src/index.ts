/**
 * @admatix/api — HTTP surface over @admatix/agents, @admatix/evidence,
 * and @admatix/evals. Defines NO new domain types — every payload is a
 * schema type from @admatix/schemas wrapped in a thin route DTO.
 *
 * Public surface (see docs/build/WP-J-api-web.md):
 *   buildServer(deps?)   build a Fastify instance, ready to .listen()
 *   startServer(opts?)   convenience: build + listen
 *
 * Route modules are exported so tests can mount or introspect them.
 */
export { buildServer, startServer } from "./server.js";
export type { ApiDeps, ApiOptions } from "./server.js";

export { registerAuditRoutes } from "./routes/audit.js";
export { registerPacketsRoutes } from "./routes/packets.js";
export { registerApprovalsRoutes } from "./routes/approvals.js";
export { registerBenchmarksRoutes } from "./routes/benchmarks.js";
