import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { parse } from "dotenv";
import pg from "pg";

const SECRETS_PATH = "/opt/admatix/.build/secrets.env";
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const MANIFEST_PATH = resolve(REPO_ROOT, "warehouse/dbt/target/manifest.json");
const DICTIONARY_PATH = resolve(REPO_ROOT, "docs/data-dictionary.md");
const GENERATED_DDL_PATH = resolve(REPO_ROOT, "warehouse/ddl/generated.sql");
const ERD_PATH = resolve(REPO_ROOT, "warehouse/ddl/erd.md");
const COVERED_SCHEMAS = ["warehouse", "sim", "bench", "app", "ledger"] as const;

export interface DictionaryGenerationResult {
  readonly tableCount: number;
  readonly columnCount: number;
  readonly generatedFiles: readonly string[];
}

interface ColumnRow {
  readonly table_schema: string;
  readonly table_name: string;
  readonly table_description: string | null;
  readonly column_name: string;
  readonly ordinal_position: number;
  readonly data_type: string;
  readonly udt_name: string;
  readonly is_nullable: "YES" | "NO";
  readonly column_default: string | null;
  readonly column_description: string | null;
}

interface ForeignKeyRow {
  readonly constraint_schema: string;
  readonly table_schema: string;
  readonly table_name: string;
  readonly column_name: string;
  readonly foreign_table_schema: string;
  readonly foreign_table_name: string;
  readonly foreign_column_name: string;
}

interface ColumnDoc {
  readonly description: string;
  readonly tests: readonly string[];
}

interface RelationDoc {
  readonly uniqueId: string;
  readonly resourceType: string;
  readonly description: string;
  readonly columns: ReadonlyMap<string, ColumnDoc>;
  readonly tests: readonly string[];
  readonly sources: readonly string[];
}

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
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

function databaseLabel(databaseUrl: string): string {
  const url = new URL(databaseUrl);
  return `${url.hostname}/${url.pathname.replace(/^\//, "") || "postgres"}`;
}

function relationKey(schema: string, table: string): string {
  return `${schema}.${table}`;
}

async function readManifestDocs(): Promise<ReadonlyMap<string, RelationDoc>> {
  let manifest: Record<string, unknown>;
  try {
    manifest = asRecord(JSON.parse(await readFile(MANIFEST_PATH, "utf8")));
  } catch {
    return new Map();
  }

  const nodes = asRecord(manifest.nodes);
  const sources = asRecord(manifest.sources);
  const docsByUniqueId = new Map<string, { schema: string; name: string; doc: RelationDoc }>();
  const testsByRelation = new Map<string, string[]>();
  const testsByColumn = new Map<string, string[]>();

  for (const [uniqueId, rawNode] of Object.entries({ ...nodes, ...sources })) {
    const node = asRecord(rawNode);
    const resourceType = asString(node.resource_type);
    if (resourceType === "test") {
      const dependsOn = asRecord(node.depends_on);
      const dependencies = asStringArray(dependsOn.nodes);
      const testName = asString(node.name) || uniqueId;
      const metadata = asRecord(node.test_metadata);
      const kwargs = asRecord(metadata.kwargs);
      const columnName = asString(kwargs.column_name);
      for (const dependency of dependencies) {
        if (columnName) {
          const key = `${dependency}.${columnName}`;
          testsByColumn.set(key, [...(testsByColumn.get(key) ?? []), testName]);
        } else {
          testsByRelation.set(dependency, [...(testsByRelation.get(dependency) ?? []), testName]);
        }
      }
      continue;
    }

    if (!["model", "seed", "source", "snapshot"].includes(resourceType)) {
      continue;
    }

    const schema = asString(node.schema);
    const alias = asString(node.alias) || asString(node.identifier) || asString(node.name);
    if (!schema || !alias) {
      continue;
    }

    const columns = new Map<string, ColumnDoc>();
    for (const [columnName, rawColumn] of Object.entries(asRecord(node.columns))) {
      const column = asRecord(rawColumn);
      columns.set(columnName, {
        description: asString(column.description),
        tests: testsByColumn.get(`${uniqueId}.${columnName}`) ?? [],
      });
    }

    const dependsOn = asRecord(node.depends_on);
    const dependencyIds = asStringArray(dependsOn.nodes);
    const sourceLineage = dependencyIds
      .filter((dependency) => dependency.startsWith("source."))
      .sort();

    docsByUniqueId.set(uniqueId, {
      schema,
      name: alias,
      doc: {
        uniqueId,
        resourceType,
        description: asString(node.description),
        columns,
        tests: testsByRelation.get(uniqueId) ?? [],
        sources: sourceLineage,
      },
    });
  }

  const docsByRelation = new Map<string, RelationDoc>();
  for (const { schema, name, doc } of docsByUniqueId.values()) {
    const key = relationKey(schema, name);
    const existing = docsByRelation.get(key);
    if (!existing || (!existing.description && doc.description) || existing.resourceType === "source") {
      docsByRelation.set(key, doc);
    }
  }
  return docsByRelation;
}

