import { expect, test } from "bun:test";
import { backfill, noPreview, preview, run } from "./fixtures.ts";
import {
  DISCARD_CONFIRM,
  PREVIEW_STRIP_LINGER_SEC,
  discardGate,
  discardOutcome,
  expiryLine,
  parseMemberList,
  previewInStrip,
  previewLinkUrl,
  previewRunning,
  previewServerUrl,
  previewStartBody,
  previewStartGate,
  previewStatusLine,
  previewStripLine,
  skippedMembers,
  startOutcome,
  wouldSkipLine,
} from "./preview.ts";
import { FAST_POLL_MS, SLOW_POLL_MS, pollInterval } from "./status.ts";

test("parseMemberList: empty means the default sample", () => {
  expect(parseMemberList("")).toEqual({ ids: [], error: null });
  expect(parseMemberList("  , \n ")).toEqual({ ids: [], error: null });
});

test("parseMemberList: digits only, separated by spaces, commas or lines", () => {
  expect(parseMemberList("111, 222\n333 444")).toEqual({ ids: ["111", "222", "333", "444"], error: null });
  expect(parseMemberList("111 abc").error).toBe('"abc" is not a member id. Ids are digits only.');
  expect(parseMemberList("12.5").error).not.toBeNull();
  expect(parseMemberList("@someone").error).not.toBeNull();
});

test("parseMemberList: mentions become bare ids and duplicates go", () => {
  expect(parseMemberList("<@111> <@!222> 111 222")).toEqual({ ids: ["111", "222"], error: null });
  expect(parseMemberList("<@abc>").error).not.toBeNull();
});

test("parseMemberList: at most 10 distinct members", () => {
  const ten = Array.from({ length: 10 }, (_, i) => String(100 + i)).join(" ");
  expect(parseMemberList(ten).ids).toHaveLength(10);
  expect(parseMemberList(`${ten} ${ten}`).ids).toHaveLength(10);
  expect(parseMemberList(`${ten} 999`)).toEqual({ ids: [], error: "At most 10 members. You named 11." });
});

test("previewStartBody leaves out an empty list and an off flag", () => {
  expect(previewStartBody(2026, [], false)).toEqual({ year: 2026 });
  expect(previewStartBody(2026, ["1", "2"], true)).toEqual({ year: 2026, members: ["1", "2"], all: true });
});

test("previewStatusLine covers every state and always says private preview", () => {
  expect(previewStatusLine(noPreview())).toEqual({ subject: "private preview", text: "no preview", ink: "subtle" });
  expect(previewStatusLine(preview({ status: "processing", done: 2, total: 4 })).text).toBe("processing 2 of 4");
  expect(previewStatusLine(preview({ status: "processed" })).text).toBe("built, the preview dms to you are next");
  expect(previewStatusLine(preview({ status: "sending" })).text).toBe("sending the preview dms to you");
  expect(previewStatusLine(preview({ status: "done" }))).toEqual({
    subject: "private preview 2026",
    text: "done, sent to you",
    ink: "foam",
  });
  expect(previewStatusLine(preview({ status: "done", dmFailed: true }))).toMatchObject({
    text: "done, but your dms are closed",
    ink: "love",
  });
  expect(previewStatusLine(preview({ status: "failed" })).ink).toBe("love");
  expect(previewStatusLine(preview({ status: "interrupted" })).text).toBe("interrupted, start a new preview to replace it");
  expect(previewStripLine(preview()).text).toBe("done, sent to you (nothing goes to members)");
});

test("previewRunning covers processing, processed and sending", () => {
  expect(previewRunning(null)).toBe(false);
  for (const status of ["processing", "processed", "sending"] as const) expect(previewRunning(preview({ status }))).toBe(true);
  for (const status of ["idle", "done", "failed", "interrupted"] as const) expect(previewRunning(preview({ status }))).toBe(false);
});

test("previewInStrip: while running and briefly after it finished", () => {
  const finished = preview().finishedAt!;
  expect(previewInStrip(null, finished)).toBe(false);
  expect(previewInStrip(noPreview(), finished)).toBe(false);
  expect(previewInStrip(preview({ status: "sending", finishedAt: null }), finished + 99_999)).toBe(true);
  expect(previewInStrip(preview(), finished + 60)).toBe(true);
  expect(previewInStrip(preview(), finished + PREVIEW_STRIP_LINGER_SEC + 1)).toBe(false);
  expect(previewInStrip(preview({ status: "failed" }), finished + 60)).toBe(true);
  expect(previewInStrip(preview({ status: "interrupted", finishedAt: null }), finished)).toBe(false);
});

