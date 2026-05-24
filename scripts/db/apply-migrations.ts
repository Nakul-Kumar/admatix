import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

import { parse } from "dotenv";
import pg from "pg";

const SECRETS_PATH = "/opt/admatix/.build/secrets.env";
const MIGRATIONS_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "../../warehouse/migrations");
const MIGRATION_FILES = [
  "0000_extensions_roles_helpers.sql",
  "0001_ledger_schema.sql",
  "0002_app_schema.sql",
  "0003_warehouse_bronze_silver.sql",
  "0004_sim_bench_schemas.sql",
  "0005_live_data_readiness.sql",
] as const;

export interface MigrationResult {
  readonly file: string;
  readonly status: "applied" | "already-applied";
}

function sha256Text(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

async function readSupabaseDbUrl(): Promise<string> {
  const env = parse(await readFile(SECRETS_PATH));
  const value = env.SUPABASE_DB_URL;
  if (!value) {
    throw new Error(`SUPABASE_DB_URL is missing from ${SECRETS_PATH}. Add the direct Supabase Postgres URL and retry.`);
  }
  return value;
}

function pgClientUrl(databaseUrl: string): string {
  const url = new URL(databaseUrl);
  url.searchParams.delete("sslmode");
  return url.toString();
}

async function ensureMigrationTable(client: pg.Client): Promise<void> {
  await client.query(`
    CREATE TABLE IF NOT EXISTS public.admatix_schema_migrations (
      filename text PRIMARY KEY,
      checksum char(64) NOT NULL,
      applied_at timestamptz NOT NULL DEFAULT now()
    )
  `);
  await client.query(`
    COMMENT ON TABLE public.admatix_schema_migrations IS
      'Tracks AdMatix SQL migration files applied by scripts/db/apply-migrations.ts.'
  `);
}

async function hasMigration(client: pg.Client, file: string): Promise<boolean> {
  const result = await client.query<{ exists: boolean }>(
    "SELECT EXISTS (SELECT 1 FROM public.admatix_schema_migrations WHERE filename = $1) AS exists",
    [file],
  );
  return result.rows[0]?.exists === true;
}

async function recordMigration(client: pg.Client, file: string, checksum: string): Promise<void> {
  await client.query(
    `
      INSERT INTO public.admatix_schema_migrations (filename, checksum)
      VALUES ($1, $2)
      ON CONFLICT (filename) DO UPDATE
        SET checksum = EXCLUDED.checksum
    `,
    [file, checksum],
  );
}

function runPsql(databaseUrl: string, filePath: string): Promise<void> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn("psql", [databaseUrl, "-v", "ON_ERROR_STOP=1", "-f", filePath], {
      stdio: ["ignore", "inherit", "inherit"],
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolvePromise();
        return;
      }
      reject(new Error(`psql failed for ${basename(filePath)} with exit code ${code ?? "unknown"}`));
    });
  });
}

export async function applyMigrations(): Promise<MigrationResult[]> {
  const databaseUrl = await readSupabaseDbUrl();
  const client = new pg.Client({ connectionString: pgClientUrl(databaseUrl), ssl: { rejectUnauthorized: false } });
  await client.connect();
  try {
    await ensureMigrationTable(client);
    const results: MigrationResult[] = [];
    for (const file of MIGRATION_FILES) {
      const filePath = resolve(MIGRATIONS_DIR, file);
      const sql = await readFile(filePath, "utf8");
      if (await hasMigration(client, file)) {
        console.log(`already-applied: ${file}`);
        results.push({ file, status: "already-applied" });
        continue;
      }
      await runPsql(databaseUrl, filePath);
      await recordMigration(client, file, sha256Text(sql));
      console.log(`applied: ${file}`);
      results.push({ file, status: "applied" });
    }
    return results;
  } finally {
    await client.end();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  applyMigrations().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(message);
    process.exitCode = 1;
  });
}
