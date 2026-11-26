import { expect, test } from "bun:test";
import {
  WEEK_SEC,
  axisLabels,
  channelLabel,
  formatDuration,
  formatReplyTime,
  formatUtcDay,
  formatVoiceHours,
  steppedPercent,
  voiceUnlockLine,
  weekLabels,
} from "./format.ts";

const FEB_1_2027 = Date.UTC(2027, 1, 1) / 1000;
const SEP_30_2026 = Date.UTC(2026, 8, 30, 23, 59, 59) / 1000;

test("formatUtcDay writes the house style in UTC", () => {
  expect(formatUtcDay(FEB_1_2027)).toBe("1 Feb 2027");
  expect(formatUtcDay(SEP_30_2026)).toBe("30 Sep 2026");
  expect(formatUtcDay(FEB_1_2027, false)).toBe("1 Feb");
  expect(formatUtcDay(Number.NaN)).toBe("");
});

test("weekLabels counts 7-day buckets from the explicit start", () => {
  const start = Date.UTC(2026, 10, 2) / 1000;
  expect(weekLabels(start, 3)).toEqual(["2 Nov", "9 Nov", "16 Nov"]);
  expect(weekLabels(start, 0)).toEqual([]);
  expect(weekLabels(start + WEEK_SEC, 1)).toEqual(["9 Nov"]);
});

test("weekLabels crosses a year boundary", () => {
  const start = Date.UTC(2026, 11, 28) / 1000;
  expect(weekLabels(start, 2)).toEqual(["28 Dec", "4 Jan"]);
});

test("axisLabels keeps the ends and spreads the rest", () => {
  expect(axisLabels(["a", "b"])).toEqual(["a", "b"]);
  expect(axisLabels(["a", "b", "c", "d", "e", "f", "g"], 4)).toEqual(["a", "c", "e", "g"]);
  expect(axisLabels(["a", "b", "c"], 2)).toEqual(["a", "c"]);
});

test("formatDuration uses the largest two units", () => {
  expect(formatDuration(0)).toBe("0s");
  expect(formatDuration(45)).toBe("45s");
  expect(formatDuration(192)).toBe("3m 12s");
  expect(formatDuration(3720)).toBe("1h 02m");
  expect(formatDuration(2 * 86400 + 4 * 3600)).toBe("2d 4h");
  expect(formatDuration(-5)).toBe("0s");
});

test("formatReplyTime says when nothing was answered", () => {
  expect(formatReplyTime(null)).toBe("none answered");
  expect(formatReplyTime(90)).toBe("1m 30s");
});

test("formatVoiceHours rounds to one decimal", () => {
  expect(formatVoiceHours(5400)).toBe("1.5h");
  expect(formatVoiceHours(0)).toBe("0h");
});

test("channelLabel names channels and threads, falling back to ids", () => {
  expect(channelLabel({ channelId: "1", parentChannelId: null, name: "general", parentName: null })).toEqual({
    name: "#general",
    note: null,
  });
  expect(channelLabel({ channelId: "2", parentChannelId: "1", name: "plans", parentName: "general" })).toEqual({
    name: "#plans",
    note: "thread in #general",
  });
  expect(channelLabel({ channelId: "2", parentChannelId: "1", name: null, parentName: null })).toEqual({
    name: "2",
    note: "thread in 1",
  });
});

test("steppedPercent moves in whole steps and never overshoots", () => {
  expect(steppedPercent(0, 10)).toBe(0);
  expect(steppedPercent(1, 0)).toBe(0);
  expect(steppedPercent(1, 3)).toBe(30);
  expect(steppedPercent(29, 30)).toBe(95);
  expect(steppedPercent(30, 30)).toBe(100);
  expect(steppedPercent(40, 30)).toBe(100);
  expect(steppedPercent(1, 4, 4)).toBe(25);
});

test("voiceUnlockLine gives the UTC date or a dateless line", () => {
  expect(voiceUnlockLine({ ready: false, readyAt: FEB_1_2027 })).toBe("Voice stats unlock on 1 Feb 2027.");
  expect(voiceUnlockLine({ ready: false, readyAt: null })).toContain("two whole months");
});