async function fetchColumns(client: pg.Client): Promise<ColumnRow[]> {
  const result = await client.query<ColumnRow>(
    `
      SELECT
        c.table_schema,
        c.table_name,
        obj_description(pc.oid, 'pg_class') AS table_description,
        c.column_name,
        c.ordinal_position,
        c.data_type,
        c.udt_name,
        c.is_nullable,
        c.column_default,
        col_description(pc.oid, c.ordinal_position) AS column_description
      FROM information_schema.columns c
      JOIN pg_namespace pn ON pn.nspname = c.table_schema
      JOIN pg_class pc ON pc.relnamespace = pn.oid AND pc.relname = c.table_name
      WHERE c.table_schema = ANY($1)
        AND pc.relkind IN ('r', 'p', 'v', 'm')
      ORDER BY c.table_schema, c.table_name, c.ordinal_position
    `,
    [COVERED_SCHEMAS],
  );
  return result.rows;
}

async function fetchForeignKeys(client: pg.Client): Promise<ForeignKeyRow[]> {
  const result = await client.query<ForeignKeyRow>(
    `
      SELECT
        tc.constraint_schema,
        tc.table_schema,
        tc.table_name,
        kcu.column_name,
        ccu.table_schema AS foreign_table_schema,
        ccu.table_name AS foreign_table_name,
        ccu.column_name AS foreign_column_name
      FROM information_schema.table_constraints tc
      JOIN information_schema.key_column_usage kcu
        ON tc.constraint_name = kcu.constraint_name
       AND tc.constraint_schema = kcu.constraint_schema
      JOIN information_schema.constraint_column_usage ccu
        ON ccu.constraint_name = tc.constraint_name
       AND ccu.constraint_schema = tc.constraint_schema
      WHERE tc.constraint_type = 'FOREIGN KEY'
        AND tc.table_schema = ANY($1)
      ORDER BY tc.table_schema, tc.table_name, kcu.ordinal_position
    `,
    [COVERED_SCHEMAS],
  );
  return result.rows;
}

function runBuffered(command: string, args: readonly string[]): Promise<string> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, [...args], { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolvePromise(stdout);
        return;
      }
      reject(new Error(`${command} failed with exit code ${code ?? "unknown"}: ${stderr.trim()}`));
    });
  });
}

