import { rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const migration = resolve(
  repoRoot,
  "warehouse/migrations/0006_diligence_replay_constraints.sql",
);

const psql = process.env.PSQL_BIN ?? "psql";
const runPostgresTests = process.env.ADMATIX_TEST_POSTGRES_URL !== undefined;

describe.skipIf(!runPostgresTests)("diligence replay constraints migration", () => {
  const schemas: string[] = [];

  afterEach(async () => {
    for (const schema of schemas.splice(0)) {
      runSql(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    }
  });

  it("replays safely on relational app tables and blocks duplicate receipts/diffs", () => {
    const appSchema = makeSchemaName("app_rel");
    schemas.push(appSchema);
    runSql(baseRelationalSchemaSql(appSchema));

    runMigrationForSchema(appSchema);
    runMigrationForSchema(appSchema);

    const tenant = "00000000-0000-0000-0000-000000000001";
    const packet = "00000000-0000-0000-0000-000000000002";
    const action = "00000000-0000-0000-0000-000000000003";
    runSql(`
      INSERT INTO "${appSchema}".approval_receipts (
        approval_receipt_id, h0_packet_id, proposed_action_id, tenant_id,
        decision, decided_by, role, decided_at, expires_at, signature
      ) VALUES (
        gen_random_uuid(), '${packet}', '${action}', '${tenant}',
        'approved', 'operator', 'approver',
        '2026-05-24T00:00:00Z', '2026-05-24T00:15:00Z',
        '${"a".repeat(64)}'
      );
    `);

    expect(() =>
      runSql(`
        INSERT INTO "${appSchema}".approval_receipts (
          approval_receipt_id, h0_packet_id, proposed_action_id, tenant_id,
          decision, decided_by, role, decided_at, expires_at, signature
        ) VALUES (
          gen_random_uuid(), '${packet}', '${action}', '${tenant}',
          'rejected', 'operator', 'approver',
          '2026-05-24T00:01:00Z', '2026-05-24T00:16:00Z',
          '${"b".repeat(64)}'
        );
      `),
    ).toThrow(/uq_approval_receipts_action_once|duplicate key/i);

    runSql(`
      INSERT INTO "${appSchema}".execution_diffs (
        execution_diff_id, proposed_action_id, tenant_id, entity_id, changes, dry_run
      ) VALUES (
        gen_random_uuid(), '${action}', '${tenant}', 'campaign_1', '[]'::jsonb, true
      );
    `);

    expect(() =>
      runSql(`
        INSERT INTO "${appSchema}".execution_diffs (
          execution_diff_id, proposed_action_id, tenant_id, entity_id, changes, dry_run
        ) VALUES (
          gen_random_uuid(), '${action}', '${tenant}', 'campaign_1', '[]'::jsonb, true
        );
      `),
    ).toThrow(/uq_execution_diffs_action_once|duplicate key/i);

    expect(() =>
      runSql(`
        INSERT INTO "${appSchema}".approval_receipts (
          approval_receipt_id, h0_packet_id, proposed_action_id, tenant_id,
          decision, decided_by, role, decided_at, expires_at, signature
        ) VALUES (
          gen_random_uuid(), '00000000-0000-0000-0000-000000000004',
          '00000000-0000-0000-0000-000000000005', '${tenant}',
          'approved', 'operator', 'approver',
          '2026-05-24T00:15:00Z', '2026-05-24T00:10:00Z',
          '${"c".repeat(64)}'
        );
      `),
    ).toThrow(/ck_approval_receipts_expiry_after_decision|violates check/i);
  });

  it("adds JSONB Store replay guards when generic body tables exist", () => {
    const appSchema = makeSchemaName("app_body");
    schemas.push(appSchema);
    runSql(`
      CREATE SCHEMA "${appSchema}";
      CREATE TABLE "${appSchema}".approval_receipts (
        id text PRIMARY KEY,
        body jsonb NOT NULL DEFAULT '{}'::jsonb
      );
      CREATE TABLE "${appSchema}".execution_diffs (
        id text PRIMARY KEY,
        body jsonb NOT NULL DEFAULT '{}'::jsonb
      );
    `);

    runMigrationForSchema(appSchema);

    runSql(`
      INSERT INTO "${appSchema}".approval_receipts (id, body)
      VALUES ('row_1', '{"receipt_id":"rec_1","action_id":"act_1","decision":"approved"}');
    `);
    expect(() =>
      runSql(`
        INSERT INTO "${appSchema}".approval_receipts (id, body)
        VALUES ('row_2', '{"receipt_id":"rec_2","action_id":"act_1","decision":"approved"}');
      `),
    ).toThrow(/uq_store_approval_receipts_action_id|duplicate key/i);

    runSql(`
      INSERT INTO "${appSchema}".execution_diffs (id, body)
      VALUES ('diff_1', '{"diff_id":"diff_1","action_id":"act_1"}');
    `);
    expect(() =>
      runSql(`
        INSERT INTO "${appSchema}".execution_diffs (id, body)
        VALUES ('diff_2', '{"diff_id":"diff_2","action_id":"act_1"}');
      `),
    ).toThrow(/uq_store_execution_diffs_action_id|duplicate key/i);
  });
});

function makeSchemaName(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random()
    .toString(36)
    .slice(2, 8)}`;
}

function runMigrationForSchema(appSchema: string): void {
  const sql = `
    DO $$
    BEGIN
      IF EXISTS (SELECT 1 FROM information_schema.schemata WHERE schema_name = 'app') THEN
        RAISE EXCEPTION 'Refusing to run migration test because schema app already exists. Use a disposable empty test database.';
      END IF;
    END;
    $$;
    ALTER SCHEMA "${appSchema}" RENAME TO app;
    \\i '${migration.replace(/\\/g, "/")}'
    ALTER SCHEMA app RENAME TO "${appSchema}";
  `;
  runSql(sql);
}

function baseRelationalSchemaSql(appSchema: string): string {
  return `
    CREATE SCHEMA "${appSchema}";
    DO $$
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = '${appSchema}_approval_decision') THEN
        CREATE TYPE "${appSchema}".approval_decision AS ENUM ('approved', 'rejected');
      END IF;
    END;
    $$;
    CREATE TABLE "${appSchema}".approval_receipts (
      approval_receipt_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      h0_packet_id uuid NOT NULL,
      proposed_action_id uuid NOT NULL,
      tenant_id uuid NOT NULL,
      decision "${appSchema}".approval_decision NOT NULL,
      decided_by text NOT NULL,
      role text NOT NULL,
      decided_at timestamptz NOT NULL DEFAULT now(),
      created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE "${appSchema}".execution_diffs (
      execution_diff_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      proposed_action_id uuid NOT NULL,
      tenant_id uuid NOT NULL,
      entity_id text NOT NULL,
      changes jsonb NOT NULL DEFAULT '[]'::jsonb,
      dry_run boolean NOT NULL DEFAULT true
    );
  `;
}

function runSql(sql: string): void {
  const url = process.env.ADMATIX_TEST_POSTGRES_URL;
  if (!url) throw new Error("ADMATIX_TEST_POSTGRES_URL is not set");
  const dir = tmpdir();
  const tmp = join(dir, `admatix_sql_${Date.now()}_${Math.random()}.sql`);
  writeFileSync(tmp, sql);
  const psqlResult = spawnSync(psql, [url, "-v", "ON_ERROR_STOP=1", "-f", tmp], {
    encoding: "utf8",
  });
  rmSync(tmp, { force: true });
  if (psqlResult.status !== 0) {
    throw new Error(`${psqlResult.stdout}\n${psqlResult.stderr}`);
  }
}
