/**
 * Unit tests for `verifier-client.ts` — WP-S acceptance tests #1 and #2.
 *
 *  AT1 (happy path): a well-formed `VerifyResponse` round-trips with all
 *  seven canonical fields typed correctly; a missing required field on the
 *  wire throws a Zod-backed error with an actionable message.
 *
 *  AT2 (outage):  network / timeout / 5xx / bad-json failures surface as
 *  a typed `VerifierError` whose `.reason` is one of
 *  `network | timeout | http_5xx | http_4xx | bad_response`.
 *
 * The client never touches the network in this file — every test wires a
 * small in-process `fetch` stub. No heavy HTTP-mock dependency is needed.
 */
import { describe, expect, it, vi } from "vitest";
import {
  createVerifierClient,
  VerifierError,
  type VerifyResponsePayload,
} from "./verifier-client.js";

const FIXTURE_RESPONSE: VerifyResponsePayload = {
  estimate: 0.0412,
  ci_low: 0.031,
  ci_high: 0.051,
  method: "cate_meta_learner",
  causal_status: "directional_until_lift_test",
  verdict: "lift_detected",
  confounders: ["recency", "frequency"],
  ci_level: 0.95,
  guardrail_proof: {
    all_pass: true,
    rules: [
      {
        rule_id: "budget_cap",
        predicate: "spend ≤ budget_cap",
        inputs: { spend: 48_210, budget_cap: 50_000 },
        pass: true,
      },
    ],
  },
  diagnostics: { qini: 0.18, n_effective: 1900 },
  rejected_methods: [{ method: "ope_ips_snips_dr", reason: "no_propensities" }],
  packet_id: "h0_test",
  tx_id: "h0_test",
};

const FIXTURE_REQUEST = {
  packet: {
    packet_id: "h0_test",
    tenant_id: "tenant_demo",
    account_ref: "acc_demo",
    goal: "reduce_cac",
    hypothesis: "Reducing X will improve Y",
    causal_status: "directional_until_lift_test" as const,
    guardrails: { budget_cap: 50_000 },
    evidence_refs: ["google_ads_fixture:metric:campaign_daily:c1:2026-05-21"],
  },
  data_uri: "file:///tmp/events.csv",
};

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
    ...init,
  });
}

describe("verifier-client — happy path (AT1)", () => {
  it("parses a well-formed VerifyResponse with all seven canonical fields", async () => {
    const captured: { url: string; init: RequestInit | undefined }[] = [];
    const stub: typeof globalThis.fetch = async (url, init) => {
      captured.push({ url: String(url), init: init as RequestInit | undefined });
      return jsonResponse(FIXTURE_RESPONSE);
    };
    const client = createVerifierClient({
      baseUrl: "http://127.0.0.1:8088",
      fetch: stub,
    });

    const out = await client.verify(FIXTURE_REQUEST);

    // Seven canonical fields from PROOF-WAVE-MASTER-PLAN §6.2:
    expect(out.estimate).toBe(0.0412);
    expect(out.ci_low).toBe(0.031);
    expect(out.ci_high).toBe(0.051);
    expect(out.method).toBe("cate_meta_learner");
    expect(out.causal_status).toBe("directional_until_lift_test");
    expect(out.verdict).toBe("lift_detected");
    expect(out.confounders).toEqual(["recency", "frequency"]);
    expect(out.ci_level).toBe(0.95);
    expect(out.guardrail_proof.all_pass).toBe(true);

    // The client must have POSTed to /verify with a JSON body.
    expect(captured).toHaveLength(1);
    const call = captured[0]!;
    expect(call.url).toBe("http://127.0.0.1:8088/verify");
    expect(call.init?.method).toBe("POST");
    const headers = (call.init?.headers ?? {}) as Record<string, string>;
    expect(headers["content-type"]).toBe("application/json");
    expect(JSON.parse(String(call.init?.body))).toEqual(FIXTURE_REQUEST);
  });

  it("returns the parsed healthz payload", async () => {
    const stub = vi.fn(async () =>
      jsonResponse({
        status: "ok",
        version: "0.1.0",
        libs: { econml: "0.16.0", causalml: "0.16.0" },
      }),
    );
    const client = createVerifierClient({
      baseUrl: "http://127.0.0.1:8088",
      fetch: stub,
    });
    const h = await client.healthz();
    expect(h.status).toBe("ok");
    expect(h.version).toBe("0.1.0");
    expect(h.libs.econml).toBe("0.16.0");
  });

  it("rejects a wire payload missing a required canonical field with an actionable Zod-backed error", async () => {
    // Drop `verdict` — one of the seven canonical fields.
    const { verdict: _verdict, ...broken } = FIXTURE_RESPONSE;
    void _verdict;
    const stub = vi.fn(async () => jsonResponse(broken));
    const client = createVerifierClient({
      baseUrl: "http://127.0.0.1:8088",
      fetch: stub,
    });

    await expect(client.verify(FIXTURE_REQUEST)).rejects.toMatchObject({
      name: "VerifierError",
      reason: "bad_response",
    });
    await expect(client.verify(FIXTURE_REQUEST)).rejects.toThrow(
      /seven canonical fields/,
    );
  });
});

