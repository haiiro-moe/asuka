/**
 * Status fixtures for the admin page's unit tests: a Wrapped run and a backfill status with sensible
 * defaults. Not used by the page itself.
 *
 * @module
 */
import type { BackfillStatus } from "../../../../plugins/activity/backfill/types.ts";
import type { WrappedRunStatus } from "../../../../plugins/activity/types/wrapped.ts";

/**
 * A run status for tests: run 1 of 2026 over 40 members, 30 opted in, idle unless overridden.
 *
 * @param over - Fields to replace.
 */
export function run(over: Partial<WrappedRunStatus> = {}): WrappedRunStatus {
  return {
    id: 1,
    year: 2026,
    status: "idle",
    total: 40,
    processed: 0,
    sent: 0,
    failed: 0,
    skipped: 0,
    optedIn: 30,
    startedAt: 1,
    finishedAt: null,
    announce: true,
    announcedAt: null,
    ...over,
  };
}

/**
 * A backfill status for tests: idle with nothing read unless overridden.
 *
 * @param over - Fields to replace.
 */
export function backfill(over: Partial<BackfillStatus> = {}): BackfillStatus {
  return {
    status: "idle",
    channelsDone: 0,
    channelsTotal: 0,
    scanned: 0,
    current: null,
    startedAt: null,
    elapsedSec: 0,
    reactions: false,
    errors: 0,
    ...over,
  };
}
