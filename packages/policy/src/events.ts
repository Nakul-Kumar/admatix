import { z } from "zod";

/**
 * Minimal structural store contract for event emission.
 * Compatible with (a subset of) the `Store` interface in `@admatix/core`.
 */
export interface EventStore {
  append(stream: string, record: unknown): Promise<void>;
}

export const AdmatixEvent = z.object({
  ts: z.string().min(1),
  trace_id: z.string().min(1),
  workflow_id: z.string().min(1),
  step: z.enum(["plan", "activate", "measure", "reflect"]),
  agent_id: z.string().min(1),
  type: z.string().min(1),
  payload_hash: z.string().min(1),
  level: z.enum(["info", "warn", "error"]),
});
export type AdmatixEvent = z.infer<typeof AdmatixEvent>;

/**
 * Append one observability event to the workflow's JSONL trace stream.
 * The event is validated before write — invalid events throw instead of
 * silently polluting the ledger.
 */
export async function emitEvent(store: EventStore, e: AdmatixEvent): Promise<void> {
  if (!store || typeof store.append !== "function") {
    throw new Error(
      "emitEvent requires a Store with an append(stream, record) method.",
    );
  }
  const parsed = AdmatixEvent.parse(e);
  await store.append(`events/${parsed.workflow_id}`, parsed);
}
