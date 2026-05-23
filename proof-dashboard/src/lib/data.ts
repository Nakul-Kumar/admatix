import { useEffect, useState } from "react";

type DataState<T> =
  | { status: "loading"; data: null; error: null }
  | { status: "ready"; data: T; error: null }
  | { status: "error"; data: null; error: string };

export function useJson<T>(path: string): DataState<T> {
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
        if (!cancelled) setState({ status: "ready", data, error: null });
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          const msg = err instanceof Error ? err.message : String(err);
          setState({ status: "error", data: null, error: msg });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [path]);

  return state;
}
