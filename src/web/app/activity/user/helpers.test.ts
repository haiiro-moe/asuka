import { expect, test } from "bun:test";
import {
  activityPath,
  awardText,
  dayTotals,
  hourTotals,
  peakIndex,
  roundHeatmap,
  channelLabel,
  emojiLabel,
  formatDuration,
  heatmapIsEmpty,
  summariseSharing,
  toHours,
  PERIODS,
  PERIOD_LABELS,
  graveyardLabel,
  reactedChannel,
} from "./helpers.ts";

test("activityPath adds the period only when given", () => {
  expect(activityPath("rhythm", "term")).toBe("/api/activity/user/rhythm?period=term");
  expect(activityPath("voice-status")).toBe("/api/activity/user/voice-status");
});

test("formatDuration and toHours", () => {
  expect(formatDuration(0)).toBe("0s");
  expect(formatDuration(30)).toBe("30s");
  expect(formatDuration(42 * 60)).toBe("42m");
  expect(formatDuration(3 * 3600 + 5 * 60)).toBe("3h 05m");
  expect(formatDuration(-5)).toBe("0s");
  expect(toHours(5400)).toBe(1.5);
});

test("emojiLabel keeps unicode and names custom emoji", () => {
  expect(emojiLabel("🔥", null)).toBe("🔥");
  expect(emojiLabel("custom:123", "kek")).toBe(":kek:");
  expect(emojiLabel("custom:123", null)).toBe("custom 123");
});

test("channelLabel falls back to ids and labels threads", () => {
  expect(channelLabel({ channelId: "1", parentChannelId: null, count: 3, name: "general", parentName: null })).toEqual({
    label: "#general",
  });
  expect(channelLabel({ channelId: "2", parentChannelId: "1", count: 3, name: "plans", parentName: "general" })).toEqual({
    label: "#plans",
    sub: "thread in #general",
  });
  expect(channelLabel({ channelId: "2", parentChannelId: "1", count: 3, name: null, parentName: null })).toEqual({
    label: "#2",
    sub: "thread in #1",
  });
});

test("summariseSharing totals kinds and sorts link domains", () => {
  const s = summariseSharing([
    { kind: "link", label: "a.com", count: 2 },
    { kind: "link", label: "b.com", count: 5 },
    { kind: "image", label: "image", count: 7 },
  ]);
  expect(s.totals.find((t) => t.kind === "link")?.count).toBe(7);
  expect(s.totals.find((t) => t.kind === "video")?.count).toBe(0);
  expect(s.links.map((l) => l.label)).toEqual(["b.com", "a.com"]);
});

test("heatmapIsEmpty", () => {
  expect(heatmapIsEmpty([[0, 0], [0]])).toBe(true);
  expect(heatmapIsEmpty([[0, 1]])).toBe(false);
});

test("hourTotals, dayTotals and peakIndex", () => {
  const cells = [
    [1, 0, 2],
    [0, 3, 2],
  ];
  expect(hourTotals(cells).slice(0, 3)).toEqual([1, 3, 4]);
  expect(hourTotals(cells)).toHaveLength(24);
  expect(dayTotals(cells)).toEqual([3, 5]);
  expect(peakIndex([0, 4, 4, 1])).toBe(1);
  expect(peakIndex([0, 0])).toBeNull();
});

test("roundHeatmap shortens fractional hours", () => {
  expect(roundHeatmap({ cells: [[0.123456, 2]], max: 2.0004 })).toEqual({ cells: [[0.12, 2]], max: 2 });
});

test("awardText words every award", () => {
  expect(awardText({ key: "night-owl", userId: "1", value: 1200 }).tail).toBe("sent 1,200 messages between 00:00 and 05:00 utc.");
  expect(awardText({ key: "longest-voice", userId: "1", value: 7500 }).tail).toContain("2h 05m");
  expect(awardText({ key: "fastest-replier", userId: "1", value: 42 }).tail).toContain("42s");
  expect(awardText({ key: "most-replied-to", userId: "1", value: 3 }).title).toBe("most replied to");
  expect(awardText({ key: "earliest-bird", userId: "1", value: 3 }).title).toBe("earliest bird");
});

test("graveyardLabel shows the name, never the id", () => {
  expect(graveyardLabel({ id: "123456789012345678", name: "blobwave" })).toBe(":blobwave:");
  expect(graveyardLabel({ id: "123456789012345678", name: null })).toBe("a custom emoji");
});

test("reactedChannel names the channel and a thread's parent, never an id", () => {
  const base = { messageId: "1", channelId: "222222222222222222", parentChannelId: null, authorId: null, net: 3 };
  expect(reactedChannel({ ...base, channelName: "general", parentChannelName: null })).toEqual({ label: "#general" });
  expect(reactedChannel({ ...base, channelName: null, parentChannelName: null })).toEqual({ label: "a channel" });
  const thread = { ...base, parentChannelId: "333333333333333333" };
  expect(reactedChannel({ ...thread, channelName: "movie night", parentChannelName: "events" })).toEqual({
    label: "#movie night",
    sub: "thread in #events",
  });
  expect(reactedChannel({ ...thread, channelName: null, parentChannelName: null })).toEqual({
    label: "a channel",
    sub: "thread in a channel",
  });
});

test("the period control says last 365 days for year", () => {
  expect(PERIOD_LABELS.year).toBe("last 365 days");
  expect(PERIODS.map((p) => PERIOD_LABELS[p])).toEqual(["last 30 days", "this term", "last 365 days"]);
});
