/**
 * Data hook for the activity pages: one `GET` of a JSON route with the loading, error and reload state.
 *
 * @module
 */
import { useCallback, useEffect, useState } from "react";

/** What {@link useActivity} returns. */
export interface ActivityState<T> {
  /** The parsed JSON body of the current `path`, or `null` until it answers (and after a failure). */
  data: T | null;
  /** The failure message: `"unauthorized"` for a 401, the server's `error` field or `http <status>` otherwise. */
  error: string | null;
  /** `true` while a request is in flight. */
  loading: boolean;
  /** Fetches the route again. */
  reload: () => void;
}

/** The last settled answer of {@link useActivity}, kept together with the path it answers. */
export interface ActivitySlot<T> {
  /** The route this answer belongs to. */
  path: string;
  /** The parsed body, or `null` after a failure. */
  data: T | null;
  /** The failure message, or `null` after a success. */
  error: string | null;
}

/**
 * The failure message for a non-OK answer: the server's `error` field, else the status text, else
 * `http <status>` (HTTP/2 answers carry an empty status text), so it is never an empty string.
 *
 * @param status - The HTTP status code.
 * @param statusText - The response's status text, often empty.
 * @param body - The parsed JSON body, or `null` when it was not JSON.
 */
export function failureText(status: number, statusText: string, body: unknown): string {
  if (status === 401) return "unauthorized";
  const field = (body as { error?: unknown } | null)?.error;
  if (typeof field === "string" && field.trim()) return field;
  return statusText.trim() || `http ${status}`;
}

/**
 * What the page sees for `path`: the slot's answer only when it belongs to `path`; otherwise a loading
 * state with no data, so a period or tab change never shows the previous route's answer under the new
 * label.
 *
 * @param slot - The last settled answer, or `null` before the first.
 * @param path - The route the page asks for now.
 * @param inFlight - `true` while a request is running.
 */
export function viewOf<T>(
  slot: ActivitySlot<T> | null,
  path: string,
  inFlight: boolean,
): Omit<ActivityState<T>, "reload"> {
  if (!slot || slot.path !== path) return { data: null, error: null, loading: true };
  return { data: slot.data, error: inFlight ? null : slot.error, loading: inFlight };
}

/**
 * Fetches a JSON route once per `path` and exposes the result.
 *
 * @typeParam T - The shape of the response body.
 * @param path - The route, e.g. `/api/activity/me`. Changing it fetches again.
 * @returns `{ data, error, loading, reload }`.
 */
export function useActivity<T>(path: string): ActivityState<T> {
  const [slot, setSlot] = useState<ActivitySlot<T> | null>(null);
  const [inFlight, setInFlight] = useState(true);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let live = true;
    setInFlight(true);
    (async () => {
      let next: ActivitySlot<T>;
      try {
        const res = await fetch(path, { headers: { accept: "application/json" } });
        const body = await res.json().catch(() => null);
        next = res.ok
          ? { path, data: body as T, error: null }
          : { path, data: null, error: failureText(res.status, res.statusText, body) };
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        next = { path, data: null, error: msg || "network error" };
      }
      if (live) {
        setSlot(next);
        setInFlight(false);
      }
    })();
    return () => {
      live = false;
    };
  }, [path, tick]);

  const reload = useCallback(() => setTick((n) => n + 1), []);
  return { ...viewOf(slot, path, inFlight), reload };
}
