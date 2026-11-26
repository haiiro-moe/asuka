import { expect, test } from "bun:test";
import { formatUtcDate, voiceLockedLine } from "./format.ts";

test("formatUtcDate writes the house style in UTC with fixed abbreviations", () => {
  expect(formatUtcDate(Date.UTC(2027, 1, 1) / 1000)).toBe("1 Feb 2027");
  expect(formatUtcDate(Date.UTC(2027, 8, 1) / 1000)).toBe("1 Sep 2027");
  // 23:30 UTC on the 31st stays the 31st whatever the local zone is
  expect(formatUtcDate(Date.UTC(2027, 0, 31, 23, 30) / 1000)).toBe("31 Jan 2027");
  expect(formatUtcDate(Date.UTC(2027, 1, 1) / 1000, false)).toBe("1 Feb");
});

test("formatUtcDate gives an empty string for no date", () => {
  expect(formatUtcDate(null)).toBe("");
  expect(formatUtcDate(undefined)).toBe("");
  expect(formatUtcDate(Number.NaN)).toBe("");
});

test("voiceLockedLine names the date, or says what is missing", () => {
  expect(voiceLockedLine(Date.UTC(2027, 1, 1) / 1000)).toBe("voice stats unlock on 1 Feb 2027.");
  expect(voiceLockedLine(null)).toContain("two whole months");
  expect(voiceLockedLine(undefined)).toContain("two whole months");
});

test("the last second of a month stays in that month", () => {
  expect(formatUtcDate(Date.UTC(2026, 8, 30, 23, 59, 59) / 1000)).toBe("30 Sep 2026");
});
