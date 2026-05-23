/**
 * @admatix/core — deterministic primitives shared by every other package.
 *
 * Public surface is fixed in `docs/architecture/ARCHITECTURE-DEEP.md` §3.
 * Keep this file pure re-exports; do not add new domain types here — the
 * contract is owned by `@admatix/schemas`.
 */
export { sha256 } from "./hash.js";
export { newId, nowIso } from "./id.js";
export { createStore } from "./store.js";
export type { Store, CreateStoreOptions } from "./store.js";
export { createSupabaseStore } from "./store-supabase.js";
export type { SupabaseStoreOptions } from "./store-supabase.js";
export { normalizeMetrics } from "./normalize.js";
export { computeImpact } from "./impact.js";
export type { ImpactResult } from "./impact.js";
