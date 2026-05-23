/**
 * HTTP client for the independent verifier (services/verifier, WP-R).
 *
 * The verifier is a separate FastAPI process; this client is the TS-side
 * boundary that turns `MeasurementScientistAgent`'s annotation step into a
 * call against `/verify`. The seven canonical fields it returns
 * (`estimate, ci_low, ci_high, method, causal_status, verdict, confounders`)
 * are the contract the Phase 3 gate is judged on.
 *
 * Rules enforced here (per `AGENTS.md` and `WP-S-wiring.md`):
 * - Every cross-package type is schema-validated at the boundary: the wire
 *   response is parsed with a local Zod schema before being handed back to
 *   the caller.
 * - The client never mutates state. Persistence into
 *   `app.outcome_measurements` and the `ledger.action_events` chain happens
 *   inside the orchestrator workflow path, never inside this client.
 * - Network/timeout/HTTP failures surface as a typed `VerifierError` whose
 *   `.reason` is one of `network | timeout | http_5xx | http_4xx | bad_response`.
 *   The agent reads `.reason` and degrades gracefully.
 *
 * `packages/schemas/**` stays frozen — the Zod schema below is local to the
 * client and is a read-only mirror of the verifier's Pydantic model.
 */
import { z } from "@admatix/schemas";

const DEFAULT_TIMEOUT_MS = 30_000;

/** TypeScript mirror of the Python Pydantic `VerifyRequest` from WP-R. */
export interface VerifyRequestPayload {
  packet: {
    packet_id: string;
    tenant_id: string;
    account_ref: string;
    goal: string;
    hypothesis: string;
    causal_status:
      | "heuristic"
      | "directional_until_lift_test"
      | "experimental"
      | "causal";
    guardrails: Record<string, unknown>;
    evidence_refs: string[];
  };
  data_uri: string;
  metadata_uri?: string;
  action_log_uri?: string;
  hint?: { design?: string; [k: string]: unknown };
}

/** TypeScript mirror of the Python Pydantic `VerifyResponse` from WP-R. */
export interface VerifyResponsePayload {
  estimate: number | null;
  ci_low: number | null;
  ci_high: number | null;
  method:
    | "guardrail_only"
    | "bsts_synthetic_control"
    | "cate_meta_learner"
    | "geo_synthetic_control"
    | "ope_ips_snips_dr";
  causal_status:
    | "heuristic"
    | "directional_until_lift_test"
    | "experimental"
    | "causal"
    | "inconclusive";
  verdict: "lift_detected" | "no_effect" | "inconclusive";
  confounders: string[];
  ci_level: number;
  guardrail_proof: {
    all_pass: boolean;
    rules: {
      rule_id: string;
      predicate: string;
      inputs: Record<string, unknown>;
      pass: boolean;
    }[];
  };
  diagnostics: Record<string, unknown>;
  rejected_methods: { method: string; reason: string }[];
  packet_id: string;
  tx_id: string;
}

export type VerifierErrorReason =
  | "network"
  | "timeout"
  | "http_5xx"
  | "http_4xx"
  | "bad_response";

/** Typed error surfaced by the client on every failure path. */
export class VerifierError extends Error {
  readonly reason: VerifierErrorReason;
  readonly status: number | null;
  readonly url: string;
  readonly cause?: unknown;
  constructor(
    reason: VerifierErrorReason,
    message: string,
    args: { url: string; status?: number | null; cause?: unknown } = { url: "" },
  ) {
    super(message);
    this.name = "VerifierError";
    this.reason = reason;
    this.status = args.status ?? null;
    this.url = args.url;
    if (args.cause !== undefined) this.cause = args.cause;
  }
}

export interface VerifierClientOptions {
  /** Base URL of the verifier service, e.g. http://127.0.0.1:8088 */
  baseUrl: string;
  /** Optional fetch implementation; defaults to globalThis.fetch. */
  fetch?: typeof globalThis.fetch;
  /** Max ms before /verify is considered failed. Default 30_000. */
  timeoutMs?: number;
}

export interface VerifierClient {
  healthz(): Promise<{
    status: "ok";
    version: string;
    libs: Record<string, string>;
  }>;
  verify(req: VerifyRequestPayload): Promise<VerifyResponsePayload>;
}

/* -------------------------------------------------------------------------- */
/* Zod schemas (local boundary validators — packages/schemas stays frozen).   */
/* -------------------------------------------------------------------------- */

const HealthzResponseSchema = z
  .object({
    status: z.literal("ok"),
    version: z.string(),
    libs: z.record(z.string()),
  })
  .strict();

const GuardrailRuleSchema = z
  .object({
    rule_id: z.string(),
    predicate: z.string(),
    inputs: z.record(z.unknown()),
    pass: z.boolean(),
  })
  .strict();

const GuardrailProofSchema = z
  .object({
    all_pass: z.boolean(),
    rules: z.array(GuardrailRuleSchema),
  })
  .strict();

const RejectedMethodSchema = z
  .object({
    method: z.string(),
    reason: z.string(),
  })
  .strict();

