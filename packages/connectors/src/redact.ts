const SECRET_KEY = /(?:access|refresh)?token|secret|password|authorization|cookie|api[_-]?key/i;

export function redactConnectorSecrets<T>(value: T): T {
  return redactValue(value) as T;
}

function redactValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((item) => redactValue(item));
  if (value === null || typeof value !== "object") return value;

  const out: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value)) {
    out[key] = SECRET_KEY.test(key) ? "[REDACTED]" : redactValue(child);
  }
  return out;
}
