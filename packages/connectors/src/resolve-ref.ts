/**
 * Account references identify where an account lives. The MVP only ever
 * resolves `fixture:` refs; `live:` is reserved for future connectors and
 * accepted by the parser so callers can stage configs.
 */
export interface AccountRef {
  kind: "fixture" | "live";
  id: string;
}

const REF_RE = /^(fixture|live):([A-Za-z0-9][A-Za-z0-9._:-]*)$/;

export function resolveAccountRef(ref: string): AccountRef {
  throw new Error("not implemented");
}
