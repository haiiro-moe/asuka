import { expect, test } from "bun:test";
import { backfill, run } from "./fixtures.ts";
import {
  FAST_POLL_MS,
  SLOW_POLL_MS,
  backfillStatusLine,
  buildSummary,
  pollInterval,
  runErrorText,
  sendProgress,
  wrappedStatusLine,
} from "./status.ts";

test("wrappedStatusLine covers every run state", () => {
  expect(wrappedStatusLine(run({ id: null, year: null, status: "idle", total: 0 }))).toEqual({
    subject: "wrapped",
    text: "idle, no run yet",
    ink: "subtle",
  });
  expect(wrappedStatusLine(run({ status: "processing", processed: 12 })).text).toBe("processing 12 of 40");
  expect(wrappedStatusLine(run({ status: "processed", processed: 40 })).text).toBe("processed, ready to send");
  expect(wrappedStatusLine(run({ status: "sending", processed: 40, sent: 10, failed: 1, skipped: 1 })).text).toBe(
    "sending 12 of 40, 1 failed",
  );
  expect(wrappedStatusLine(run({ status: "sending", processed: 40, sent: 12 })).text).toBe("sending 12 of 40");
  const done = wrappedStatusLine(run({ status: "done", processed: 40, sent: 30, failed: 2, skipped: 8 }));
  expect(done.text).toBe("done: 30 sent, 2 failed, 8 not opted in");
  expect(done.ink).toBe("gold");
  expect(wrappedStatusLine(run({ status: "done", processed: 40, sent: 32, skipped: 8 })).ink).toBe("foam");
  expect(wrappedStatusLine(run({ status: "failed", processed: 12 })).text).toBe("failed at 12 of 40");
  expect(wrappedStatusLine(run({ status: "failed", processed: 40 })).text).toBe("failed while sending");
  expect(wrappedStatusLine(run({ status: "interrupted", processed: 12 })).text).toContain("interrupted at 12 of 40");
  expect(wrappedStatusLine(run({ status: "interrupted", processed: 40 })).text).toContain("interrupted while sending");
  expect(wrappedStatusLine(run({ status: "processing" })).subject).toBe("wrapped 2026");
});

test("sendProgress never passes the total", () => {
  expect(sendProgress(run({ sent: 50, failed: 0, skipped: 0 }))).toEqual([40, 40]);
  expect(sendProgress(run({ sent: 3, failed: 1, skipped: 2 }))).toEqual([6, 40]);
});

test("backfillStatusLine covers every backfill state", () => {
  expect(backfillStatusLine(backfill()).text).toBe("idle, nothing read yet");
  expect(backfillStatusLine(backfill({ status: "running", channelsDone: 4, channelsTotal: 30, scanned: 12000 })).text).toBe(
    "reading 4 of 30 channels, 12,000 messages",
  );
  expect(backfillStatusLine(backfill({ status: "stopped", channelsDone: 4, channelsTotal: 30 })).text).toBe(
    "stopped at 4 of 30 channels, resume it from the data tab",
  );
  expect(backfillStatusLine(backfill({ status: "done", channelsDone: 30, channelsTotal: 30, scanned: 5 }))).toEqual({
    subject: "backfill",
    text: "done: 30 channels, 5 messages",
    ink: "foam",
  });
  expect(backfillStatusLine(backfill({ status: "done", channelsTotal: 30, errors: 1 })).text).toContain("1 channel error");
  expect(backfillStatusLine(backfill({ status: "failed" })).ink).toBe("love");
});

test("pollInterval is fast while anything runs or when forced", () => {
  expect(pollInterval(null, null)).toBe(SLOW_POLL_MS);
  expect(pollInterval(run({ status: "done" }), backfill({ status: "done" }))).toBe(SLOW_POLL_MS);
  expect(pollInterval(run({ status: "processing" }), backfill())).toBe(FAST_POLL_MS);
  expect(pollInterval(run({ status: "sending" }), null)).toBe(FAST_POLL_MS);
  expect(pollInterval(null, backfill({ status: "running" }))).toBe(FAST_POLL_MS);
  expect(pollInterval(run(), backfill(), true)).toBe(FAST_POLL_MS);
  expect(pollInterval(run({ status: "interrupted" }), backfill({ status: "stopped" }))).toBe(SLOW_POLL_MS);
});

test("runErrorText drops member ids from the run's error", () => {
  expect(runErrorText("a snapshot failed (123456789012345678): no such table")).toBe("a snapshot failed: no such table");
  expect(runErrorText("could not DM 123456789012345678")).toBe("could not DM a member");
  expect(runErrorText("the live member list could not be fetched")).toBe("the live member list could not be fetched");
  expect(runErrorText(null)).toBeNull();
  expect(runErrorText(undefined)).toBeNull();
  expect(runErrorText("  ")).toBeNull();
});

test("buildSummary counts the members that could not be built", () => {
  expect(buildSummary(run({ status: "processed" }))).toEqual({ line: null, note: null });
  expect(buildSummary(run({ status: "processed", buildFailed: 0, error: null }))).toEqual({ line: null, note: null });
  expect(buildSummary(run({ status: "processed", buildFailed: 1 })).line).toBe(
    "1 member could not be built. Processing went on without them.",
  );
  const s = buildSummary(run({ status: "done", buildFailed: 3, error: "a snapshot failed (123456789012345678): boom" }));
  expect(s.line).toBe("3 members could not be built. Processing went on without them.");
  expect(s.note).toBe("a snapshot failed: boom");
});

test("the status line adds the build failures, never on idle", () => {
  expect(wrappedStatusLine(run({ status: "processed", buildFailed: 2 })).text).toBe("processed, ready to send; 2 could not be built");
  expect(wrappedStatusLine(run({ status: "processing", processed: 12, buildFailed: 1 })).text).toBe(
    "processing 12 of 40; 1 could not be built",
  );
  expect(wrappedStatusLine(run({ status: "processed" })).text).toBe("processed, ready to send");
  expect(wrappedStatusLine(run({ status: "idle", buildFailed: 2 })).text).toBe("idle, no run yet");
});