export const VerifyResponseSchema = z
  .object({
    estimate: z.number().nullable(),
    ci_low: z.number().nullable(),
    ci_high: z.number().nullable(),
    method: z.enum([
      "guardrail_only",
      "bsts_synthetic_control",
      "cate_meta_learner",
      "geo_synthetic_control",
      "ope_ips_snips_dr",
    ]),
    causal_status: z.enum([
      "heuristic",
      "directional_until_lift_test",
      "experimental",
      "causal",
      "inconclusive",
    ]),
    verdict: z.enum(["lift_detected", "no_effect", "inconclusive"]),
    confounders: z.array(z.string()),
    ci_level: z.number(),
    guardrail_proof: GuardrailProofSchema,
    diagnostics: z.record(z.unknown()),
    rejected_methods: z.array(RejectedMethodSchema),
    packet_id: z.string(),
    tx_id: z.string(),
  })
  .strict();

export function createVerifierClient(
  opts: VerifierClientOptions,
): VerifierClient {
  if (!opts || typeof opts.baseUrl !== "string" || opts.baseUrl.length === 0) {
    throw new Error(
      "createVerifierClient: opts.baseUrl is required (e.g. http://127.0.0.1:8088)",
    );
  }
  const baseUrl = opts.baseUrl.replace(/\/+$/, "");
  const fetchImpl = opts.fetch ?? globalThis.fetch;
  if (typeof fetchImpl !== "function") {
    throw new Error(
      "createVerifierClient: no fetch available — supply opts.fetch on Node < 18 or in tests",
    );
  }
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  const healthz: VerifierClient["healthz"] = async () => {
    const url = `${baseUrl}/healthz`;
    const raw = await postOrGetJson(fetchImpl, "GET", url, undefined, timeoutMs);
    const parsed = HealthzResponseSchema.safeParse(raw);
    if (!parsed.success) {
      throw new VerifierError(
        "bad_response",
        `verifier /healthz returned a payload that failed schema validation: ${parsed.error.message}. ` +
          `Check that the verifier is running a compatible version (services/verifier WP-R).`,
        { url },
      );
    }
    return parsed.data;
  };

  const verify: VerifierClient["verify"] = async (req) => {
    if (!req || typeof req !== "object") {
      throw new Error("VerifierClient.verify: request must be an object");
    }
    const url = `${baseUrl}/verify`;
    const raw = await postOrGetJson(fetchImpl, "POST", url, req, timeoutMs);
    const parsed = VerifyResponseSchema.safeParse(raw);
    if (!parsed.success) {
      throw new VerifierError(
        "bad_response",
        `verifier /verify returned a payload that failed schema validation: ${parsed.error.message}. ` +
          `Confirm the verifier service matches services/verifier (WP-R) — the seven canonical fields ` +
          `(estimate, ci_low, ci_high, method, causal_status, verdict, confounders) must all be present.`,
        { url },
      );
    }
    return parsed.data;
  };

  return { healthz, verify };
}

async function postOrGetJson(
  fetchImpl: typeof globalThis.fetch,
  method: "GET" | "POST",
  url: string,
  body: unknown,
  timeoutMs: number,
): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let response: Response;
  try {
    response = await fetchImpl(url, {
      method,
      headers:
        method === "POST"
          ? { "content-type": "application/json", accept: "application/json" }
          : { accept: "application/json" },
      body: method === "POST" ? JSON.stringify(body ?? {}) : undefined,
      signal: controller.signal,
    });
  } catch (err) {
    const reason: VerifierErrorReason = isAbortError(err) ? "timeout" : "network";
    const detail = reason === "timeout"
      ? `verifier ${method} ${url} timed out after ${timeoutMs}ms`
      : `verifier ${method} ${url} failed to reach the service: ${describeError(err)}`;
    throw new VerifierError(reason, `${detail}. Boot the verifier (scripts/start-verifier.sh) or set a reachable baseUrl in createVerifierClient.`, {
      url,
      cause: err,
    });
  } finally {
    clearTimeout(timer);
  }

  if (response.status >= 500) {
    const text = await safeReadText(response);
    throw new VerifierError(
      "http_5xx",
      `verifier ${method} ${url} returned HTTP ${response.status}: ${truncate(text, 400)}`,
      { url, status: response.status },
    );
  }
  if (response.status >= 400) {
    const text = await safeReadText(response);
    throw new VerifierError(
      "http_4xx",
      `verifier ${method} ${url} returned HTTP ${response.status}: ${truncate(text, 400)}`,
      { url, status: response.status },
    );
  }

  let json: unknown;
  try {
    json = await response.json();
  } catch (err) {
    throw new VerifierError(
      "bad_response",
      `verifier ${method} ${url} returned a body that was not valid JSON: ${describeError(err)}`,
      { url, status: response.status, cause: err },
    );
  }
  return json;
}

function isAbortError(err: unknown): boolean {
  if (err === null || typeof err !== "object") return false;
  const e = err as { name?: unknown; code?: unknown };
  return e.name === "AbortError" || e.code === "ABORT_ERR";
}

function describeError(err: unknown): string {
  if (err instanceof Error) return `${err.name}: ${err.message}`;
  return String(err);
}

async function safeReadText(response: Response): Promise<string> {
  try {
    return await response.text();
  } catch {
    return "<unreadable body>";
  }
}

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max)}…`;
}
