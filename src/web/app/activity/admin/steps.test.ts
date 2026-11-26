import { expect, test } from "bun:test";
import { backfill, run } from "./fixtures.ts";
import {
  announceGate,
  backfillAction,
  parseYearInput,
  processGate,
  resumeGate,
  sendGate,
  serverLinkReady,
} from "./steps.ts";

test("parseYearInput accepts four-digit years in range only", () => {
  expect(parseYearInput("2026")).toBe(2026);
  expect(parseYearInput(" 2026 ")).toBe(2026);
  expect(parseYearInput("2014")).toBeNull();
  expect(parseYearInput("2101")).toBeNull();
  expect(parseYearInput("20.6")).toBeNull();
  expect(parseYearInput("")).toBeNull();
});

test("processGate refuses while a run works or the year is bad", () => {
  expect(processGate(null, 2026).enabled).toBe(false);
  expect(processGate(run({ status: "processing" }), 2026).enabled).toBe(false);
  expect(processGate(run({ status: "sending" }), 2026).enabled).toBe(false);
  expect(processGate(run({ status: "idle" }), null).reason).toContain("whole year");
  for (const status of ["idle", "processed", "done", "failed", "interrupted"] as const) {
    expect(processGate(run({ status }), 2026)).toEqual({ enabled: true, reason: null });
  }
});

test("sendGate opens once processed or done, or failed after full processing", () => {
  expect(sendGate(run({ status: "idle" })).reason).toBe("process a year first.");
  expect(sendGate(run({ status: "processing" })).enabled).toBe(false);
  expect(sendGate(run({ status: "sending" })).enabled).toBe(false);
  expect(sendGate(run({ status: "interrupted" })).reason).toContain("resume");
  expect(sendGate(run({ status: "processed", processed: 40 })).enabled).toBe(true);
  expect(sendGate(run({ status: "done", processed: 40 })).enabled).toBe(true);
  expect(sendGate(run({ status: "failed", processed: 40 })).enabled).toBe(true);
  expect(sendGate(run({ status: "failed", processed: 12 })).enabled).toBe(false);
});

test("announceGate opens once processed or done and only once a year", () => {
  expect(announceGate(run({ status: "idle" })).enabled).toBe(false);
  expect(announceGate(run({ status: "processing" })).enabled).toBe(false);
  expect(announceGate(run({ status: "sending" })).reason).toContain("dms");
  expect(announceGate(run({ status: "processed" })).enabled).toBe(true);
  expect(announceGate(run({ status: "done" })).enabled).toBe(true);
  expect(announceGate(run({ status: "failed" })).enabled).toBe(false);
  const posted = announceGate(run({ status: "done", announcedAt: Date.UTC(2026, 11, 20) / 1000 }));
  expect(posted).toEqual({ enabled: false, reason: "posted on 20 Dec 2026." });
});

test("resumeGate opens only for an interrupted run", () => {
  expect(resumeGate(run({ status: "interrupted" })).enabled).toBe(true);
  expect(resumeGate(run({ status: "failed" })).enabled).toBe(false);
  expect(resumeGate(null).enabled).toBe(false);
});

test("serverLinkReady waits for processing to build the server wrapped", () => {
  expect(serverLinkReady(run({ status: "idle" }))).toBe(false);
  expect(serverLinkReady(run({ status: "processing" }))).toBe(false);
  expect(serverLinkReady(run({ status: "processed" }))).toBe(true);
  expect(serverLinkReady(run({ status: "done" }))).toBe(true);
  expect(serverLinkReady(run({ status: "failed", announcedAt: 5 }))).toBe(true);
});

test("backfillAction names the main button for each state", () => {
  expect(backfillAction(backfill({ status: "idle" }))).toBe("start");
  expect(backfillAction(backfill({ status: "stopped" }))).toBe("resume");
  expect(backfillAction(backfill({ status: "done" }))).toBe("run again");
  expect(backfillAction(backfill({ status: "failed" }))).toBe("run again");
  expect(backfillAction(backfill({ status: "running" }))).toBeNull();
});
