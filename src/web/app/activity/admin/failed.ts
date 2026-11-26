/**
 * Pure helpers of the failed-DM list in the send window: when to show it, when to fetch it again, and
 * what it renders (rows, the truncation line, the empty line). No DOM, so they are unit-tested with
 * `bun test`.
 *
 * @module
 */
import type { WrappedFailedList, WrappedResendResult, WrappedRunStatus } from "../../../../plugins/activity/types/wrapped.ts";

/** The most items `GET /api/activity/wrapped/failed` returns. */
export const FAILED_LIST_CAP = 200;

/** What the failed-DM list renders. */
export interface FailedListView {
  /** One user id per row, in the server's order (by user id). */
  rows: string[];
  /** The quiet line under the rows when the server capped the list; null otherwise. */
  more: string | null;
  /** The narrator line when there are no rows; null when there are. */
  empty: string | null;
}

/**
 * Turns the route's answer into what the list renders.
 *
 * @param list - `GET /api/activity/wrapped/failed`'s body.
 * @returns The rows, the truncation line and the empty line.
 */
export function failedListView(list: WrappedFailedList): FailedListView {
  const rows = list.items.map((i) => i.userId);
  return {
    rows,
    more: list.truncated ? `And more: the list is capped at ${FAILED_LIST_CAP}.` : null,
    empty: rows.length === 0 ? "No failed DMs. Everyone who opted in got theirs." : null,
  };
}

/**
 * Whether the send window shows the failed-DM list: once a send has run or is running (`sending`,
 * `done`, or `failed` or `interrupted` after processing completed). Before any send there is nothing to
 * list.
 *
 * @param s - The run status, or null while it is unknown.
 */
export function showFailedList(s: WrappedRunStatus | null): boolean {
  if (!s || s.year == null) return false;
  if (s.status === "sending" || s.status === "done") return true;
  if (s.status === "failed" || s.status === "interrupted") return s.total > 0 && s.processed >= s.total;
  return false;
}

/**
 * A key that changes exactly when the list should be fetched again: when a send finishes (the status
 * leaves `sending`), when another run starts, and when the failed count moves outside a send (a resend
 * that worked). It holds still while a send runs, so the list is not refetched for every DM.
 *
 * @param s - The run status, or null while it is unknown.
 */
export function failedListKey(s: WrappedRunStatus | null): string {
  if (!s) return "none";
  if (s.status === "sending") return `${s.id}:${s.year}:sending`;
  return `${s.id}:${s.year}:${s.status}:${s.failed}`;
}

/**
 * What `POST /api/activity/wrapped/resend/:userId` answers (`WrappedResendResult`): `sent` and `failed`
 * with a 200, `no-link` with a 404, and with a 409 `left` (the member left the server), `not-opted-in`,
 * `already-sent` (their link went out already) or `sending` (a send is running).
 */
export type ResendResult = WrappedResendResult;

/** The narrator words for a resend's answer. */
export const RESEND_WORDS: Record<ResendResult, string> = {
  sent: "Sent.",
  failed: "Failed again. Their DMs are probably closed.",
  "no-link": "They have no link that year.",
  left: "They left the server, so no DM goes out.",
  "not-opted-in": "They have not opted in, so no DM goes out. They can use /wrapped me.",
  "already-sent": "Their link went out already. A member who lost it can use /wrapped me.",
  sending: "A send is running. Try again when it finishes.",
};

const RESEND_RESULTS = new Set<string>(Object.keys(RESEND_WORDS));

/** The outcome of one resend: a known answer, or the failure text. */
export type ResendOutcome = { result: ResendResult; error: null } | { result: null; error: string };

/**
 * Reads a resend's answer: a known `result` in the body wins (a 409 carries one too); otherwise the
 * failure in plain words.
 *
 * @param status - The HTTP status; 0 when the request never reached the server.
 * @param body - The parsed body, or null.
 * @param error - The request helper's failure cause, or null.
 */
export function resendOutcome(status: number, body: unknown, error: string | null): ResendOutcome {
  const result = (body as { result?: unknown } | null)?.result;
  if (typeof result === "string" && RESEND_RESULTS.has(result)) return { result: result as ResendResult, error: null };
  if (status === 401) return { result: null, error: "your session ended" };
  if (status === 403) return { result: null, error: "you do not have access" };
  return { result: null, error: error || "no answer" };
}

/**
 * Whether a failed-list row offers `resend`: never while a send is running (the server refuses then),
 * and not again after a resend that worked until the list is fetched again.
 *
 * @param s - The run status, or null while it is unknown.
 * @param sentSinceFetch - True when this row's resend answered `sent` since the list was last fetched.
 */
export function showResend(s: WrappedRunStatus | null, sentSinceFetch: boolean): { show: boolean; disabled: boolean } {
  return { show: s?.status !== "sending", disabled: sentSinceFetch };
}