test("previewStartGate refuses while running, with a bad list or year", () => {
  const ok = parseMemberList("");
  expect(previewStartGate(null, ok, 2026).enabled).toBe(false);
  expect(previewStartGate(preview({ status: "processing" }), ok, 2026).reason).toBe(
    "Your preview is running. Wait for it to finish.",
  );
  expect(previewStartGate(preview(), parseMemberList("x"), 2026).reason).toBe("Fix the member list first.");
  expect(previewStartGate(preview(), ok, null).enabled).toBe(false);
  expect(previewStartGate(preview(), ok, 2026)).toEqual({ enabled: true, reason: null });
  expect(previewStartGate(noPreview(), ok, 2026).enabled).toBe(true);
  expect(previewStartGate(preview({ status: "interrupted" }), ok, 2026).enabled).toBe(true);
});

test("discardGate follows the server: not while running, not with nothing", () => {
  expect(discardGate(null).enabled).toBe(false);
  expect(discardGate(noPreview()).reason).toBe("There is no preview to discard.");
  for (const status of ["processing", "processed", "sending"] as const) {
    expect(discardGate(preview({ status })).reason).toBe("A running preview cannot be discarded. Wait for it to finish.");
  }
  for (const status of ["done", "failed", "interrupted"] as const) expect(discardGate(preview({ status })).enabled).toBe(true);
  expect(DISCARD_CONFIRM.tone).toBe("love");
});

test("expiryLine writes the UTC day and never a blank", () => {
  expect(expiryLine(preview())).toBe("Expires on 1 Feb 2027 (UTC).");
  expect(expiryLine(noPreview())).toBeNull();
});

test("wouldSkipLine is withheld until a member is built", () => {
  expect(wouldSkipLine(noPreview())).toBeNull();
  expect(wouldSkipLine(preview({ status: "processing", done: 0, wouldSkip: 0 }))).toBeNull();
  expect(wouldSkipLine(preview())).toBe("1 of the 3 processed members has not opted in. The real run would not DM that member.");
  expect(wouldSkipLine(preview({ status: "processing", done: 2, wouldSkip: 2 }))).toContain("have not opted in so far");
  expect(wouldSkipLine(preview({ wouldSkip: 0 }))).toBe("Every processed member has opted in. The real run would DM them all.");
});

test("skippedMembers lists the sampled members the real run would not DM", () => {
  expect(skippedMembers(preview()).map((m) => m.userId)).toEqual(["2"]);
  expect(skippedMembers(noPreview())).toEqual([]);
});

test("preview links are the dashboard origin plus the story paths", () => {
  expect(previewLinkUrl("https://asuka.example/", "t1")).toBe("https://asuka.example/wrapped/t1");
  expect(previewServerUrl("https://asuka.example", "srv")).toBe("https://asuka.example/wrapped/s/srv");
});

test("startOutcome words every result", () => {
  expect(startOutcome({ result: "started", status: preview() }, null).bad).toBe(false);
  expect(startOutcome({ result: "already-running", status: preview() }, "Conflict").text).toBe(
    "Your preview is running already.",
  );
  expect(startOutcome({ result: "invalid", error: "member ids must be numbers", status: noPreview() }, "Bad Request").text).toBe(
    "The server refused the list: member ids must be numbers.",
  );
  expect(startOutcome(null, "year must be a whole number from 2015 to 2100")).toEqual({
    text: "That did not start: year must be a whole number from 2015 to 2100.",
    bad: true,
  });
});

test("discardOutcome words every result", () => {
  expect(discardOutcome("discarded", null).bad).toBe(false);
  expect(discardOutcome("nothing", null).text).toBe("There was no preview to discard.");
  expect(discardOutcome("running", "Conflict").bad).toBe(true);
  expect(discardOutcome(null, "offline").text).toBe("That did not work: offline.");
});

test("pollInterval goes fast while a preview runs, one loop for all three", () => {
  expect(pollInterval(run({ status: "done" }), backfill({ status: "done" }), false, preview())).toBe(SLOW_POLL_MS);
  expect(pollInterval(run({ status: "done" }), backfill(), false, preview({ status: "processing" }))).toBe(FAST_POLL_MS);
  expect(pollInterval(run(), backfill(), false, preview({ status: "processed" }))).toBe(FAST_POLL_MS);
  expect(pollInterval(run(), backfill(), false, preview({ status: "sending" }))).toBe(FAST_POLL_MS);
  expect(pollInterval(run(), backfill(), false, noPreview())).toBe(SLOW_POLL_MS);
  expect(pollInterval(run(), backfill())).toBe(SLOW_POLL_MS);
});
