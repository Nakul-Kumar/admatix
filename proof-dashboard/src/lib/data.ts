import { useEffect, useState } from "react";
import type { DataOrigin, OriginEnvelope } from "./types";

export type DataState<T> =
  | { status: "loading"; data: null; error: null }
  | { status: "ready"; data: T; error: null }
  | { status: "error"; data: null; error: string; origin: DataOrigin };

const ORIGIN_KINDS = new Set<DataOrigin["kind"]>([
  "live",
  "artifact",
  "demo",
  "fixture",
  "unavailable",
]);

function unavailableOrigin(path: string, error: string): DataOrigin {
  return {
    kind: "unavailable",
    label: "Dataset unavailable",
    description: error,
    artifact_uri: path,
    fetched_at: new Date().toISOString(),
  };
}

function hasOrigin(data: unknown): data is OriginEnvelope {
  if (!data || typeof data !== "object") return false;
  const origin = (data as { origin?: Partial<DataOrigin> }).origin;
  return (
    !!origin &&
    typeof origin.label === "string" &&
    origin.label.trim().length > 0 &&
    typeof origin.kind === "string" &&
    ORIGIN_KINDS.has(origin.kind as DataOrigin["kind"])
  );
}

export function useJson<T extends OriginEnvelope>(path: string): DataState<T> {
  const [state, setState] = useState<DataState<T>>({
    status: "loading",
    data: null,
    error: null,
  });

  useEffect(() => {
    let cancelled = false;
    const url = `${import.meta.env.BASE_URL}${path.replace(/^\//, "")}`;
    fetch(url)
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status} fetching ${url}`);
        return r.json() as Promise<T>;
      })
      .then((data) => {
        if (!hasOrigin(data)) {
          throw new Error(
            `Dataset ${url} is missing required origin metadata; refusing to render it as proof.`,
          );
        }
        if (!cancelled) setState({ status: "ready", data, error: null });
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          const msg = err instanceof Error ? err.message : String(err);
          setState({
            status: "error",
            data: null,
            error: msg,
            origin: unavailableOrigin(path, msg),
          });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [path]);

  return state;
}
