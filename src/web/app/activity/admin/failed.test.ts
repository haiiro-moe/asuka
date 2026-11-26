import { expect, test } from "bun:test";
import { run } from "./fixtures.ts";
import { FAILED_LIST_CAP, failedListKey, failedListView, showFailedList } from "./failed.ts";

test("failedListView gives one row per failed member, in order", () => {
  const view = failedListView({
    year: 2026,
    items: [
      { userId: "11", state: "failed" },
      { userId: "22", state: "failed" },
    ],
    truncated: false,
  });
  expect(view).toEqual({ rows: ["11", "22"], more: null, empty: null });
});

test("failedListView says the list is capped when truncated", () => {
  const items = Array.from({ length: FAILED_LIST_CAP }, (_, i) => ({ userId: String(i + 1), state: "failed" as const }));
  const view = failedListView({ year: 2026, items, truncated: true });
  expect(view.rows).toHaveLength(200);
  expect(view.more).toBe("And more: the list is capped at 200.");
  expect(view.empty).toBeNull();
});

test("failedListView gives the narrator line when nothing failed", () => {
  const view = failedListView({ year: 2026, items: [], truncated: false });
  expect(view.rows).toEqual([]);
  expect(view.more).toBeNull();
  expect(view.empty).toBe("No failed DMs. Everyone who opted in got theirs.");
});

test("showFailedList waits for a send", () => {
  expect(showFailedList(null)).toBe(false);
  expect(showFailedList(run({ status: "idle", year: null }))).toBe(false);
  expect(showFailedList(run({ status: "processing" }))).toBe(false);
  expect(showFailedList(run({ status: "processed", processed: 40 }))).toBe(false);
  expect(showFailedList(run({ status: "sending", processed: 40 }))).toBe(true);
  expect(showFailedList(run({ status: "done", processed: 40 }))).toBe(true);
  expect(showFailedList(run({ status: "failed", processed: 40 }))).toBe(true);
  expect(showFailedList(run({ status: "failed", processed: 12 }))).toBe(false);
  expect(showFailedList(run({ status: "interrupted", processed: 40 }))).toBe(true);
});

test("failedListKey changes when a send finishes or a resend lands, not during a send", () => {
  const a = failedListKey(run({ status: "sending", failed: 1 }));
  const b = failedListKey(run({ status: "sending", failed: 5 }));
  expect(a).toBe(b);
  const done = failedListKey(run({ status: "done", failed: 5 }));
  expect(done).not.toBe(b);
  expect(failedListKey(run({ status: "done", failed: 4 }))).not.toBe(done);
  expect(failedListKey(run({ id: 2, status: "done", failed: 5 }))).not.toBe(done);
  expect(failedListKey(null)).toBe("none");
});