function sqlString(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

function renderFallbackDdl(columns: readonly ColumnRow[]): string {
  const byTable = new Map<string, ColumnRow[]>();
  for (const column of columns.filter((item) => ["warehouse", "sim", "bench"].includes(item.table_schema))) {
    const key = relationKey(column.table_schema, column.table_name);
    byTable.set(key, [...(byTable.get(key) ?? []), column]);
  }

  const lines = [
    "-- Generated by scripts/db/generate-dictionary.ts",
    "-- Fallback schema renderer used when local pg_dump cannot connect to the server version.",
    "",
  ];

  for (const [key, tableColumns] of [...byTable.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const first = tableColumns[0];
    if (!first) {
      continue;
    }
    lines.push(`CREATE TABLE ${key} (`);
    const columnDefinitions = tableColumns.map((column) => {
      const defaultClause = column.column_default ? ` DEFAULT ${column.column_default}` : "";
      const nullableClause = column.is_nullable === "NO" ? " NOT NULL" : "";
      return `  ${column.column_name} ${typeLabel(column)}${defaultClause}${nullableClause}`;
    });
    lines.push(columnDefinitions.join(",\n"));
    lines.push(");", "");
    const tableDescription = first.table_description?.trim();
    if (tableDescription) {
      lines.push(`COMMENT ON TABLE ${key} IS ${sqlString(tableDescription)};`);
    }
    for (const column of tableColumns) {
      const columnDescription = column.column_description?.trim();
      if (columnDescription) {
        lines.push(`COMMENT ON COLUMN ${key}.${column.column_name} IS ${sqlString(columnDescription)};`);
      }
    }
    lines.push("");
  }

  return lines.join("\n");
}

async function refreshGeneratedDdl(databaseUrl: string, columns: readonly ColumnRow[]): Promise<void> {
  let ddl: string;
  try {
    ddl = await runBuffered("pg_dump", [
      databaseUrl,
      "--schema-only",
      "--no-owner",
      "--no-privileges",
      "--schema=warehouse",
      "--schema=sim",
      "--schema=bench",
    ]);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`pg_dump unavailable, using information_schema fallback: ${message}`);
    ddl = renderFallbackDdl(columns);
  }
  await mkdir(dirname(GENERATED_DDL_PATH), { recursive: true });
  await writeFile(GENERATED_DDL_PATH, ddl);
}

function renderErd(columns: readonly ColumnRow[], foreignKeys: readonly ForeignKeyRow[]): string {
  const byTable = new Map<string, ColumnRow[]>();
  for (const column of columns.filter((item) => ["warehouse", "sim", "bench"].includes(item.table_schema))) {
    const key = relationKey(column.table_schema, column.table_name);
    byTable.set(key, [...(byTable.get(key) ?? []), column]);
  }

  const lines = [
    "# Warehouse ERD",
    "",
    "Generated by `pnpm tsx scripts/db/generate-dictionary.ts`.",
    "",
    "```mermaid",
    "erDiagram",
  ];

  for (const [key, tableColumns] of [...byTable.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const mermaidName = key.replace(".", "__");
    lines.push(`  ${mermaidName} {`);
    for (const column of tableColumns) {
      const type = column.udt_name.replace(/^_/, "array_").replace(/[^A-Za-z0-9_]/g, "_");
      lines.push(`    ${type} ${column.column_name}`);
    }
    lines.push("  }");
  }

  for (const fk of foreignKeys.filter((item) => ["warehouse", "sim", "bench"].includes(item.table_schema))) {
    const from = relationKey(fk.table_schema, fk.table_name).replace(".", "__");
    const to = relationKey(fk.foreign_table_schema, fk.foreign_table_name).replace(".", "__");
    lines.push(`  ${to} ||--o{ ${from} : "${fk.column_name}"`);
  }

  lines.push("```", "");
  return `${lines.join("\n")}`;
}

async function refreshErd(columns: readonly ColumnRow[], foreignKeys: readonly ForeignKeyRow[]): Promise<void> {
  await mkdir(dirname(ERD_PATH), { recursive: true });
  await writeFile(ERD_PATH, renderErd(columns, foreignKeys));
}

async function existingGeneratedAt(bodyWithoutFrontmatter: string): Promise<string> {
  const fallback = new Date().toISOString();
  try {
    const existing = await readFile(DICTIONARY_PATH, "utf8");
    const match = existing.match(/^---\ngenerated_at: "([^"]+)"/);
    if (!match?.[1]) {
      return fallback;
    }
    const existingBody = existing.replace(/^---\n[\s\S]*?\n---\n\n/, "");
    return existingBody === bodyWithoutFrontmatter ? match[1] : fallback;
  } catch {
    return fallback;
  }
}

function markdownEscape(value: string): string {
  return value.replaceAll("|", "\\|").replaceAll("\n", " ");
}

function typeLabel(column: ColumnRow): string {
  return column.data_type === "USER-DEFINED" ? column.udt_name : column.data_type;
}

function genericTableDescription(schema: string, table: string): string {
  if (schema === "app") {
    return `Operational application source table ${schema}.${table}.`;
  }
  if (schema === "ledger") {
    return `Ledger source table ${schema}.${table}.`;
  }
  return "";
}

function genericColumnDescription(schema: string, column: string): string {
  if (schema !== "app" && schema !== "ledger") {
    return "";
  }
  if (column === "id") {
    return "Generic Store collection identifier retained for compatibility with the filesystem Store contract.";
  }
  if (column === "body") {
    return "Generic Store collection body as jsonb, containing the schema-validated artifact payload.";
  }
  return "";
}

function renderDictionaryBody(columns: readonly ColumnRow[], docs: ReadonlyMap<string, RelationDoc>): { body: string; missing: string[] } {
  const missing: string[] = [];
  const byTable = new Map<string, ColumnRow[]>();
  for (const column of columns) {
    const key = relationKey(column.table_schema, column.table_name);
    byTable.set(key, [...(byTable.get(key) ?? []), column]);
  }

  const lines = [
    "# AdMatix Data Dictionary",
    "",
    "This file is generated from PostgreSQL comments, dbt model/source descriptions, and dbt tests. Regenerate it with `pnpm tsx scripts/db/generate-dictionary.ts`.",
    "",
  ];

  for (const [key, tableColumns] of [...byTable.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const first = tableColumns[0];
    if (!first) {
      continue;
    }
    const doc = docs.get(key);
    const tableDescription =
      first.table_description?.trim() || doc?.description.trim() || genericTableDescription(first.table_schema, first.table_name);
    if (!tableDescription && ["warehouse", "sim", "bench"].includes(first.table_schema)) {
      missing.push(`${key}: table description is empty`);
    }
    lines.push(`## ${key}`, "");
    lines.push(tableDescription || "**MISSING DESCRIPTION**", "");
    lines.push(`- Source lineage: ${doc?.sources.length ? doc.sources.join(", ") : doc?.uniqueId ?? "database relation"}`);
    lines.push(`- dbt tests: ${doc?.tests.length ? doc.tests.join(", ") : "none recorded"}`);
    lines.push("");
    lines.push("| Column | Type | Nullable | Default | Description | Lineage | Tests |");
    lines.push("| --- | --- | --- | --- | --- | --- | --- |");

    for (const column of tableColumns) {
      const columnDoc = doc?.columns.get(column.column_name);
      const description =
        column.column_description?.trim() || columnDoc?.description.trim() || genericColumnDescription(column.table_schema, column.column_name);
      if (!description && ["warehouse", "sim", "bench"].includes(column.table_schema)) {
        missing.push(`${key}.${column.column_name}: column description is empty`);
      }
      lines.push(
        [
          column.column_name,
          typeLabel(column),
          column.is_nullable === "YES" ? "yes" : "no",
          column.column_default ?? "",
          description || "**MISSING DESCRIPTION**",
          doc?.uniqueId ?? "database relation",
          columnDoc?.tests.length ? columnDoc.tests.join(", ") : "none recorded",
        ]
          .map(markdownEscape)
          .join(" | ")
          .replace(/^/, "| ")
          .replace(/$/, " |"),
      );
    }
    lines.push("");
  }

  return { body: lines.join("\n"), missing };
}

async function writeDictionary(columns: readonly ColumnRow[], docs: ReadonlyMap<string, RelationDoc>, sourceLabel: string): Promise<void> {
  const { body, missing } = renderDictionaryBody(columns, docs);
  if (missing.length > 0) {
    throw new Error(`Data dictionary has missing descriptions:\n${missing.map((item) => `- ${item}`).join("\n")}`);
  }
  const generatedAt = await existingGeneratedAt(body);
  const content = [
    "---",
    `generated_at: "${generatedAt}"`,
    `source_database: "${sourceLabel}"`,
    'generator: "scripts/db/generate-dictionary.ts"',
    'regenerate_with: "pnpm tsx scripts/db/generate-dictionary.ts"',
    "---",
    "",
    body,
  ].join("\n");
  await writeFile(DICTIONARY_PATH, content);
}

export async function generateDictionary(): Promise<DictionaryGenerationResult> {
  const databaseUrl = await readSupabaseDbUrl();
  const client = new pg.Client({ connectionString: pgClientUrl(databaseUrl), ssl: { rejectUnauthorized: false } });
  await client.connect();
  try {
    const [columns, foreignKeys, docs] = await Promise.all([fetchColumns(client), fetchForeignKeys(client), readManifestDocs()]);
    await refreshGeneratedDdl(databaseUrl, columns);
    await refreshErd(columns, foreignKeys);
    await writeDictionary(columns, docs, databaseLabel(databaseUrl));
    const tableCount = new Set(columns.map((column) => relationKey(column.table_schema, column.table_name))).size;
    console.log(`data-dictionary-ok: documented ${tableCount} tables and ${columns.length} columns`);
    return {
      tableCount,
      columnCount: columns.length,
      generatedFiles: [DICTIONARY_PATH, GENERATED_DDL_PATH, ERD_PATH],
    };
  } finally {
    await client.end();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  generateDictionary().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(message);
    process.exitCode = 1;
  });
}