describe("verifier-client — outage (AT2)", () => {
  it("surfaces a network error as VerifierError.reason='network'", async () => {
    const stub = vi.fn(async () => {
      throw new TypeError("ECONNREFUSED 127.0.0.1:8088");
    });
    const client = createVerifierClient({
      baseUrl: "http://127.0.0.1:8088",
      fetch: stub,
    });
    const err = await capture(() => client.verify(FIXTURE_REQUEST));
    expect(err).toBeInstanceOf(VerifierError);
    expect((err as VerifierError).reason).toBe("network");
    expect((err as VerifierError).message).toMatch(/scripts\/start-verifier/);
  });

  it("surfaces an AbortError as VerifierError.reason='timeout'", async () => {
    const stub = vi.fn(async () => {
      const e = new Error("aborted");
      e.name = "AbortError";
      throw e;
    });
    const client = createVerifierClient({
      baseUrl: "http://127.0.0.1:8088",
      fetch: stub,
      timeoutMs: 5,
    });
    const err = await capture(() => client.verify(FIXTURE_REQUEST));
    expect(err).toBeInstanceOf(VerifierError);
    expect((err as VerifierError).reason).toBe("timeout");
  });

  it("surfaces an HTTP 500 as VerifierError.reason='http_5xx'", async () => {
    const stub = vi.fn(
      async () =>
        new Response("internal", {
          status: 500,
          headers: { "content-type": "text/plain" },
        }),
    );
    const client = createVerifierClient({
      baseUrl: "http://127.0.0.1:8088",
      fetch: stub,
    });
    const err = await capture(() => client.verify(FIXTURE_REQUEST));
    expect(err).toBeInstanceOf(VerifierError);
    expect((err as VerifierError).reason).toBe("http_5xx");
    expect((err as VerifierError).status).toBe(500);
  });

  it("surfaces an HTTP 422 as VerifierError.reason='http_4xx'", async () => {
    const stub = vi.fn(
      async () =>
        new Response('{"detail":"bad shape"}', {
          status: 422,
          headers: { "content-type": "application/json" },
        }),
    );
    const client = createVerifierClient({
      baseUrl: "http://127.0.0.1:8088",
      fetch: stub,
    });
    const err = await capture(() => client.verify(FIXTURE_REQUEST));
    expect(err).toBeInstanceOf(VerifierError);
    expect((err as VerifierError).reason).toBe("http_4xx");
    expect((err as VerifierError).status).toBe(422);
  });

  it("surfaces non-JSON body as VerifierError.reason='bad_response'", async () => {
    const stub = vi.fn(
      async () =>
        new Response("not-json", {
          status: 200,
          headers: { "content-type": "text/plain" },
        }),
    );
    const client = createVerifierClient({
      baseUrl: "http://127.0.0.1:8088",
      fetch: stub,
    });
    const err = await capture(() => client.verify(FIXTURE_REQUEST));
    expect(err).toBeInstanceOf(VerifierError);
    expect((err as VerifierError).reason).toBe("bad_response");
  });

  it("requires a non-empty baseUrl", () => {
    expect(() =>
      createVerifierClient({ baseUrl: "", fetch: vi.fn() as never }),
    ).toThrow(/baseUrl/);
  });
});

async function capture(fn: () => Promise<unknown>): Promise<unknown> {
  try {
    await fn();
    throw new Error("expected the call to throw");
  } catch (err) {
    return err;
  }
}
