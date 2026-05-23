/**
 * Account references identify where an account lives. The MVP only ever
 * resolves `fixture:` refs; the `live:` grammar is rejected at the parse
 * boundary until a live connector exists (AGENTS.md §2). This prevents
 * the silent "asked for live, got fixture" failure mode QA flagged.
 */
export interface AccountRef {
  kind: "fixture";
  id: string;
}

const REF_RE = /^(fixture|live):([A-Za-z0-9][A-Za-z0-9._-]*)$/;

export function resolveAccountRef(ref: string): AccountRef {
  if (typeof ref !== "string" || ref.length === 0) {
    throw new Error(
      `resolveAccountRef: ref must be a non-empty string of the form "fixture:<id>" (got ${JSON.stringify(ref)})`,
    );
  }
  const match = REF_RE.exec(ref);
  if (!match) {
    throw new Error(
      `resolveAccountRef: invalid ref "${ref}". Expected "fixture:<id>" where id matches [A-Za-z0-9][A-Za-z0-9._-]*.`,
    );
  }
  const kind = match[1]!;
  const id = match[2]!;
  if (kind !== "fixture") {
    throw new Error(
      `resolveAccountRef: "${kind}:" refs are not supported in the MVP — only "fixture:<id>". ` +
        `(Got "${ref}".) Live connectors are out of scope until a live read-only connector exists.`,
    );
  }
  return { kind: "fixture", id };
}
