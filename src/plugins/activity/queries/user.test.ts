import { afterAll, beforeAll, beforeEach, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import type { ApiContext } from "../../../core/plugin.ts";
import { userRoutes } from "../api/user.ts";
import { db, initDb, schema } from "../../../db/index.ts";
import type { MessageFacts } from "../facts.ts";
import {
  closeVoiceSegment,
  openVoiceSegment,
  recordMessage,
  recordReactionAdd,
  recordReactionRemove,
} from "../record.ts";
import type { VoiceSnapshot } from "../record.ts";
import {
  awards,
  channelFavourites,
  emojiGraveyard,
  emojiLeaderboard,
  emojiTrend,
  mostReacted,
  rhythm,
  sharing,
  voiceFavourites,
} from "./user.ts";

/** Monday 2027-01-04 00:00 UTC. */
const MON = 1_799_020_800;
const H = 3600;
const ALL = { from: 0, to: MON + 365 * 86400 };

const tables = [
  schema.activityMessages,
  schema.activityMentions,
  schema.activityEmoji,
  schema.activityReactions,
  schema.activityVoice,
];

function setExcluded(list: string) {
  db.update(schema.guildConfig)
    .set({ activityExcludedChannelIds: list })
    .where(eq(schema.guildConfig.id, 1))
    .run();
}

function reset() {
  for (const t of tables) db.delete(t).run();
  setExcluded("");
}

let seq = 0;
function msg(over: Partial<MessageFacts> = {}): MessageFacts {
  seq++;
  return {
    messageId: `m${seq}`,
    userId: "u1",
    channelId: "c1",
    parentChannelId: null,
    ts: MON + 14 * H,
    replyToUserId: null,
    replyToMessageId: null,
    mentionedUserIds: [],
    attachmentKinds: [],
    linkDomains: [],
    stickerCount: 0,
    length: 5,
    emoji: [],
    source: "live",
    ...over,
  };
}

function react(over: Partial<Parameters<typeof recordReactionAdd>[0]> = {}) {
  recordReactionAdd({
    messageId: "m1",
    userId: "u2",
    emoji: "🙂",
    name: null,
    channelId: "c1",
    messageAuthorId: "u1",
    ts: MON + H,
    ...over,
  });
}

const snap = (channelId = "v1"): VoiceSnapshot => ({
  channelId,
  muted: false,
  deafened: false,
  streaming: false,
  video: false,
});

/** A closed voice segment of `user` in `channel` from `start` for `secs`. */
function talk(user: string, channel: string, start: number, secs: number) {
  openVoiceSegment(user, snap(channel), start);
  closeVoiceSegment(user, start + secs);
}

beforeAll(() => initDb());
beforeEach(reset);
afterAll(reset);

test("empty database gives empty views and a zero heatmap", () => {
  const r = rhythm(ALL);
  expect(r.messages.max).toBe(0);
  expect(r.messages.cells.length).toBe(7);
  expect(r.messages.cells[0]!.length).toBe(24);
  expect(r.voice.max).toBe(0);
  expect(emojiLeaderboard(ALL)).toEqual([]);
  expect(emojiTrend(ALL)).toEqual([]);
  expect(emojiGraveyard([])).toEqual([]);
  expect(mostReacted(ALL)).toEqual([]);
  expect(channelFavourites(ALL)).toEqual([]);
  expect(voiceFavourites(ALL)).toEqual([]);
  expect(sharing(ALL)).toEqual([]);
  expect(awards(ALL)).toEqual([]);
});

test("rhythm puts a Monday 14:00 UTC message in cells[0][14]", () => {
  recordMessage(msg());
  const r = rhythm(ALL);
  expect(r.messages.cells[0]![14]).toBe(1);
  expect(r.messages.max).toBe(1);
});

test("rhythm spreads a two-hour voice segment over both hours", () => {
  talk("u1", "v1", MON + 14 * H, 2 * H);
  const r = rhythm(ALL);
  expect(r.voice.cells[0]![14]).toBe(1);
  expect(r.voice.cells[0]![15]).toBe(1);
  expect(r.voice.cells[0]![16]).toBe(0);
});

test("emojiLeaderboard merges text and net reaction use", () => {
  recordMessage(msg({ messageId: "t1", emoji: [{ emoji: "🙂", name: null, count: 2 }] }));
  recordMessage(msg({ messageId: "t2", emoji: [{ emoji: "custom:9", name: "wow", count: 1 }] }));
  react({ messageId: "t1", userId: "a" });
  react({ messageId: "t1", userId: "b" });
  react({ messageId: "t1", userId: "c" });
  recordReactionRemove("t1", "c", "🙂", MON + 2 * H);
  const rows = emojiLeaderboard(ALL);
  expect(rows[0]).toEqual({ emoji: "🙂", name: null, count: 4 });
  expect(rows[1]).toEqual({ emoji: "custom:9", name: "wow", count: 1 });
  expect(emojiLeaderboard(ALL, 1).length).toBe(1);
});

test("emojiTrend buckets weekly for the top emoji", () => {
  const p = { from: MON, to: MON + 14 * 86400 };
  recordMessage(msg({ ts: MON + H, emoji: [{ emoji: "🙂", name: null, count: 1 }] }));
  recordMessage(msg({ ts: MON + 8 * 86400, emoji: [{ emoji: "🙂", name: null, count: 3 }] }));
  expect(emojiTrend(p, 5)).toEqual([{ emoji: "🙂", name: null, weekly: [1, 3] }]);
});

test("emojiGraveyard returns custom ids never used", () => {
  recordMessage(msg({ emoji: [{ emoji: "custom:1", name: "a", count: 1 }] }));
  react({ emoji: "custom:3", name: "c" });
  expect(emojiGraveyard(["1", "2", "3"])).toEqual([{ id: "2" }]);
});

test("mostReacted uses net reactions", () => {
  recordMessage(msg({ messageId: "r1" }));
  recordMessage(msg({ messageId: "r2" }));
  react({ messageId: "r1", userId: "a" });
  react({ messageId: "r1", userId: "b" });
  recordReactionRemove("r1", "b", "🙂", MON + 2 * H);
  react({ messageId: "r2", userId: "a" });
  react({ messageId: "r2", userId: "b" });
  expect(mostReacted(ALL)).toEqual([
    { messageId: "r2", channelId: "c1", authorId: "u1", net: 2 },
    { messageId: "r1", channelId: "c1", authorId: "u1", net: 1 },
  ]);
});

test("channelFavourites ranks threads as channels; voiceFavourites sums seconds", () => {
  recordMessage(msg({ channelId: "c1" }));
  recordMessage(msg({ channelId: "t9", parentChannelId: "c1" }));
  recordMessage(msg({ channelId: "t9", parentChannelId: "c1" }));
  recordMessage(msg({ channelId: "c2" }));
  expect(channelFavourites(ALL)).toEqual([
    { channelId: "t9", parentChannelId: "c1", count: 2 },
    { channelId: "c1", parentChannelId: null, count: 1 },
    { channelId: "c2", parentChannelId: null, count: 1 },
  ]);
  talk("u1", "v1", MON, 600);
  expect(voiceFavourites(ALL)).toEqual([{ channelId: "v1", parentChannelId: null, count: 600 }]);
});

test("a thread under an excluded parent is not ranked", () => {
  recordMessage(msg({ channelId: "t9", parentChannelId: "c9" }));
  recordMessage(msg({ channelId: "c1" }));
  setExcluded("c9");
  expect(channelFavourites(ALL)).toEqual([{ channelId: "c1", parentChannelId: null, count: 1 }]);
});

test("the channels route adds names from the guild channel cache", async () => {
  const recent = Math.floor(Date.now() / 1000) - 100; // "all" ends at the real now
  recordMessage(msg({ channelId: "t9", parentChannelId: "c1", ts: recent }));
  recordMessage(msg({ channelId: "gone", ts: recent }));
  const cache = new Map([
    ["t9", { name: "side-quest" }],
    ["c1", { name: "general" }],
  ]);
  const ctx = {
    guildId: "g1",
    client: { guilds: { cache: new Map([["g1", { channels: { cache } }]]) } },
  } as unknown as ApiContext;
  const route = userRoutes.find((r) => r.path === "/api/activity/user/channels")!;
  const res = await route.handle(new Request("http://x/api/activity/user/channels?period=all"), ctx);
  expect(await res.json()).toEqual([
    { channelId: "gone", parentChannelId: null, count: 1, name: null, parentName: null },
    { channelId: "t9", parentChannelId: "c1", count: 1, name: "side-quest", parentName: "general" },
  ]);
});

test("sharing counts media kinds, links by domain, gifs and stickers", () => {
  recordMessage(msg({ attachmentKinds: ["image", "image", "video"], stickerCount: 1 }));
  recordMessage(msg({ linkDomains: ["example.com", "tenor.com"] }));
  recordMessage(msg({ linkDomains: ["example.com"] }));
  const rows = sharing(ALL);
  const get = (kind: string, label: string) => rows.find((r) => r.kind === kind && r.label === label)?.count;
  expect(get("image", "image")).toBe(2);
  expect(get("video", "video")).toBe(1);
  expect(get("sticker", "sticker")).toBe(1);
  expect(get("link", "example.com")).toBe(2);
  expect(get("gif", "tenor.com")).toBe(1);
});

test("awards: night owl, earliest bird, longest voice, repliers", () => {
  recordMessage(msg({ userId: "u1", ts: MON + 2 * H }));
  recordMessage(msg({ userId: "u1", ts: MON + 3 * H }));
  recordMessage(msg({ userId: "u2", ts: MON + 4 * H }));
  recordMessage(msg({ userId: "u3", ts: MON + 6 * H }));
  talk("u1", "v1", MON, 100);
  talk("u2", "v1", MON, 500);
  // u5 answers u4 ten times after 30s, u6 ten times after 300s, u7 only three times.
  for (let i = 0; i < 10; i++) {
    const t = MON + 10 * H + i * 1000;
    recordMessage(msg({ messageId: `p${i}`, userId: "u4", ts: t }));
    recordMessage(msg({ messageId: `a${i}`, userId: "u5", ts: t + 30, replyToMessageId: `p${i}`, replyToUserId: "u4" }));
    recordMessage(msg({ messageId: `b${i}`, userId: "u6", ts: t + 300, replyToMessageId: `p${i}`, replyToUserId: "u4" }));
  }
  for (let i = 0; i < 3; i++) {
    recordMessage(msg({ messageId: `c${i}`, userId: "u7", ts: MON + 10 * H + i * 1000 + 1, replyToMessageId: `p${i}`, replyToUserId: "u4" }));
  }
  // A reply whose parent was never recorded counts as replied-to but has no response time.
  recordMessage(msg({ userId: "u5", ts: MON + 11 * H, replyToMessageId: "unknown", replyToUserId: "u8" }));
  const by = Object.fromEntries(awards(ALL).map((x) => [x.key, x]));
  expect(by["night-owl"]).toEqual({ key: "night-owl", userId: "u1", value: 2 });
  expect(by["earliest-bird"]).toEqual({ key: "earliest-bird", userId: "u3", value: 1 });
  expect(by["longest-voice"]).toEqual({ key: "longest-voice", userId: "u2", value: 500 });
  expect(by["fastest-replier"]).toEqual({ key: "fastest-replier", userId: "u5", value: 30 });
  expect(by["most-replied-to"]).toEqual({ key: "most-replied-to", userId: "u4", value: 23 });
});

test("every query ignores an excluded channel and the threads under it", () => {
  recordMessage(msg({ messageId: "x1", channelId: "c9", ts: MON + 2 * H, attachmentKinds: ["image"], emoji: [{ emoji: "🙂", name: null, count: 1 }] }));
  recordMessage(msg({ messageId: "x2", channelId: "t9", parentChannelId: "c9", ts: MON + 2 * H, emoji: [{ emoji: "custom:5", name: "z", count: 1 }] }));
  react({ messageId: "x2", channelId: "t9", parentChannelId: "c9" });
  talk("u1", "v9", MON, 100);
  setExcluded("c9,v9");
  const r = rhythm(ALL);
  expect(r.messages.max).toBe(0);
  expect(r.voice.max).toBe(0);
  expect(emojiLeaderboard(ALL)).toEqual([]);
  expect(emojiTrend(ALL)).toEqual([]);
  expect(emojiGraveyard(["5"])).toEqual([{ id: "5" }]);
  expect(mostReacted(ALL)).toEqual([]);
  expect(channelFavourites(ALL)).toEqual([]);
  expect(voiceFavourites(ALL)).toEqual([]);
  expect(sharing(ALL)).toEqual([]);
  expect(awards(ALL)).toEqual([]);
});

test("rhythm buckets the Sunday/Monday boundary exactly", () => {
  recordMessage(msg({ ts: MON - 1 })); // Sunday 23:59:59
  recordMessage(msg({ ts: MON })); // Monday 00:00:00
  const c = rhythm(ALL).messages.cells;
  expect(c[6]![23]).toBe(1);
  expect(c[0]![0]).toBe(1);
  expect(c.flat().reduce((a, b) => a + b, 0)).toBe(2);
});

test("awards split the owl and bird buckets at 05:00:00 and 08:00:00 UTC", () => {
  recordMessage(msg({ userId: "late", ts: MON + 5 * H - 1 })); // 04:59:59: owl
  recordMessage(msg({ userId: "early", ts: MON + 5 * H })); // 05:00:00: bird
  recordMessage(msg({ userId: "early", ts: MON + 8 * H - 1 })); // 07:59:59: bird
  recordMessage(msg({ userId: "day", ts: MON + 8 * H })); // 08:00:00: neither
  recordMessage(msg({ userId: "day", ts: MON + 8 * H + 1 }));
  const by = Object.fromEntries(awards(ALL).map((x) => [x.key, x]));
  expect(by["night-owl"]).toEqual({ key: "night-owl", userId: "late", value: 1 });
  expect(by["earliest-bird"]).toEqual({ key: "earliest-bird", userId: "early", value: 2 });
});

test("sharing and emoji totals count per occurrence across messages", () => {
  recordMessage(msg({ attachmentKinds: ["image", "other", "image"], linkDomains: ["a.com", "b.com"] }));
  recordMessage(msg({ attachmentKinds: ["audio"], linkDomains: ["a.com", "b.com"], emoji: [{ emoji: "🙂", name: null, count: 3 }] }));
  const rows = sharing(ALL);
  const get = (k: string, l: string) => rows.find((r) => r.kind === k && r.label === l)?.count;
  expect(get("image", "image")).toBe(2);
  expect(get("audio", "audio")).toBe(1);
  expect(get("link", "a.com")).toBe(2);
  expect(get("link", "b.com")).toBe(2);
  expect(emojiLeaderboard(ALL)).toEqual([{ emoji: "🙂", name: null, count: 3 }]);
});
