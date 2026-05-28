import { z } from "@admatix/schemas";

const ENV_REF = /^env:[A-Z_][A-Z0-9_]*$/;
const VAULT_REF = /^vault:app\.connections\/[A-Za-z0-9][A-Za-z0-9._-]*$/;
const MCP_REF = /^mcp:[A-Za-z0-9][A-Za-z0-9._-]*\/[A-Za-z0-9][A-Za-z0-9._-]*$/;
const RAW_SECRET =
  /^(?:Bearer\s+)?(?:sk|rk|pk)_(?:test|live)_[A-Za-z0-9]+|^ya29\.|^EAA[A-Za-z0-9]+/i;

export const CredentialRef = z.string().superRefine((value, ctx) => {
  if (ENV_REF.test(value) || VAULT_REF.test(value) || MCP_REF.test(value)) return;
  const looksRaw =
    RAW_SECRET.test(value.trim()) ||
    value.trim().startsWith("{") ||
    value.includes("\n") ||
    /client_secret|refresh_token|access_token|api[_-]?key|password/i.test(value);
  ctx.addIssue({
    code: z.ZodIssueCode.custom,
    message: looksRaw
      ? "raw credential material is not allowed; pass an env:, vault:, or mcp: credential reference"
      : "credential ref must match env:NAME, vault:app.connections/<id>, or mcp:<server>/<connection>",
  });
});
export type CredentialRef = z.infer<typeof CredentialRef>;

export interface CredentialMaterial {
  readonly ref: CredentialRef;
  readonly value: string;
  readonly redacted: string;
}

export interface CredentialResolver {
  resolve(ref: CredentialRef): Promise<CredentialMaterial>;
}

export function parseCredentialRef(value: string): CredentialRef {
  return CredentialRef.parse(value);
}

export function credentialRefKind(ref: CredentialRef): "env" | "vault" | "mcp" {
  if (ref.startsWith("env:")) return "env";
  if (ref.startsWith("vault:")) return "vault";
  return "mcp";
}

export function createEnvCredentialResolver(env: NodeJS.ProcessEnv = process.env): CredentialResolver {
  return {
    async resolve(ref) {
      const parsed = parseCredentialRef(ref);
      if (!parsed.startsWith("env:")) {
        throw new Error(`credential resolver only supports env: refs in this runtime`);
      }
      const name = parsed.slice("env:".length);
      const value = env[name];
      if (!value) {
        throw new Error(`credential ref env:${name} is not set`);
      }
      return { ref: parsed, value, redacted: redactCredentialValue(value) };
    },
  };
}

export function redactCredentialRef(ref: CredentialRef | string): string {
  const parsed = parseCredentialRef(ref);
  if (parsed.startsWith("env:")) return parsed;
  const [prefix, suffix] = parsed.split("/");
  if (!suffix) return parsed;
  return `${prefix}/${suffix.slice(0, 4)}...`;
}

export function redactCredentialValue(value: string): string {
  if (value.length <= 8) return "***";
  return `${value.slice(0, 4)}...${value.slice(-4)}`;
}
