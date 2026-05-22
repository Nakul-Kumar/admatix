/**
 * @admatix/schemas — the shared contract for the whole monorepo.
 *
 * Every type and validator lives here. No other package may redefine an
 * H0 packet, metric, action, agent, policy, or benchmark shape. Import it.
 */
export * from "./account.js";
export * from "./metrics.js";
export * from "./h0-packet.js";
export * from "./actions.js";
export * from "./agent.js";
export * from "./policy.js";
export * from "./evidence.js";
export * from "./benchmark.js";

/** Re-export zod so dependents use one zod instance. */
export { z } from "zod";

/** Schema package version — bump on any breaking contract change. */
export const SCHEMA_VERSION = "0.1.0";
