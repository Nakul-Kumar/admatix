import type { Connector } from "./connector.js";
import type { Platform } from "@admatix/schemas";

/**
 * Build a read-only `Connector` backed by `data/fixtures/`.
 *
 * `platform` selects which subdirectory to read. Default is `google_ads`,
 * matching the demo account `agency-demo` so detectors and the workflow
 * smoke tests have a known-good account out of the box.
 */
export function fixtureConnector(_platform?: Platform): Connector {
  throw new Error("not implemented");
}
