import { expect, test } from "bun:test";
import { columnsAriaLabel, formatUtcDate, heatmapAriaLabel, hourName, voiceLockedLine, weekName } from "./format.ts";

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

test("heatmapAriaLabel names the busiest cell", () => {
  const cells = [new Array(24).fill(0), new Array(24).fill(0)];
  expect(heatmapAriaLabel("messages by weekday and hour, utc", ["mon", "tue"], cells)).toBe(
    "messages by weekday and hour, utc; nothing counted",
  );
  cells[1]![21] = 9;
  cells[0]![3] = 9;
  cells[1]![5] = 12;
  expect(heatmapAriaLabel("messages by weekday and hour, utc", ["mon", "tue"], cells)).toBe(
    "messages by weekday and hour, utc; busiest tue 05:00",
  );
});

test("columnsAriaLabel names the highest column and, for a series, the latest", () => {
  expect(columnsAriaLabel("messages by hour of day, utc", [0, 0], hourName)).toBe("messages by hour of day, utc; nothing counted");
  expect(columnsAriaLabel("messages by hour of day, utc", [1, 7, 7, 2], hourName)).toBe(
    "messages by hour of day, utc; highest 01:00 at 7",
  );
  expect(columnsAriaLabel("voice hours per week", [1.25, 3.5, 2], (i) => `week ${i + 1}`, true)).toBe(
    "voice hours per week; highest week 2 at 3.5, latest 2",
  );
});

test("weekName says the latest week or its place", () => {
  expect(weekName(11, 12)).toBe("the latest week");
  expect(weekName(2, 12)).toBe("week 3 of 12");
});
