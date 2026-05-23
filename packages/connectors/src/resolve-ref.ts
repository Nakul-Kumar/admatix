/**
 * Account references identify where an account lives. The MVP only ever
 * resolves `fixture:` refs; `live:` is reserved for future connectors and is
 * accepted by the parser so callers can stage configs without code changes.
 */
export interface AccountRef {
  kind: "fixture" | "live";
  id: string;
}

const REF_RE = /^(fixture|live):([A-Za-z0-9][A-Za-z0-9._-]*)$/;

export function resolveAccountRef(ref: string): AccountRef {
  if (typeof ref !== "string" || ref.length === 0) {
    throw new Error(
      `resolveAccountRef: ref must be a non-empty string of the form "<kind>:<id>" (got ${JSON.stringify(ref)})`,
    );
  }
  const match = REF_RE.exec(ref);
  if (!match) {
    throw new Error(
      `resolveAccountRef: invalid ref "${ref}". Expected "fixture:<id>" or "live:<id>" where id matches [A-Za-z0-9][A-Za-z0-9._-]*.`,
    );
  }
  const kind = match[1] as "fixture" | "live";
  const id = match[2]!;
  return { kind, id };
}
