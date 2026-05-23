# Database Migrations Runbook

## Apply

The migration runner reads `/opt/admatix/.build/secrets.env` and uses only the
`SUPABASE_DB_URL` key. Do not copy the URL into a tracked file or shell log.

```bash
pnpm tsx scripts/db/apply-migrations.ts
```

Expected first run output is one `applied: <file>` line per SQL file. Expected
second run output is one `already-applied: <file>` line per SQL file.

## Verify

Check the required schemas:

```bash
source /opt/admatix/.build/secrets.env
psql "$SUPABASE_DB_URL" -c "\\dn"
```

Verify the ledger hash chain:

```bash
pnpm tsx scripts/db/verify-ledger-chain.ts
pnpm tsx scripts/db/verify-ledger-chain.ts --smoke-insert
pnpm tsx scripts/db/verify-ledger-chain.ts
```

Check append-only permissions by using the `admatix_app` role:

```bash
source /opt/admatix/.build/secrets.env
psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -c "SET ROLE admatix_app; UPDATE ledger.action_events SET payload = '{}'::jsonb WHERE seq = (SELECT min(seq) FROM ledger.action_events);"
```

That update must fail with a permission error or the ledger append-only trigger.

## Partial Apply Recovery

The runner stops on the first failing SQL statement via `ON_ERROR_STOP=1`.
Because every migration is transactional, a failed file rolls back as a unit.
Fix the migration or database privilege issue, then run the same command again.
Files already recorded in `public.admatix_schema_migrations` are skipped.

If a manual operator applied SQL outside the runner, inspect the database shape
before inserting a row into `public.admatix_schema_migrations`. Do not mark a
file applied unless the full file has been applied successfully.

## Never Truncate Ledger

`ledger.action_events` and `ledger.merkle_anchors` are the system of record.
Never truncate, update, or delete ledger rows. Record corrective events instead.
For non-production simulator and benchmark resets, truncate only `sim.*` and
`bench.*` tables, then re-seed from deterministic fixtures.
