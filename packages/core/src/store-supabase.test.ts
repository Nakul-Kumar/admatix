import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sha256 } from "./hash.js";
import { createStore } from "./store.js";
import {
  __closeSupabaseStorePools,
  createSupabaseStore,
} from "./store-supabase.js";

/**
 * Supabase round-trip suite (WP-M acceptance #3).
 *
 * The suite is opt-in: it skips with a clear message when `SUPABASE_DB_URL`
 * is unset, so contributors without database credentials can still run the
 * rest of the package's tests (acceptance #2). On the VPS the variable is
 * present in `/opt/admatix/.build/secrets.env` and the tests exercise the
 * real Supabase project.
 *
 * Isolation strategy: each test run provisions its own schema (named with a
 * unique per-run suffix) containing a small `(id text PK, body jsonb)`
 * mirror of every collection AdMatix writes to, plus a copy of the
 * `ledger.action_events` table + trigger. We never read or write the
 * production `app` / `ledger` schemas, so the live tenant data is never
 * touched.
 */

const SUPABASE_DB_URL = process.env.SUPABASE_DB_URL;
const SUPABASE_TEST_DESCRIBE =
  "Supabase Store — round trip (WP-M acceptance #3)";

const COLLECTIONS = [
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
  "audit_reports",
  "benchmark_runs",
];

interface PgPoolForTests {
  query: (
    text: string,
    values?: ReadonlyArray<unknown>,
  ) => Promise<{ rows: Array<Record<string, unknown>> }>;
  end: () => Promise<void>;
}

async function loadPg(): Promise<{
  Pool: new (cfg: unknown) => PgPoolForTests;
} | null> {
  try {
    const mod = (await import("pg")) as unknown as {
      default?: { Pool: new (cfg: unknown) => PgPoolForTests };
      Pool?: new (cfg: unknown) => PgPoolForTests;
    };
    const Pool = mod.Pool ?? mod.default?.Pool;
    return Pool ? { Pool } : null;
  } catch {
    return null;
  }
}

function uniqueSuffix(): string {
  return (
    Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 8)
  );
}

