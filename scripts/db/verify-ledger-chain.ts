import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

import { parse } from "dotenv";
import pg from "pg";

const SECRETS_PATH = "/opt/admatix/.build/secrets.env";
const ZERO_HASH = "0".repeat(64);

interface LedgerRow {
  readonly seq: string;
  readonly event_id: string;
  readonly tx_id: string;
  readonly event_type: string;
  readonly step: string;
  readonly payload_text: string;
  readonly payload_hash: string;
  readonly prev_hash: string;
  readonly entry_hash: string;
  readonly created_at_chain: string;
}

export interface LedgerVerificationResult {
  readonly ok: boolean;
  readonly checkedRows: number;
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

async function insertSmokeEvent(client: pg.Client): Promise<void> {
  const suffix = sha256Text(new Date().toISOString()).slice(0, 20).toUpperCase();
  await client.query(
    `
      INSERT INTO ledger.action_events (
        event_id,
        tx_id,
        workflow_id,
        trace_id,
        tenant_id,
        event_type,
        step,
        actor_agent_id,
        subject_id,
        payload,
        payload_hash,
        prev_hash,
        entry_hash
      )
      VALUES (
        $1,
        'tx_wp_l_smoke',
        'wf_wp_l_smoke',
        'trace_wp_l_smoke',
        'tenant_wp_l_smoke',
        'flag',
        'plan',
        'migration-verifier',
        'wp-l-smoke',
        $2::jsonb,
        $3,
        $3,
        $3
      )
    `,
    [`01WPLEDGERSMOKE${suffix}`, JSON.stringify({ smoke: true, source: "verify-ledger-chain" }), ZERO_HASH],
  );
}

function expectedEntryHash(row: LedgerRow, expectedPrevHash: string): string {
  const payloadHash = sha256Text(row.payload_text);
  if (payloadHash !== row.payload_hash.trim()) {
    throw new Error(`ledger.action_events seq=${row.seq} payload_hash mismatch`);
  }
  const chainMaterial = [
    expectedPrevHash,
    row.event_id,
    row.tx_id,
    row.event_type,
    row.step,
    row.payload_hash.trim(),
    row.created_at_chain,
  ].join("|");
  return sha256Text(chainMaterial);
}

export async function verifyLedgerChain(options: { readonly smokeInsert?: boolean } = {}): Promise<LedgerVerificationResult> {
  const databaseUrl = await readSupabaseDbUrl();
  const client = new pg.Client({ connectionString: pgClientUrl(databaseUrl), ssl: { rejectUnauthorized: false } });
  await client.connect();
  try {
    if (options.smokeInsert === true) {
      await insertSmokeEvent(client);
    }
    const result = await client.query<LedgerRow>(`
      SELECT
        seq::text,
        event_id,
        tx_id,
        event_type::text,
        step::text,
        (payload || '{}'::jsonb)::text AS payload_text,
        payload_hash::text,
        prev_hash::text,
        entry_hash::text,
        to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS created_at_chain
      FROM ledger.action_events
      ORDER BY ledger.action_events.seq ASC
    `);

    let previousHash = ZERO_HASH;
    for (const row of result.rows) {
      if (row.prev_hash.trim() !== previousHash) {
        throw new Error(`ledger.action_events seq=${row.seq} prev_hash does not match previous entry_hash`);
      }
      const expected = expectedEntryHash(row, previousHash);
      if (row.entry_hash.trim() !== expected) {
        throw new Error(`ledger.action_events seq=${row.seq} entry_hash mismatch`);
      }
      previousHash = row.entry_hash.trim();
    }

    console.log(`ledger-chain-ok: checked ${result.rowCount ?? result.rows.length} rows`);
    return { ok: true, checkedRows: result.rowCount ?? result.rows.length };
  } finally {
    await client.end();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  verifyLedgerChain({ smokeInsert: process.argv.includes("--smoke-insert") }).catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(message);
    process.exitCode = 1;
  });
}
