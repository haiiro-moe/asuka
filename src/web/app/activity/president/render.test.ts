import { expect, test } from "bun:test";
import {
  OFF_VALUE,
  countTile,
  groupBars,
  groupsLeftOut,
  hiddenNote,
  seriesView,
  CLUB_HIDDEN_NOTE,
  ATTENDANCE_HIDDEN_NOTE,
  clubTiles,
  engagementView,
  oneDecimal,
  periodLabel,
} from "./render.ts";
import type { PresidentClubEventHealth, PresidentEngagement } from "../../../../plugins/activity/types/president.ts";

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

const eng = (o: Partial<PresidentEngagement> = {}): PresidentEngagement => ({ messages: 120, activeMembers: 14, voiceHours: 36.5, ...o });
const club = (o: Partial<PresidentClubEventHealth> = {}): PresidentClubEventHealth => ({
  clubsActive: 5,
  clubsQuiet: 3,
  eventsHeld: 4,
  avgAttendance: 6.5,
  ...o,
});

test("period labels", () => {
  expect(periodLabel("week")).toBe("the last 7 days");
  expect(periodLabel("term")).toBe("this term");
});

test("oneDecimal keeps a real 0 and rounds to one place", () => {
  expect(oneDecimal(0)).toBe("0");
  expect(oneDecimal(6.25)).toBe("6.3");
  expect(oneDecimal(1200)).toBe("1,200");
});

test("engagement: real numbers are shown", () => {
  const v = engagementView(eng(), "week");
  expect(v.voiceLocked).toBe(false);
  expect(v.tiles.map((t) => [t.label, t.value, t.off])).toEqual([
    ["messages", "120", undefined],
    ["active members", "14", undefined],
    ["voice hours", "36.5", undefined],
  ]);
});

test("engagement: real zeros stay 0", () => {
  const v = engagementView(eng({ messages: 0, activeMembers: 0, voiceHours: 0 }), "term");
  expect(v.voiceLocked).toBe(false);
  expect(v.tiles.map((t) => t.value)).toEqual(["0", "0", "0"]);
  expect(v.tiles.some((t) => t.off)).toBe(false);
});

test("engagement: null active members is off, null voice is locked and has no tile", () => {
  const v = engagementView(eng({ activeMembers: null, voiceHours: null }), "week");
  expect(v.voiceLocked).toBe(true);
  expect(v.tiles).toHaveLength(2);
  expect(v.tiles[1]).toMatchObject({ label: "active members", value: OFF_VALUE, off: true });
  expect(v.tiles.some((t) => t.value === "0")).toBe(false);
});

test("clubs: real numbers", () => {
  const t = clubTiles(club(), "week");
  expect(t.map((x) => [x.label, x.value, x.unit])).toEqual([
    ["clubs active", "5", undefined],
    ["clubs quiet", "3", undefined],
    ["events held", "4", undefined],
    ["average attendance", "6.5", "per event"],
  ]);
});

test("clubs: real zeros stay 0, with the unit on attendance", () => {
  const t = clubTiles(club({ clubsActive: 0, clubsQuiet: 0, eventsHeld: 0, avgAttendance: 0 }), "term");
  expect(t.map((x) => x.value)).toEqual(["0", "0", "0", "0"]);
  expect(t[3]!.unit).toBe("per event");
  expect(t.some((x) => x.off)).toBe(false);
});

test("clubs: null counts are an off pair with the small-counts note", () => {
  const t = clubTiles(club({ clubsActive: null, clubsQuiet: null }), "week");
  for (const x of t.slice(0, 2)) {
    expect(x).toMatchObject({ value: OFF_VALUE, off: true, note: CLUB_HIDDEN_NOTE });
    expect(x.unit).toBeUndefined();
  }
  expect(t[2]!.value).toBe("4");
});

test("clubs: null attendance is off with a privacy note and no unit", () => {
  const t = clubTiles(club({ avgAttendance: null }), "week");
  expect(t[3]).toEqual({ label: "average attendance", value: OFF_VALUE, note: ATTENDANCE_HIDDEN_NOTE, off: true });
});
