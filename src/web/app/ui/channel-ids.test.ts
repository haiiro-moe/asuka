import { expect, test } from "bun:test";
import {
  ACTIVITY_KINDS,
  CATEGORY_KINDS,
  POSTABLE_KINDS,
  channelChoices,
  channelLabel,
  chosenChannels,
  joinIdList,
  orderRoles,
  parseIdList,
  roleHex,
  withNoneAndUnknown,
  type GuildChannel,
  type GuildRole,
} from "./channel-ids.ts";

const ch = (id: string, name: string, kind: GuildChannel["kind"], parentName: string | null = null): GuildChannel => ({
  id,
  name,
  kind,
  parentId: parentName ? "p" : null,
  parentName,
  position: 0,
});

const channels = [
  ch("1", "info", "category"),
  ch("2", "general", "text", "info"),
  ch("3", "news", "announcement", "info"),
  ch("4", "lounge", "voice", "info"),
  ch("5", "stage", "stage"),
  ch("6", "art", "forum"),
];

test("parseIdList trims, drops blanks and repeats, keeps order", () => {
  expect(parseIdList("1, 2 ,,3,2, 1")).toEqual(["1", "2", "3"]);
  expect(parseIdList("")).toEqual([]);
  expect(parseIdList(null)).toEqual([]);
  expect(parseIdList(undefined)).toEqual([]);
  expect(parseIdList("  ,  ")).toEqual([]);
});

test("joinIdList writes the canonical a,b,c form", () => {
  expect(joinIdList(["1", " 2 ", "", "1", "3"])).toBe("1,2,3");
  expect(joinIdList([])).toBe("");
  expect(joinIdList(parseIdList(" 7 , 8 ,"))).toBe("7,8");
});

test("channelLabel marks text with # and the rest with a word", () => {
  expect(channelLabel(channels[1]!)).toBe("# general");
  expect(channelLabel(channels[2]!)).toBe("# news");
  expect(channelLabel(channels[3]!)).toBe("lounge (voice)");
  expect(channelLabel(channels[4]!)).toBe("stage (stage)");
  expect(channelLabel(channels[5]!)).toBe("art (forum)");
  expect(channelLabel(channels[0]!)).toBe("info");
});

test("channelChoices filters by kind and carries the category as meta", () => {
  expect(channelChoices(channels, POSTABLE_KINDS)).toEqual([
    { value: "2", label: "# general", meta: "info" },
    { value: "3", label: "# news", meta: "info" },
  ]);
  expect(channelChoices(channels, CATEGORY_KINDS).map((o) => o.value)).toEqual(["1"]);
  expect(channelChoices(channels, ACTIVITY_KINDS).map((o) => o.value)).toEqual(["2", "3", "4", "5", "6"]);
  expect(channelChoices(channels, ACTIVITY_KINDS, new Set(["2", "4"])).map((o) => o.value)).toEqual(["3", "5", "6"]);
});

test("withNoneAndUnknown puts none first and keeps an id that is not listed", () => {
  const choices = channelChoices(channels, POSTABLE_KINDS);
  expect(withNoneAndUnknown(choices, "2").map((o) => o.value)).toEqual(["", "2", "3"]);
  expect(withNoneAndUnknown(choices, "").map((o) => o.value)).toEqual(["", "2", "3"]);
  expect(withNoneAndUnknown(choices, null).map((o) => o.value)).toEqual(["", "2", "3"]);
  const withGone = withNoneAndUnknown(choices, "999");
  expect(withGone.map((o) => o.value)).toEqual(["", "999", "2", "3"]);
  expect(withGone[1]!.label).toBe("unknown · 999");
  // an id of a kind the picker does not offer is also unknown, never dropped
  expect(withNoneAndUnknown(choices, "4")[1]!.label).toBe("unknown · 4");
});

test("chosenChannels keeps saved order and marks unknown ids", () => {
  const out = chosenChannels(["4", "999", "2", "1"], channels, ACTIVITY_KINDS);
  expect(out).toEqual([
    { id: "4", label: "lounge (voice)", unknown: false },
    { id: "999", label: "unknown · 999", unknown: true },
    { id: "2", label: "# general", unknown: false },
    { id: "1", label: "unknown · 1", unknown: true },
  ]);
});

test("orderRoles moves managed roles last without reordering the rest", () => {
  const role = (id: string, managed: boolean): GuildRole => ({ id, name: id, colour: 0, position: 0, managed });
  const out = orderRoles([role("a", false), role("b", true), role("c", false), role("d", true)]);
  expect(out.map((r) => r.id)).toEqual(["a", "c", "b", "d"]);
});

test("roleHex gives #rrggbb and nothing for no colour", () => {
  expect(roleHex(0x31748f)).toBe("#31748f");
  expect(roleHex(0xff)).toBe("#0000ff");
  expect(roleHex(0)).toBeUndefined();
});
