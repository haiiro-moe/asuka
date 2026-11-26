/**
 * Pure helpers of the failed-DM list in the send window: when to show it, when to fetch it again, and
 * what it renders (rows, the truncation line, the empty line). No DOM, so they are unit-tested with
 * `bun test`.
 *
 * @module
 */
import type { WrappedFailedList, WrappedRunStatus } from "../../../../plugins/activity/types/wrapped.ts";

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