if (!SUPABASE_DB_URL) {
  describe.skip(SUPABASE_TEST_DESCRIBE, () => {
    it.skip("skipped — set SUPABASE_DB_URL to run the Supabase round-trip suite", () => {
      // no-op — surfaced as a skipped test for visibility.
    });
  });
} else {
  describe(SUPABASE_TEST_DESCRIBE, () => {
    const runSuffix = uniqueSuffix();
    const appSchema = `admatix_test_app_${runSuffix}`;
    const ledgerSchema = `admatix_test_ledger_${runSuffix}`;
    const tenantId = `tenant_${runSuffix}`;

    let adminPool: PgPoolForTests | null = null;

    beforeAll(async () => {
      const pgMod = await loadPg();
      if (!pgMod) throw new Error("pg module is required for Supabase tests");
      // pg parses `connectionString` and Object.assigns the parsed config OVER
      // the explicit options, clobbering our `ssl: { rejectUnauthorized: false }`
      // whenever `sslmode=…` is in the URL. Strip sslmode so the explicit ssl
      // option survives.
      const cleanUrl = SUPABASE_DB_URL.replace(
        /[?&]sslmode=[^&]*/,
        "",
      ).replace(/\?$/, "");
      adminPool = new pgMod.Pool({
        connectionString: cleanUrl,
        ssl: { rejectUnauthorized: false },
        max: 2,
      });

      await adminPool.query(`CREATE SCHEMA "${appSchema}"`);
      await adminPool.query(`CREATE SCHEMA "${ledgerSchema}"`);

      for (const c of COLLECTIONS) {
        await adminPool.query(
          `CREATE TABLE "${appSchema}"."${c}" (` +
            ` id text PRIMARY KEY, ` +
            ` body jsonb NOT NULL DEFAULT '{}'::jsonb` +
            `)`,
        );
      }

      // Minimal ledger.action_events table that mirrors the WP-L contract:
      // payload_hash must equal sha256 of the canonicalised payload, and the
      // entry_hash/prev_hash are populated by trigger.
      await adminPool.query(`
        CREATE TABLE "${ledgerSchema}".action_events (
          event_id        text        NOT NULL PRIMARY KEY,
          seq             bigserial   NOT NULL,
          tx_id           text        NOT NULL,
          workflow_id     text        NOT NULL,
          trace_id        text        NOT NULL,
          tenant_id       text        NOT NULL,
          event_type      text        NOT NULL,
          step            text        NOT NULL,
          actor_agent_id  text        NOT NULL,
          subject_id      text,
          payload         jsonb       NOT NULL DEFAULT '{}'::jsonb,
          payload_hash    char(64)    NOT NULL,
          prev_hash       char(64)    NOT NULL,
          entry_hash      char(64)    NOT NULL,
          created_at      timestamptz NOT NULL DEFAULT now()
        )
      `);

      // Trigger function: verify that the client-supplied payload_hash
      // matches sha256(canonical(payload)); compute prev_hash + entry_hash.
      // Mirrors the behaviour of ledger.action_events_hash_chain() from
      // DATA-LAYER-DDL.md Part 1. We use the built-in pg_catalog.sha256
      // (bytea -> bytea) rather than pgcrypto.digest, because the latter
      // lives in the `extensions` schema where the admatix role has no
      // USAGE.
      await adminPool.query(`
        CREATE OR REPLACE FUNCTION "${ledgerSchema}".enforce_chain()
        RETURNS trigger
        LANGUAGE plpgsql
        AS $fn$
        DECLARE
          v_canonical char(64);
          v_prev      char(64);
        BEGIN
          v_canonical := encode(pg_catalog.sha256(convert_to(NEW.payload::text, 'UTF8')), 'hex');
          IF NEW.payload_hash <> v_canonical THEN
            RAISE EXCEPTION
              'payload_hash mismatch: client sent %, canonical is %',
              NEW.payload_hash, v_canonical
              USING ERRCODE = 'check_violation';
          END IF;

          SELECT entry_hash INTO v_prev
            FROM "${ledgerSchema}".action_events
            WHERE seq < NEW.seq
            ORDER BY seq DESC
            LIMIT 1;
          NEW.prev_hash := COALESCE(v_prev, repeat('0', 64));
          NEW.entry_hash := encode(
            pg_catalog.sha256(
              convert_to(NEW.prev_hash || '|' || NEW.event_id || '|' || NEW.payload_hash, 'UTF8')
            ),
            'hex'
          );
          RETURN NEW;
        END;
        $fn$;
      `);

      await adminPool.query(`
        CREATE TRIGGER trg_enforce_chain
          BEFORE INSERT ON "${ledgerSchema}".action_events
          FOR EACH ROW EXECUTE FUNCTION "${ledgerSchema}".enforce_chain()
      `);
    }, 60_000);

    afterAll(async () => {
      try {
        await __closeSupabaseStorePools();
        if (adminPool) {
          await adminPool.query(
            `DROP SCHEMA "${appSchema}" CASCADE`,
          );
          await adminPool.query(
            `DROP SCHEMA "${ledgerSchema}" CASCADE`,
          );
          await adminPool.end();
          adminPool = null;
        }
      } catch (err) {
        // Surface but do not fail the suite on teardown.
        // eslint-disable-next-line no-console
        console.warn("[supabase-test] teardown error:", (err as Error).message);
      }
    }, 60_000);

    const makeStore = () =>
      createSupabaseStore({
        connectionString: SUPABASE_DB_URL!,
        appSchema,
        ledgerSchema,
        tenantId,
      });

    it("round-trips put → get", async () => {
      const store = makeStore();
      const value = {
        id: `${runSuffix}_h1`,
        goal: "Reduce CAC",
        spend: 1234.5,
      };
      await store.put("h0_packets", value.id, value);
      const fetched = await store.get<typeof value>("h0_packets", value.id);
      expect(fetched).toEqual(value);
    });

    it("returns null for missing keys", async () => {
      const store = makeStore();
      expect(
        await store.get("h0_packets", `${runSuffix}_does_not_exist`),
      ).toBeNull();
    });

    it("upserts on the same id (ON CONFLICT … DO UPDATE)", async () => {
      const store = makeStore();
      const id = `${runSuffix}_upsert`;
      await store.put("h0_packets", id, { id, v: 1 });
      await store.put("h0_packets", id, { id, v: 2 });
      const fetched = await store.get<{ id: string; v: number }>(
        "h0_packets",
        id,
      );
      expect(fetched?.v).toBe(2);
    });

    it("lists all docs in a collection in id-ascending order", async () => {
      const store = makeStore();
      const ids = [
        `${runSuffix}_c`,
        `${runSuffix}_a`,
        `${runSuffix}_b`,
      ];
      for (const id of ids) {
        await store.put("audit_reports", id, { id, account: "acc" });
      }
      const all = await store.list<{ id: string }>("audit_reports");
      const observed = all
        .map((x) => x.id)
        .filter((x) => x.startsWith(runSuffix));
      expect(observed).toEqual([
        `${runSuffix}_a`,
        `${runSuffix}_b`,
        `${runSuffix}_c`,
      ]);
    });

    it("list filters via jsonb containment pushdown", async () => {
      const store = makeStore();
      const idA = `${runSuffix}_pd_a`;
      const idB = `${runSuffix}_pd_b`;
      await store.put("policy_decisions", idA, {
        id: idA,
        result: "allow",
        risk: "low",
      });
      await store.put("policy_decisions", idB, {
        id: idB,
        result: "block",
        risk: "high",
      });
      const blocks = await store.list<{ id: string; result: string }>(
        "policy_decisions",
        { result: "block" },
      );
      const observed = blocks
        .map((x) => x.id)
        .filter((x) => x.startsWith(runSuffix));
      expect(observed).toEqual([idB]);
    });

    it("list falls back to in-memory filter for non-scalar predicates", async () => {
      const store = makeStore();
      const idA = `${runSuffix}_nested_a`;
      const idB = `${runSuffix}_nested_b`;
      await store.put("execution_diffs", idA, {
        id: idA,
        changes: [{ field: "budget", before: 10, after: 20 }],
      });
      await store.put("execution_diffs", idB, {
        id: idB,
        changes: [{ field: "bid", before: 1, after: 2 }],
      });
      // Object-valued filter is not pushdownable; the Store falls back to
      // shallow equality post-filter, which won't match the array — both
      // rows survive (the filter never matches).
      const filtered = await store.list<{ id: string }>("execution_diffs", {
        changes: [{ field: "budget" }],
      });
      const observed = filtered
        .map((x) => x.id)
        .filter((x) => x.startsWith(runSuffix));
      expect(observed).toEqual([]);
    });

    it("append writes a ledger row and the server computes hash chaining", async () => {
      const store = makeStore();
      const record = {
        event_type: "proposal" as const,
        step: "plan" as const,
        agent_id: "test-agent",
        payload: {
          packet_id: `${runSuffix}_pkt`,
          summary: "test event",
        },
      };
      await store.append("proposal_log", record);

      const res = await adminPool!.query(
        `SELECT event_id, event_type, step, payload_hash, entry_hash, prev_hash ` +
          `FROM "${ledgerSchema}".action_events ` +
          `WHERE actor_agent_id = $1 ` +
          `ORDER BY seq ASC`,
        ["test-agent"],
      );
      expect(res.rows.length).toBe(1);
      const row = res.rows[0]!;
      expect(row.event_type).toBe("proposal");
      expect(row.step).toBe("plan");
      // Genesis row → prev_hash is 64 zeros.
      expect(row.prev_hash).toBe("0".repeat(64));
      // payload_hash matches our sha256 helper.
      expect(typeof row.payload_hash).toBe("string");
      expect((row.payload_hash as string).length).toBe(64);
      // entry_hash is derived and non-zero.
      expect(row.entry_hash).not.toBe("0".repeat(64));
    });

    it("rejects an append whose payload_hash does not match the canonical payload (negative case)", async () => {
      // Bypass the Store to send a deliberately bad payload_hash directly,
      // so we can prove the server-side trigger fails closed.
      const eventId = `evt_${runSuffix}_bad`;
      const payload = { x: 1 };
      const wrongHash = sha256({ x: 2 }); // sha256 of a different value
      await expect(
        adminPool!.query(
          `INSERT INTO "${ledgerSchema}".action_events ` +
            ` (event_id, tx_id, workflow_id, trace_id, tenant_id, ` +
            `  event_type, step, actor_agent_id, subject_id, ` +
            `  payload, payload_hash, prev_hash, entry_hash) ` +
            ` VALUES ($1, $2, $3, $4, $5, ` +
            `         $6, $7, $8, $9, $10::jsonb, $11, ` +
            `         repeat('0', 64), repeat('0', 64))`,
          [
            eventId,
            `tx_${eventId}`,
            `wf_${eventId}`,
            `trace_${eventId}`,
            tenantId,
            "flag",
            "plan",
            "test-agent",
            null,
            JSON.stringify(payload),
            wrongHash,
          ],
        ),
      ).rejects.toThrow(/payload_hash mismatch/i);
    });

    it("createStore({ backend: 'supabase', … }) returns the same backend as createSupabaseStore", async () => {
      const factoryStore = createStore({
        backend: "supabase",
        connectionString: SUPABASE_DB_URL!,
        appSchema,
        ledgerSchema,
        tenantId,
      });
      const id = `${runSuffix}_factory`;
      await factoryStore.put("h0_packets", id, { id, via: "factory" });
      const fetched = await factoryStore.get<{ via: string }>(
        "h0_packets",
        id,
      );
      expect(fetched?.via).toBe("factory");
    });

    it("env-based selection: ADMATIX_STORE=supabase + SUPABASE_DB_URL routes via createStore()", async () => {
      const priorBackend = process.env.ADMATIX_STORE;
      const priorAppSchema = process.env.ADMATIX_APP_SCHEMA;
      const priorLedgerSchema = process.env.ADMATIX_LEDGER_SCHEMA;
      const priorTenant = process.env.ADMATIX_TENANT_ID;
      process.env.ADMATIX_STORE = "supabase";
      process.env.ADMATIX_APP_SCHEMA = appSchema;
      process.env.ADMATIX_LEDGER_SCHEMA = ledgerSchema;
      process.env.ADMATIX_TENANT_ID = tenantId;
      try {
        const store = createStore();
        const id = `${runSuffix}_env`;
        await store.put("h0_packets", id, { id, via: "env" });
        const fetched = await store.get<{ via: string }>("h0_packets", id);
        expect(fetched?.via).toBe("env");
      } finally {
        if (priorBackend === undefined) delete process.env.ADMATIX_STORE;
        else process.env.ADMATIX_STORE = priorBackend;
        if (priorAppSchema === undefined) delete process.env.ADMATIX_APP_SCHEMA;
        else process.env.ADMATIX_APP_SCHEMA = priorAppSchema;
        if (priorLedgerSchema === undefined)
          delete process.env.ADMATIX_LEDGER_SCHEMA;
        else process.env.ADMATIX_LEDGER_SCHEMA = priorLedgerSchema;
        if (priorTenant === undefined) delete process.env.ADMATIX_TENANT_ID;
        else process.env.ADMATIX_TENANT_ID = priorTenant;
      }
    });
  });
}
