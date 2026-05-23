/**
 * @admatix/core — Supabase Postgres Store implementation.
 *
 * Drop-in backend for the filesystem `Store`. Selection is environment-driven:
 * existing callers continue to use `createStore(...)` — they get the
 * filesystem store by default and the Supabase store when
 * `ADMATIX_STORE === "supabase"` (and `SUPABASE_DB_URL` is set) or when the
 * factory is explicitly called with `{ backend: "supabase", … }`.
 *
 * Contract (WP-M spec):
 *
 *   put(collection, id, value)
 *     INSERT … ON CONFLICT (id) DO UPDATE on the `<appSchema>.<collection>`
 *     table corresponding to the logical collection name. Bodies are stored
 *     in the jsonb `body` column.
 *
 *   get(collection, id)
 *     SELECT body FROM <appSchema>.<collection> WHERE id = $1.
 *
 *   list(collection, filter?)
 *     SELECT body FROM <appSchema>.<collection>. When `filter` is a plain
 *     {key: scalar} object the equality predicates are pushed down with a
 *     `body @> $1::jsonb` containment check; otherwise the rows are
 *     post-filtered in memory. Results are ordered by `id ASC`, matching the
 *     filesystem store's directory-listing order.
 *
 *   append(stream, record)
 *     INSERT INTO <ledgerSchema>.action_events (… payload, payload_hash). The
 *     server-side trigger computes entry_hash / prev_hash; this code only
 *     supplies tenant_id, stream → event_type/step, payload, payload_hash.
 *
 * The pg `Pool` is created lazily and torn down on `process.exit` / SIGINT /
 * SIGTERM. `pg` is imported dynamically so the dependency stays optional for
 * consumers that only use the filesystem backend.
 */
import { createHash } from "node:crypto";
import type { Store } from "./store.js";

/** Options for {@link createSupabaseStore}. */
export interface SupabaseStoreOptions {
  /** Postgres connection string, e.g. `postgresql://…?sslmode=require`. */
  connectionString: string;
  /**
   * Tenant id stamped on ledger appends. Falls back to
   * `process.env.ADMATIX_TENANT_ID` and finally the system-tenant constant.
   */
  tenantId?: string;
  /** Actor id stamped on ledger appends. Defaults to "admatix-core". */
  actorAgentId?: string;
  /** Schema that holds the logical app collections. Defaults to "app". */
  appSchema?: string;
  /** Schema that holds the ledger. Defaults to "ledger". */
  ledgerSchema?: string;
  /** Optional explicit pool size. */
  maxPoolSize?: number;
}

/**
 * Create a Supabase-backed {@link Store}. The pool is opened lazily on first
 * query.
 *
 * @param opts Supabase connection + identification overrides.
 * @returns A {@link Store} backed by Supabase Postgres.
 */
export function createSupabaseStore(opts: SupabaseStoreOptions): Store {
  return supabaseStoreImpl(opts);
}

/* -------------------------------------------------------------------------- */
/* Collection allow-list. WP-M spec §"Files to create / modify".              */
/* -------------------------------------------------------------------------- */

const ALLOWED_COLLECTIONS = new Set<string>([
  "h0_packets",
  "proposed_actions",
  "policy_decisions",
  "execution_diffs",
  "approval_receipts",
  "rollback_checkpoints",
  "outcome_measurements",
  "trust_scores",
  "agent_runs",
  "audits",
  // The Phase-1 product also writes audit_reports and benchmark_runs. They are
  // accepted by the same path; WP-L is responsible for ensuring the matching
  // tables exist (or aliasing them onto the audits table).
  "audit_reports",
  "benchmark_runs",
]);

const SAFE_IDENT = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

function assertSafeIdent(kind: string, name: string): string {
  if (!SAFE_IDENT.test(name)) {
    throw new Error(
      `SupabaseStore: invalid ${kind} "${name}" — must match ${SAFE_IDENT.source}`,
    );
  }
  return name;
}

function assertKnownCollection(collection: string): string {
  if (!ALLOWED_COLLECTIONS.has(collection)) {
    throw new Error(
      `SupabaseStore: unknown collection "${collection}". ` +
        `Allowed: ${[...ALLOWED_COLLECTIONS].sort().join(", ")}.`,
    );
  }
  return collection;
}

function qualified(schema: string, table: string): string {
  return `"${assertSafeIdent("schema", schema)}"."${assertSafeIdent("table", table)}"`;
}

/* -------------------------------------------------------------------------- */
/* Lazy pool management                                                       */
/* -------------------------------------------------------------------------- */

