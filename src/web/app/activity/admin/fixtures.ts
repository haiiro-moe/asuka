/**
 * Status fixtures for the admin page's unit tests: a Wrapped run, a backfill and a private preview status with sensible
 * defaults. Not used by the page itself.
 *
 * @module
 */
import type { BackfillStatus } from "../../../../plugins/activity/backfill/types.ts";
import type { PreviewStatus, WrappedRunStatus } from "../../../../plugins/activity/types/wrapped.ts";

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
    buildFailed: 0,
    error: null,
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

/**
 * A private preview status for tests: preview 7 of 2026, done, a sample of the admin and two members
 * (one not opted in), all linked, unless overridden.
 *
 * @param over - Fields to replace.
 */
export function preview(over: Partial<PreviewStatus> = {}): PreviewStatus {
  return {
    id: 7,
    status: "done",
    year: 2026,
    total: 3,
    done: 3,
    all: false,
    sampled: [
      { userId: "1", displayName: "admin", wouldSkip: false, hasLink: true },
      { userId: "2", displayName: "two", wouldSkip: true, hasLink: true },
      { userId: "3", displayName: "three", wouldSkip: false, hasLink: true },
    ],
    wouldSkip: 1,
    dmFailed: false,
    links: [
      { userId: "1", token: "t1" },
      { userId: "2", token: "t2" },
      { userId: "3", token: "t3" },
    ],
    serverToken: "srv",
    expiresAt: Date.UTC(2027, 1, 1) / 1000,
    error: null,
    startedAt: Date.UTC(2027, 0, 18) / 1000,
    finishedAt: Date.UTC(2027, 0, 18, 0, 5) / 1000,
    ...over,
  };
}

/** The status of an admin with no preview, as the server answers it. */
export function noPreview(): PreviewStatus {
  return preview({
    id: null,
    status: "idle",
    year: null,
    total: 0,
    done: 0,
    sampled: [],
    wouldSkip: 0,
    links: [],
    serverToken: null,
    expiresAt: null,
    startedAt: null,
    finishedAt: null,
  });
}
