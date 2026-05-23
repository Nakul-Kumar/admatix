import type { FastifyInstance, FastifyRequest } from "fastify";

/**
 * MVP auth: bearer token → { tenant_id, role }.
 *
 * The token table is loaded from `ADMATIX_API_TOKENS`, a JSON object of
 * `{ "<token>": { "tenant_id": "...", "role": "..." } }`. If the env var
 * is absent, two dev defaults are installed so the demo works out of the
 * box without leaking a production secret:
 *
 *   - `tok_demo_media_manager` → tenant_demo / media_manager
 *   - `tok_demo_viewer`        → tenant_demo / viewer
 *
 * Every route that mutates or reads tenant-scoped state goes through
 * `requireAuth`. The resolved identity replaces any tenant value the
 * caller supplied in the body — the caller cannot manufacture a
 * different tenant.
 */

export interface ApiIdentity {
  tenant_id: string;
  role: string;
  token_prefix: string;
}

declare module "fastify" {
  interface FastifyRequest {
    identity?: ApiIdentity;
  }
}

const DEV_TOKENS: Record<string, { tenant_id: string; role: string }> = {
  tok_demo_media_manager: { tenant_id: "tenant_demo", role: "media_manager" },
  tok_demo_viewer: { tenant_id: "tenant_demo", role: "viewer" },
  tok_demo_finance_director: {
    tenant_id: "tenant_demo",
    role: "finance_director",
  },
};

function isProductionEnv(): boolean {
  return (
    process.env["ADMATIX_ENV"] === "production" ||
    process.env["NODE_ENV"] === "production"
  );
}

function loadTokens(): Record<string, { tenant_id: string; role: string }> {
  const raw = process.env["ADMATIX_API_TOKENS"];
  if (!raw) {
    if (isProductionEnv()) {
      throw new Error(
        "ADMATIX_API_TOKENS is required in production; demo defaults are local-only.",
      );
    }
    return DEV_TOKENS;
  }
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (
      parsed === null ||
      typeof parsed !== "object" ||
      Array.isArray(parsed)
    ) {
      throw new Error("ADMATIX_API_TOKENS must be a JSON object");
    }
    const out: Record<string, { tenant_id: string; role: string }> = {};
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      if (isProductionEnv() && Object.hasOwn(DEV_TOKENS, k)) {
        throw new Error(`ADMATIX_API_TOKENS includes demo default token "${k}"`);
      }
      if (
        v &&
        typeof v === "object" &&
        typeof (v as { tenant_id?: unknown }).tenant_id === "string" &&
        typeof (v as { role?: unknown }).role === "string"
      ) {
        out[k] = {
          tenant_id: (v as { tenant_id: string }).tenant_id,
          role: (v as { role: string }).role,
        };
      }
    }
    if (isProductionEnv() && Object.keys(out).length === 0) {
      throw new Error("ADMATIX_API_TOKENS must define at least one production token");
    }
    return out;
  } catch (err) {
    throw new Error(
      `ADMATIX_API_TOKENS is not valid JSON of { token: { tenant_id, role } }: ${(err as Error).message}`,
    );
  }
}

function extractBearer(req: FastifyRequest): string | null {
  const auth = req.headers["authorization"];
  if (typeof auth !== "string") return null;
  const m = /^Bearer\s+(\S+)$/.exec(auth);
  return m ? m[1]! : null;
}

export function resolveIdentity(req: FastifyRequest): ApiIdentity | null {
  return resolveIdentityWithTokens(req, loadTokens());
}

function resolveIdentityWithTokens(
  req: FastifyRequest,
  tokens: Record<string, { tenant_id: string; role: string }>,
): ApiIdentity | null {
  const token = extractBearer(req);
  if (!token) return null;
  const found = tokens[token];
  if (!found) return null;
  return {
    tenant_id: found.tenant_id,
    role: found.role,
    token_prefix: token.slice(0, 8),
  };
}

export function registerAuthHook(app: FastifyInstance): void {
  const tokens = loadTokens();
  app.addHook("onRequest", async (req, reply) => {
    // /healthz is the only unauthenticated route.
    if (req.url === "/healthz" || req.url.startsWith("/healthz?")) return;
    const identity = resolveIdentityWithTokens(req, tokens);
    if (!identity) {
      reply.code(401);
      return reply.send({ error: "unauthorized" });
    }
    req.identity = identity;
    return undefined;
  });
}

export function requireRole(identity: ApiIdentity | undefined, allowed: string[]): true | { error: string } {
  if (!identity) return { error: "unauthorized" };
  if (!allowed.includes(identity.role)) {
    return { error: `forbidden_role:${identity.role}` };
  }
  return true;
}
