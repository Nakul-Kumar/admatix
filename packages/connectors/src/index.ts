/**
 * @admatix/connectors — read-only adapters over a uniform `Connector` interface.
 *
 * MVP rule: every connector is READ-ONLY. The interface defines no write methods,
 * so no caller can mutate a platform through this package. Live adapters are
 * post-MVP; today only `fixtureConnector()` (reading `data/fixtures/`) is wired up.
 */
export type { Connector } from "./connector.js";
export { fixtureConnector } from "./fixture-connector.js";
export { resolveAccountRef } from "./resolve-ref.js";
export type { AccountRef } from "./resolve-ref.js";
