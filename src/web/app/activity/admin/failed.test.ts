import { expect, test } from "bun:test";
import { run } from "./fixtures.ts";
import { FAILED_LIST_CAP, RESEND_WORDS, failedListKey, failedListView, resendOutcome, showFailedList, showResend } from "./failed.ts";

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

test("resendOutcome reads every known result, also from a 409", () => {
  expect(resendOutcome(200, { result: "sent" }, null)).toEqual({ result: "sent", error: null });
  expect(resendOutcome(409, { result: "not-opted-in" }, "conflict")).toEqual({ result: "not-opted-in", error: null });
  expect(resendOutcome(409, { result: "already-sent" }, "conflict")).toEqual({ result: "already-sent", error: null });
  expect(resendOutcome(409, { result: "sending" }, "conflict")).toEqual({ result: "sending", error: null });
});

test("resendOutcome gives plain words for a failure", () => {
  expect(resendOutcome(401, null, "unauthorized")).toEqual({ result: null, error: "your session ended" });
  expect(resendOutcome(403, { error: "forbidden" }, "forbidden")).toEqual({ result: null, error: "you do not have access" });
  expect(resendOutcome(409, { result: "weird" }, "conflict")).toEqual({ result: null, error: "conflict" });
  expect(resendOutcome(0, null, null)).toEqual({ result: null, error: "no answer" });
});

test("RESEND_WORDS points a member who lost their link at /wrapped me", () => {
  expect(RESEND_WORDS["already-sent"]).toContain("/wrapped me");
  expect(RESEND_WORDS["not-opted-in"]).toContain("/wrapped me");
});

test("showResend hides during a send and locks after a resend that worked", () => {
  expect(showResend(run({ status: "sending" }), false).show).toBe(false);
  expect(showResend(run({ status: "done" }), false)).toEqual({ show: true, disabled: false });
  expect(showResend(run({ status: "done" }), true)).toEqual({ show: true, disabled: true });
});