interface PgPool {
  query: (
    text: string,
    values?: ReadonlyArray<unknown>,
  ) => Promise<{ rows: Array<Record<string, unknown>> }>;
  end: () => Promise<void>;
}

let cachedPools: Map<string, PgPool> | null = null;
let shutdownHooksInstalled = false;

function poolKey(opts: SupabaseStoreOptions): string {
  return `${opts.connectionString}|${opts.maxPoolSize ?? "default"}`;
}

async function loadPg(): Promise<{ Pool: new (cfg: unknown) => PgPool }> {
  try {
    const mod = (await import("pg")) as unknown as {
      default?: { Pool: new (cfg: unknown) => PgPool };
      Pool?: new (cfg: unknown) => PgPool;
    };
    const Pool = mod.Pool ?? mod.default?.Pool;
    if (!Pool) throw new Error("pg.Pool not found");
    return { Pool };
  } catch (err) {
    throw new Error(
      `createSupabaseStore: optional dependency "pg" is not installed. ` +
        `Add it to packages/core/package.json. Cause: ${(err as Error).message}`,
    );
  }
}

function installShutdownHooks(): void {
  if (shutdownHooksInstalled) return;
  shutdownHooksInstalled = true;
  const close = async (): Promise<void> => {
    if (!cachedPools) return;
    const pools = Array.from(cachedPools.values());
    cachedPools = null;
    await Promise.allSettled(pools.map((p) => p.end()));
  };
  process.once("exit", () => {
    void close();
  });
  process.once("SIGINT", () => {
    void close().then(() => process.exit(130));
  });
  process.once("SIGTERM", () => {
    void close().then(() => process.exit(143));
  });
}

async function getPool(opts: SupabaseStoreOptions): Promise<PgPool> {
  if (!cachedPools) cachedPools = new Map();
  installShutdownHooks();
  const key = poolKey(opts);
  const existing = cachedPools.get(key);
  if (existing) return existing;
  const { Pool } = await loadPg();
  // pg parses `connectionString` and Object.assigns the parsed config OVER the
  // explicit options, which would clobber `ssl: { rejectUnauthorized: false }`
  // whenever `sslmode=…` is in the URL. We pre-strip sslmode so the explicit
  // ssl option survives and Supabase's self-signed chain is accepted.
  const { url, hadSsl } = stripSslMode(opts.connectionString);
  const pool = new Pool({
    connectionString: url,
    max: opts.maxPoolSize ?? 4,
    ssl: hadSsl ? { rejectUnauthorized: false } : undefined,
  });
  cachedPools.set(key, pool);
  return pool;
}

function stripSslMode(connectionString: string): {
  url: string;
  hadSsl: boolean;
} {
  const hadSsl = /[?&]sslmode=/i.test(connectionString);
  const cleaned = connectionString
    .replace(/([?&])sslmode=[^&]*&/i, "$1")
    .replace(/[?&]sslmode=[^&]*$/i, "");
  return { url: cleaned, hadSsl };
}

/* -------------------------------------------------------------------------- */
/* Implementation                                                             */
/* -------------------------------------------------------------------------- */

const SYSTEM_TENANT_ID = "00000000-0000-0000-0000-000000000000";

