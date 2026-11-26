import { expect, test } from "bun:test";
import {
  OFF_VALUE,
  countTile,
  formatUtcDate,
  groupBars,
  groupsLeftOut,
  hiddenNote,
  seriesView,
  totalUnit,
  voiceLockedLine,
} from "./render.ts";

test("a null count is an off tile and never 0", () => {
  const t = countTile("bridges", null, { period: "week", unit: "of 9", note: "x" });
  expect(t.off).toBe(true);
  expect(t.value).toBe(OFF_VALUE);
  expect(t.value).not.toBe("0");
  expect(t.unit).toBeUndefined();
  expect(t.note).toBe(hiddenNote("week"));
});

test("a real 0 is shown as 0, not hidden", () => {
  const t = countTile("gone quiet", 0, { period: "week" });
  expect(t.off).toBeUndefined();
  expect(t.value).toBe("0");
});

test("a number keeps its unit and note", () => {
  const t = countTile("in groups", 11, { period: "term", unit: "of 14", note: "n" });
  expect(t).toEqual({ label: "in groups", value: "11", unit: "of 14", note: "n", off: undefined });
});

test("a non-finite count is treated as hidden", () => {
  expect(countTile("x", Number.NaN, { period: "week" }).off).toBe(true);
});

test("the term note also names the closeness rule", () => {
  expect(hiddenNote("term")).toContain("too close");
  expect(hiddenNote("week")).not.toContain("too close");
});

test("of N only when the total is shown", () => {
  expect(totalUnit(14)).toBe("of 14");
  expect(totalUnit(0)).toBe("of 0");
  expect(totalUnit(null)).toBeUndefined();
});

test("a null series is hidden, an empty one is empty, a list of zeros is columns", () => {
  expect(seriesView(null)).toEqual({ kind: "hidden" });
  expect(seriesView([])).toEqual({ kind: "empty" });
  expect(seriesView([0, 0])).toEqual({ kind: "columns", values: [0, 0], latest: 0 });
  expect(seriesView([3, 5.5])).toEqual({ kind: "columns", values: [3, 5.5], latest: 5.5 });
});

test("the other row appears only when other is a number", () => {
  expect(groupBars([7, 4], null).map((b) => b.label)).toEqual(["group of 7", "group of 4"]);
  expect(groupBars([7], 0).map((b) => b.label)).toEqual(["group of 7", "other"]);
  expect(groupBars([], 5)).toEqual([{ label: "other", value: 5, sub: "outside groups" }]);
});

test("groups left out only when the count exceeds the list", () => {
  expect(groupsLeftOut(3, 2)).toBe(true);
  expect(groupsLeftOut(2, 2)).toBe(false);
  expect(groupsLeftOut(null, 2)).toBe(false);
});

test("dates are UTC and day-month-year", () => {
  expect(formatUtcDate(Date.UTC(2027, 1, 1) / 1000)).toBe("1 Feb 2027");
  expect(formatUtcDate(Date.UTC(2027, 8, 30, 23, 59) / 1000)).toBe("30 Sep 2027");
  expect(formatUtcDate(null)).toBeNull();
});

test("the voice line names the date, or falls back without one", () => {
  expect(voiceLockedLine(Date.UTC(2027, 1, 1) / 1000)).toBe("voice stats unlock on 1 Feb 2027.");
  expect(voiceLockedLine(null)).toContain("two whole months");
});
