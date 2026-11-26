/**
 * Data hook for the activity pages: one `GET` of a JSON route with the loading, error and reload state.
 *
 * @module
 */
import { useCallback, useEffect, useState } from "react";

/** What {@link useActivity} returns. */
export interface ActivityState<T> {
  /** The parsed JSON body, or `null` until the first answer (and after a failure). */
  data: T | null;
  /** The failure message: `"unauthorized"` for a 401, the server's `error` field or the status text otherwise. */
  error: string | null;
  /** `true` while a request is in flight. */
  loading: boolean;
  /** Fetches the route again. */
  reload: () => void;
}

/**
 * Fetches a JSON route once per `path` and exposes the result.
 *
 * @typeParam T - The shape of the response body.
 * @param path - The route, e.g. `/api/activity/me`. Changing it fetches again.
 * @returns `{ data, error, loading, reload }`.
 */
export function useActivity<T>(path: string): ActivityState<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let live = true;
    setLoading(true);
    setError(null);
    (async () => {
      try {
        const res = await fetch(path, { headers: { accept: "application/json" } });
        if (res.status === 401) throw new Error("unauthorized");
        const body = await res.json().catch(() => null);
        if (!res.ok) throw new Error((body as { error?: string } | null)?.error ?? res.statusText);
        if (live) setData(body as T);
      } catch (e) {
        if (live) {
          setData(null);
          setError(e instanceof Error ? e.message : String(e));
        }
      } finally {
        if (live) setLoading(false);
      }
    })();
    return () => {
      live = false;
    };
  }, [path, tick]);

  const reload = useCallback(() => setTick((n) => n + 1), []);
  return { data, error, loading, reload };
}