function supabaseStoreImpl(opts: SupabaseStoreOptions): Store {
  const appSchema = assertSafeIdent("appSchema", opts.appSchema ?? "app");
  const ledgerSchema = assertSafeIdent(
    "ledgerSchema",
    opts.ledgerSchema ?? "ledger",
  );
  const actor = opts.actorAgentId ?? "admatix-core";
  const resolveTenant = (): string =>
    opts.tenantId ?? process.env.ADMATIX_TENANT_ID ?? SYSTEM_TENANT_ID;

  return {
    async put<T>(collection: string, id: string, value: T): Promise<void> {
      const table = qualified(appSchema, assertKnownCollection(collection));
      const body = JSON.stringify(asJsonObject(value));
      const sql =
        `INSERT INTO ${table} ("id", "body") ` +
        `VALUES ($1, $2::jsonb) ` +
        `ON CONFLICT ("id") DO UPDATE SET "body" = EXCLUDED."body"`;
      const pool = await getPool(opts);
      await pool.query(sql, [id, body]);
    },

    async get<T>(collection: string, id: string): Promise<T | null> {
      const table = qualified(appSchema, assertKnownCollection(collection));
      const pool = await getPool(opts);
      const res = await pool.query(
        `SELECT "body" AS body FROM ${table} WHERE "id" = $1`,
        [id],
      );
      const row = res.rows[0];
      if (!row) return null;
      return coerceJsonb<T>(row.body);
    },

    async list<T>(
      collection: string,
      filter?: Record<string, unknown>,
    ): Promise<T[]> {
      const table = qualified(appSchema, assertKnownCollection(collection));
      const pool = await getPool(opts);
      const params: unknown[] = [];
      let where = "";
      let needsClientFilter = false;
      if (filter) {
        const pushable = pushdownableFilter(filter);
        if (pushable) {
          params.push(JSON.stringify(pushable));
          where = ` WHERE "body" @> $1::jsonb`;
        } else {
          needsClientFilter = true;
        }
      }
      const sql =
        `SELECT "id" AS id, "body" AS body FROM ${table}${where} ` +
        `ORDER BY "id" ASC`;
      const res = await pool.query(sql, params);
      const out: T[] = [];
      for (const row of res.rows) {
        const value = coerceJsonb<T>(row.body);
        if (
          needsClientFilter &&
          filter &&
          !matchesShallowFilter(value, filter)
        ) {
          continue;
        }
        out.push(value);
      }
      return out;
    },

    async append(stream: string, record: unknown): Promise<void> {
      const pool = await getPool(opts);
      const event = canonicaliseEvent(stream, record, actor);
      const payload = event.payload;
      const payloadJson = JSON.stringify(payload);
      // Hash the Postgres-canonical jsonb rendering of the payload so the
      // server-side trigger (which canonicalises identically via
      // `payload::text`) can validate the client-supplied hash and reject
      // mismatches (WP-M acceptance #3 negative case).
      const payloadHash = sha256OfPgJsonb(payload);
      // event_type and step are sent as plain strings — Postgres coerces them
      // to the matching enum on insert when the column type is an enum, and
      // accepts them directly when the column is text (test schemas).
      const sql =
        `INSERT INTO ${qualified(ledgerSchema, "action_events")} ` +
        `(event_id, tx_id, workflow_id, trace_id, tenant_id, ` +
        ` event_type, step, actor_agent_id, subject_id, payload, payload_hash, ` +
        ` prev_hash, entry_hash) ` +
        `VALUES ($1, $2, $3, $4, $5, ` +
        ` $6, $7, $8, $9, $10::jsonb, $11, ` +
        ` repeat('0', 64), repeat('0', 64))`;
      await pool.query(sql, [
        event.event_id,
        event.tx_id,
        event.workflow_id,
        event.trace_id,
        event.tenant_id ?? resolveTenant(),
        event.event_type,
        event.step,
        event.actor_agent_id,
        event.subject_id,
        payloadJson,
        payloadHash,
      ]);
    },
  };
}

/* -------------------------------------------------------------------------- */
/* Helpers                                                                    */
/* -------------------------------------------------------------------------- */

function asJsonObject(value: unknown): Record<string, unknown> | unknown[] {
  if (value !== null && typeof value === "object") {
    return value as Record<string, unknown> | unknown[];
  }
  return { value };
}

function coerceJsonb<T>(raw: unknown): T {
  if (raw === null || raw === undefined) return raw as T;
  if (typeof raw === "string") {
    try {
      return JSON.parse(raw) as T;
    } catch {
      return raw as unknown as T;
    }
  }
  return raw as T;
}

function pushdownableFilter(
  filter: Record<string, unknown>,
): Record<string, unknown> | null {
  const allowed: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(filter)) {
    if (
      v === null ||
      typeof v === "string" ||
      typeof v === "number" ||
      typeof v === "boolean"
    ) {
      allowed[k] = v;
    } else {
      return null;
    }
  }
  return Object.keys(allowed).length > 0 ? allowed : null;
}

function matchesShallowFilter(
  value: unknown,
  filter: Record<string, unknown>,
): boolean {
  if (value === null || typeof value !== "object") return false;
  const obj = value as Record<string, unknown>;
  for (const [k, expected] of Object.entries(filter)) {
    if (obj[k] !== expected) return false;
  }
  return true;
}

const LEDGER_EVENT_TYPES = new Set([
  "proposal",
  "gate_decision",
  "approval",
  "execution_diff",
  "measurement",
  "reflection",
  "flag",
]);

const LEDGER_STEPS = new Set(["plan", "activate", "measure", "reflect"]);

interface LedgerEvent {
  event_id: string;
  tx_id: string;
  workflow_id: string;
  trace_id: string;
  tenant_id?: string;
  event_type: string;
  step: string;
  actor_agent_id: string;
  subject_id: string | null;
  payload: Record<string, unknown>;
}

