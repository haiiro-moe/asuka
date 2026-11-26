/**
 * A JSON request helper for the admin page's actions. Unlike `api.ts`, it does not throw on a 409 or a
 * 502: the Wrapped and backfill routes answer those with a body that says what happened
 * (`already-running`, `not-processed`, a failed announcement), and the page shows it.
 *
 * @module
 */

/** The outcome of {@link call}. */
export interface CallResult<T> {
  /** True for a 2xx answer. */
  ok: boolean;
  /** The HTTP status; 0 when the request never reached the server. */
  status: number;
  /** The parsed JSON body, or null when there was none or it was not JSON. */
  body: T | null;
  /**
   * A short cause for a failure: the body's `error` field, `unauthorized` for a 401, the status text,
   * or the network error. Null for a 2xx answer.
   */
  error: string | null;
}

/**
 * Sends one JSON request and never throws.
 *
 * @typeParam T - The shape of the response body (on success and on a 409 or 502 alike).
 * @param method - `GET` or `POST`.
 * @param path - The route, such as `/api/activity/wrapped/send`.
 * @param body - A JSON body for a `POST`; omitted for none.
 * @returns The status, the body and a failure cause.
 */
export async function call<T>(method: "GET" | "POST", path: string, body?: unknown): Promise<CallResult<T>> {
  try {
    const res = await fetch(path, {
      method,
      headers: body !== undefined ? { "content-type": "application/json", accept: "application/json" } : { accept: "application/json" },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const parsed = (await res.json().catch(() => null)) as T | null;
    if (res.ok) return { ok: true, status: res.status, body: parsed, error: null };
    const field = (parsed as { error?: unknown } | null)?.error;
    const error = res.status === 401 ? "unauthorized" : typeof field === "string" ? field : res.statusText || `status ${res.status}`;
    return { ok: false, status: res.status, body: parsed, error };
  } catch (e) {
    return { ok: false, status: 0, body: null, error: e instanceof Error ? e.message : String(e) };
  }
}
