/**
 * tests/e2e/demo-flow.test.ts — WP-K acceptance.
 *
 * Asserts:
 *   1. All 8 demo steps run and report ok.
 *   2. PolicyGuard blocks at least one unsafe action with a visible reason.
 *   3. The transcript printed by `scripts/demo.ts` matches the embedded
 *      transcript in `docs/runbooks/demo-script.md` line for line.
 *
 * Stub: full assertions land in the next commit (interface-first rule).
 */
import { describe, it, expect } from "vitest";

describe("AdMatix demo flow (WP-K)", () => {
  it.todo("runs all 8 demo steps green");
  it.todo("blocks an unsafe budget action with a visible reason");
  it.todo("matches docs/runbooks/demo-script.md line for line");
});
