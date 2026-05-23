/**
 * Web cockpit type re-exports. Every screen consumes the schema-validated
 * types from `@admatix/schemas` — the cockpit defines NO new domain types.
 */
export type {
  AuditReport,
  BenchmarkResult,
  BenchmarkRun,
  EvidenceRef,
  ExecutionDiff,
  FieldDiff,
  Finding,
  H0Packet,
  PolicyDecision,
} from "@admatix/schemas";
