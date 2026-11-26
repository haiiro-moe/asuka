/**
 * Pure status helpers of the admin diagnostics page: the narrator text of the Wrapped run and the
 * history backfill for the status strip, whether either is running, and how often to poll. No DOM, so
 * they are unit-tested with `bun test`.
 *
 * @module
 */
import type { BackfillStatus } from "../../../../plugins/activity/backfill/types.ts";
import type { PreviewStatus, WrappedRunStatus } from "../../../../plugins/activity/types/wrapped.ts";
import { formatCount } from "./format.ts";
import { previewRunning } from "./preview.ts";

/** Poll interval while the Wrapped run or the backfill is running, or the backfill modal is open. */
export const FAST_POLL_MS = 2_000;
/** Poll interval while nothing is running. */
export const SLOW_POLL_MS = 30_000;

/** The ink a status line is drawn in: the strip backs the words up with a colour, never replaces them. */
export type StatusInk = "subtle" | "gold" | "foam" | "love" | "rose";

/** One line of the status strip. */
export interface StatusLine {
  /** What the line is about: `wrapped 2026` or `backfill`. */
  subject: string;
  /** The state in words: `sending 12 of 40`. */
  text: string;
  /** The colour behind the words: rose while running, gold when someone is needed, foam done, love failed. */
  ink: StatusInk;
}

/** True while the Wrapped run is working in the background (processing or sending). */
export function wrappedRunning(s: WrappedRunStatus | null | undefined): boolean {
  return s?.status === "processing" || s?.status === "sending";
}

/** True while a backfill run is live. */
export function backfillRunning(b: BackfillStatus | null | undefined): boolean {
  return b?.status === "running";
}

/**
 * How far the send step has got: links settled (sent, failed or skipped) of the members the run covers.
 * `sent` counts every sent link of the year, so a second send starts part of the way along.
 *
 * @param s - The run.
 * @returns `[n, N]`, with `n` never above `N`.
 */
export function sendProgress(s: WrappedRunStatus): [number, number] {
  const n = s.sent + s.failed + s.skipped;
  return [Math.min(n, s.total), s.total];
}

/**
 * The status strip's line for the Wrapped run.
 *
 * - idle: `idle, no run yet`
 * - processing: `processing 12 of 40`
 * - processed: `processed, ready to send`
 * - sending: `sending 12 of 40` (plus `, 1 failed` once a DM has failed)
 * - done: `done: 30 sent, 2 failed, 8 not opted in`
 * - failed: `failed at 12 of 40` (processing incomplete) or `failed while sending`
 * - interrupted: `interrupted at 12 of 40, resume it from the data tab`
 *
 * @param s - The run, as `GET /api/activity/wrapped/run` returns it.
 * @returns The line.
 */
export function wrappedStatusLine(s: WrappedRunStatus): StatusLine {
  const subject = s.year != null ? `wrapped ${s.year}` : "wrapped";
  const of = (n: number, total: number) => `${formatCount(n)} of ${formatCount(total)}`;
  switch (s.status) {
    case "idle":
      return { subject, text: "idle, no run yet", ink: "subtle" };
    case "processing":
      return { subject, text: `processing ${of(s.processed, s.total)}`, ink: "rose" };
    case "processed":
      return { subject, text: "processed, ready to send", ink: "gold" };
    case "sending": {
      const [n, total] = sendProgress(s);
      const failed = s.failed > 0 ? `, ${formatCount(s.failed)} failed` : "";
      return { subject, text: `sending ${of(n, total)}${failed}`, ink: "rose" };
    }
    case "done":
      return {
        subject,
        text: `done: ${formatCount(s.sent)} sent, ${formatCount(s.failed)} failed, ${formatCount(s.skipped)} not opted in`,
        ink: s.failed > 0 ? "gold" : "foam",
      };
    case "failed":
      return {
        subject,
        text: s.processed < s.total ? `failed at ${of(s.processed, s.total)}` : "failed while sending",
        ink: "love",
      };
    case "interrupted":
      return {
        subject,
        text:
          s.processed < s.total
            ? `interrupted at ${of(s.processed, s.total)}, resume it from the data tab`
            : "interrupted while sending, resume it from the data tab",
        ink: "gold",
      };
  }
}

/**
 * The status strip's line for the history backfill.
 *
 * - idle: `idle, nothing read yet`
 * - running: `reading 4 of 30 channels, 12,000 messages`
 * - stopped: `stopped at 4 of 30 channels, resume it from the data tab`
 * - done: `done: 30 channels, 12,000 messages` (plus `, 2 channel errors` when some failed)
 * - failed: `failed: could not list the channels`
 *
 * @param b - The backfill, as `GET /api/activity/backfill` returns it.
 * @returns The line.
 */
export function backfillStatusLine(b: BackfillStatus): StatusLine {
  const subject = "backfill";
  const channels = `${formatCount(b.channelsDone)} of ${formatCount(b.channelsTotal)} channels`;
  const messages = `${formatCount(b.scanned)} messages`;
  const errors = b.errors > 0 ? `, ${formatCount(b.errors)} channel error${b.errors === 1 ? "" : "s"}` : "";
  switch (b.status) {
    case "idle":
      return { subject, text: "idle, nothing read yet", ink: "subtle" };
    case "running":
      return { subject, text: `reading ${channels}, ${messages}`, ink: "rose" };
    case "stopped":
      return { subject, text: `stopped at ${channels}${errors}, resume it from the data tab`, ink: "gold" };
    case "done":
      return { subject, text: `done: ${formatCount(b.channelsTotal)} channels, ${messages}${errors}`, ink: errors ? "gold" : "foam" };
    case "failed":
      return { subject, text: "failed: could not list the channels", ink: "love" };
  }
}

/**
 * How long to wait before the next status poll: {@link FAST_POLL_MS} while the Wrapped run, the
 * backfill or the admin's private preview is running (or `fast` is asked for, such as while the
 * backfill modal is open), else {@link SLOW_POLL_MS}. One loop polls all three, so intervals never
 * stack.
 *
 * @param wrapped - The last Wrapped run status, or null when unknown.
 * @param backfill - The last backfill status, or null when unknown.
 * @param fast - Forces the fast interval.
 * @param preview - The last private preview status, or null when unknown.
 * @returns Milliseconds.
 */
export function pollInterval(
  wrapped: WrappedRunStatus | null | undefined,
  backfill: BackfillStatus | null | undefined,
  fast = false,
  preview: PreviewStatus | null | undefined = null,
): number {
  return fast || wrappedRunning(wrapped) || backfillRunning(backfill) || previewRunning(preview) ? FAST_POLL_MS : SLOW_POLL_MS;
}