function canonicaliseEvent(
  stream: string,
  record: unknown,
  defaultActor: string,
): LedgerEvent {
  const rec =
    record && typeof record === "object"
      ? (record as Record<string, unknown>)
      : { value: record };
  const payload =
    rec.payload && typeof rec.payload === "object"
      ? (rec.payload as Record<string, unknown>)
      : (rec as Record<string, unknown>);
  const eventType = pickKnown(rec, "event_type", LEDGER_EVENT_TYPES)
    ?? pickKnown(rec, "type", LEDGER_EVENT_TYPES)
    ?? streamToEventType(stream);
  const step = pickKnown(rec, "step", LEDGER_STEPS) ?? streamToStep(stream);
  const eventId =
    pickString(rec, "event_id") ?? pickString(rec, "id") ?? generateEventId();
  return {
    event_id: eventId,
    tx_id: pickString(rec, "tx_id") ?? `tx_${eventId}`,
    workflow_id: pickString(rec, "workflow_id") ?? stream,
    trace_id: pickString(rec, "trace_id") ?? `trace_${eventId}`,
    tenant_id: pickString(rec, "tenant_id") ?? undefined,
    event_type: eventType,
    step,
    actor_agent_id: pickString(rec, "agent_id") ?? defaultActor,
    subject_id:
      pickString(rec, "subject_id") ?? pickString(rec, "packet_id") ?? null,
    payload,
  };
}

function pickString(b: Record<string, unknown>, k: string): string | null {
  const v = b[k];
  return typeof v === "string" && v.length > 0 ? v : null;
}

function pickKnown(
  b: Record<string, unknown>,
  k: string,
  allowed: Set<string>,
): string | null {
  const v = b[k];
  return typeof v === "string" && allowed.has(v) ? v : null;
}

function streamToEventType(stream: string): string {
  const s = stream.toLowerCase();
  if (s.includes("proposal")) return "proposal";
  if (s.includes("gate")) return "gate_decision";
  if (s.includes("approval")) return "approval";
  if (s.includes("execution") || s.includes("diff")) return "execution_diff";
  if (s.includes("measurement") || s.includes("measure")) return "measurement";
  if (s.includes("reflect")) return "reflection";
  return "flag";
}

function streamToStep(stream: string): string {
  const s = stream.toLowerCase();
  if (s.includes("activate") || s.includes("gate") || s.includes("diff")) {
    return "activate";
  }
  if (s.includes("measure")) return "measure";
  if (s.includes("reflect")) return "reflect";
  return "plan";
}

/**
 * Render a JSON-serialisable value in Postgres's exact jsonb text form: object
 * keys sorted by (length, then lex); `": "` between key/value; `", "` between
 * members; no spaces around braces or brackets; numbers and strings serialised
 * with standard JSON escaping. Matches what `SELECT payload::text` returns for
 * the same logical value, so a sha256 of this string equals what the ledger
 * trigger computes on the server.
 */
function pgJsonbCanonical(value: unknown): string {
  if (value === null || value === undefined) return "null";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new Error(
        `pgJsonbCanonical: cannot render non-finite number ${String(value)}`,
      );
    }
    return JSON.stringify(value);
  }
  if (typeof value === "string") return JSON.stringify(value);
  if (Array.isArray(value)) {
    return "[" + value.map(pgJsonbCanonical).join(", ") + "]";
  }
  if (typeof value === "object") {
    const obj = value as Record<string, unknown>;
    const keys = Object.keys(obj)
      .filter((k) => obj[k] !== undefined)
      .sort((a, b) => (a.length - b.length) || (a < b ? -1 : a > b ? 1 : 0));
    return (
      "{" +
      keys
        .map(
          (k) => JSON.stringify(k) + ": " + pgJsonbCanonical(obj[k]),
        )
        .join(", ") +
      "}"
    );
  }
  throw new Error(`pgJsonbCanonical: unsupported type ${typeof value}`);
}

function sha256OfPgJsonb(value: unknown): string {
  return createHash("sha256").update(pgJsonbCanonical(value)).digest("hex");
}

function generateEventId(): string {
  return `evt_${Date.now().toString(36)}_${Math.random()
    .toString(36)
    .slice(2, 10)}`;
}

/* -------------------------------------------------------------------------- */
/* Test-only export                                                           */
/* -------------------------------------------------------------------------- */

/**
 * Close every cached pool. Exposed for tests; not part of the public Store
 * contract.
 */
export async function __closeSupabaseStorePools(): Promise<void> {
  if (!cachedPools) return;
  const pools = Array.from(cachedPools.values());
  cachedPools = null;
  await Promise.allSettled(pools.map((p) => p.end()));
}
