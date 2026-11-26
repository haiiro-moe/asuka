import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { db, initDb, schema } from "../../../db/index.ts";
import type { MessageFacts } from "../facts.ts";
import {
  closeVoiceSegment,
  openVoiceSegment,
  recordCommand,
  recordCredit,
  recordMembership,
  recordMessage,
} from "../record.ts";
import { lastDays } from "../time.ts";
import {
  botUsage,
  channelHealth,
  clubsAndEvents,
  drift,
  economy,
  memberInspect,
  moderationSeries,
  newcomers,
  relations,
  repeatOffenders,
} from "./admin.ts";

const DAY = 86400;
const NOW = 1_800_000_000;
/** The last 30 days before NOW. */
const P = lastDays(30, NOW);

/** Every table this file writes to. Emptied before each test, children first. */
const touchedTables = [
  schema.activityMessages,
  schema.activityMentions,
  schema.activityEmoji,
  schema.activityReactions,
  schema.activityVoice,
  schema.activityMembership,
  schema.activityCommands,
  schema.activityCredits,
  schema.modLog,
  schema.warnings,
  schema.storePurchases,
  schema.eventParticipants,
  schema.events,
  schema.clubs,
];

/** Write the excluded-channel list onto the singleton config row. */
function setExcluded(list: string) {
  db.update(schema.guildConfig)
    .set({ activityExcludedChannelIds: list })
    .where(eq(schema.guildConfig.id, 1))
    .run();
}

let seq = 0;

/** Record a message through the write API; returns its id. */
function msg(over: Partial<MessageFacts> = {}): string {
  const messageId = over.messageId ?? `m${++seq}`;
  recordMessage({
    messageId,
    userId: "1",
    channelId: "c1",
    parentChannelId: null,
    ts: NOW - DAY,
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
  });
  return messageId;
}

/** A voice segment in `channelId` from `start` to `end`. */
function voice(userId: string, channelId: string, start: number, end: number) {
  openVoiceSegment(userId, { channelId, muted: false, deafened: false, streaming: false, video: false }, start);
  closeVoiceSegment(userId, end);
}

beforeAll(() => {
  initDb();
});

beforeEach(() => {
  for (const table of touchedTables) db.delete(table).run();
  setExcluded("");
});

afterAll(() => {
  for (const table of touchedTables) db.delete(table).run();
  setExcluded("");
});

describe("drift", () => {
  test("lists a member silent for 31 days, not one silent for 29", () => {
    msg({ userId: "10", ts: NOW - 31 * DAY });
    msg({ userId: "11", ts: NOW - 29 * DAY });
    expect(drift(P)).toEqual([{ userId: "10", lastActiveAt: NOW - 31 * DAY }]);
  });

  test("voice counts as activity", () => {
    msg({ userId: "10", ts: NOW - 40 * DAY });
    voice("10", "v1", NOW - 5 * DAY, NOW - 5 * DAY + 600);
    expect(drift(P)).toEqual([]);
  });

  test("needs activity in the previous period", () => {
    // 30d period: previous period is 60 to 30 days ago.
    msg({ userId: "10", ts: NOW - 70 * DAY });
    expect(drift(P)).toEqual([]);
  });

  test("leaves out members who left", () => {
    msg({ userId: "10", ts: NOW - 31 * DAY });
    recordMembership("10", "leave", NOW - 31 * DAY + 10);
    expect(drift(P)).toEqual([]);
  });

  test("activity in a thread under a channel excluded later stops counting", () => {
    msg({ userId: "10", ts: NOW - 40 * DAY });
    msg({ userId: "10", channelId: "t1", parentChannelId: "c9", ts: NOW - 2 * DAY });
    expect(drift(P)).toEqual([]);
    setExcluded("c9");
    expect(drift(P)).toEqual([{ userId: "10", lastActiveAt: NOW - 40 * DAY }]);
  });
});

describe("newcomers", () => {
  test("marks gotReplyInWeek from a reply to a first-week message", () => {
    const joined = NOW - 10 * DAY;
    recordMembership("20", "join", joined);
    const first = msg({ userId: "20", ts: joined + 100 });
    msg({ userId: "21", ts: joined + 200, replyToUserId: "20", replyToMessageId: first });

    recordMembership("22", "join", joined + 50);
    const own = msg({ userId: "22", ts: joined + 100 });
    msg({ userId: "22", ts: joined + 300, replyToUserId: "22", replyToMessageId: own }); // self reply
    msg({ userId: "22", ts: joined + 50 + 8 * DAY }); // after the first week

    recordMembership("23", "join", NOW - 40 * DAY); // before the period

    expect(newcomers(P)).toEqual([
      { userId: "22", joinedAt: joined + 50, gotReplyInWeek: false, messagesInWeek: 2 },
      { userId: "20", joinedAt: joined, gotReplyInWeek: true, messagesInWeek: 1 },
    ]);
  });

  test("a reply on day 7 counts, one on day 8 does not", () => {
    const joined = NOW - 20 * DAY;
    recordMembership("20", "join", joined);
    const a = msg({ userId: "20", ts: joined + 100 });
    msg({ userId: "21", ts: joined + 6 * DAY + 3600, replyToUserId: "20", replyToMessageId: a }); // day 7

    recordMembership("22", "join", joined + 10);
    const b = msg({ userId: "22", ts: joined + 100 });
    msg({ userId: "21", ts: joined + 10 + 7 * DAY, replyToUserId: "22", replyToMessageId: b }); // day 8, first second
    msg({ userId: "21", ts: joined + 7 * DAY + 3600, replyToUserId: "22", replyToMessageId: b }); // day 8

    expect(newcomers(P)).toEqual([
      { userId: "22", joinedAt: joined + 10, gotReplyInWeek: false, messagesInWeek: 1 },
      { userId: "20", joinedAt: joined, gotReplyInWeek: true, messagesInWeek: 1 },
    ]);
  });

  test("the last second of the first week still counts", () => {
    const joined = NOW - 20 * DAY;
    recordMembership("20", "join", joined);
    const a = msg({ userId: "20", ts: joined + 100 });
    msg({ userId: "21", ts: joined + 7 * DAY - 1, replyToUserId: "20", replyToMessageId: a });
    expect(newcomers(P)[0]!.gotReplyInWeek).toBe(true);
  });

  test("messages in a thread under an excluded channel are ignored", () => {
    const joined = NOW - 10 * DAY;
    recordMembership("20", "join", joined);
    const first = msg({ userId: "20", channelId: "t1", parentChannelId: "c9", ts: joined + 100 });
    msg({ userId: "21", channelId: "t1", parentChannelId: "c9", ts: joined + 200, replyToUserId: "20", replyToMessageId: first });
    setExcluded("c9");
    expect(newcomers(P)).toEqual([{ userId: "20", joinedAt: joined, gotReplyInWeek: false, messagesInWeek: 0 }]);
  });
});

describe("economy", () => {
  test("sums positive deltas into creditsIn and negative into creditsOut", () => {
    recordCredit("30", 50, 50, NOW - 20 * DAY);
    recordCredit("30", 30, 80, NOW - 2 * DAY);
    recordCredit("31", 10, 10, NOW - 2 * DAY);
    recordCredit("30", -20, 60, NOW - DAY);
    recordCredit("32", -5, 0, NOW - DAY);
    recordCredit("33", 0, 0, NOW - DAY); // neither in nor out
    recordCredit("30", 999, 999, NOW - 40 * DAY); // before the period
    db.insert(schema.storePurchases)
      .values([
        { itemId: 1, itemName: "role", kind: "role", userId: "30", price: 20, createdAt: NOW - DAY },
        { itemId: 1, itemName: "role", kind: "role", userId: "32", price: 5, createdAt: NOW - 40 * DAY },
      ])
      .run();

    const e = economy(P);
    expect(e.creditsIn).toBe(90);
    expect(e.creditsOut).toBe(25);
    expect(e.topEarners).toEqual([
      { userId: "30", net: 60 },
      { userId: "31", net: 10 },
    ]);
    expect(e.storeSales).toBe(1);
    expect(e.start).toBe(P.from);
    expect(e.weekly).toEqual([
      { in: 0, out: 0 },
      { in: 50, out: 0 },
      { in: 0, out: 0 },
      { in: 0, out: 0 },
      { in: 40, out: 25 },
    ]);
  });

  test("an empty ledger gives zeros and padded weeks", () => {
    expect(economy(P)).toEqual({
      creditsIn: 0,
      creditsOut: 0,
      start: P.from,
      weekly: Array.from({ length: 5 }, () => ({ in: 0, out: 0 })),
      topEarners: [],
      storeSales: 0,
    });
  });

  test("top earners: positive net only, at most 10, ties by id", () => {
    for (let i = 0; i < 12; i++) recordCredit(String(50 + i), 100 - i, 100 - i, NOW - DAY);
    recordCredit("51", 1, 0, NOW - DAY); // ties 51 (99 + 1) with 50 (100)
    recordCredit("70", -3, 0, NOW - DAY);
    const top = economy(P).topEarners;
    expect(top).toHaveLength(10);
    expect(top.slice(0, 3)).toEqual([
      { userId: "50", net: 100 },
      { userId: "51", net: 100 },
      { userId: "52", net: 98 },
    ]);
    expect(top.at(-1)).toEqual({ userId: "59", net: 91 });
  });

  test("moderation and economy share the bucket start for one period", () => {
    expect(moderationSeries(P).start).toBe(economy(P).start);
  });
});

describe("weekly series start", () => {
  const WEEK = 7 * DAY;
  const ALL = { from: 0, to: NOW };

  test("a bounded period starts at p.from even with older data", () => {
    msg({ ts: NOW - 200 * DAY });
    recordCredit("30", 5, 5, NOW - 200 * DAY);
    expect(moderationSeries(P).start).toBe(P.from);
    expect(economy(P).start).toBe(P.from);
    expect(economy(P).weekly).toHaveLength(5);
  });

  test("all starts at the week of the earliest data, a few buckets, not thousands", () => {
    // The earliest row is a message; the series start there even though it is not theirs.
    msg({ ts: NOW - 14 * DAY });
    recordCredit("30", 7, 7, NOW - 13 * DAY);
    db.insert(schema.modLog).values({ action: "warn", userId: "40", moderatorId: "99", createdAt: NOW - DAY }).run();

    const start = Math.floor((NOW - 14 * DAY) / WEEK) * WEEK;
    expect(start).toBe(1_798_675_200);
    const m = moderationSeries(ALL);
    const e = economy(ALL);
    expect(m).toEqual({ start, weekly: [0, 0, 1], byAction: [{ action: "warn", count: 1 }] });
    expect(e.start).toBe(start);
    expect(e.weekly).toEqual([
      { in: 7, out: 0 },
      { in: 0, out: 0 },
      { in: 0, out: 0 },
    ]);
  });

  test("all takes the earliest of messages, mod log and credits", () => {
    msg({ ts: NOW - DAY });
    db.insert(schema.modLog).values({ action: "credits_grant", userId: "40", moderatorId: "99", createdAt: NOW - 20 * DAY }).run();
    recordCredit("30", 7, 7, NOW - 5 * DAY);
    const start = Math.floor((NOW - 20 * DAY) / WEEK) * WEEK;
    expect(moderationSeries(ALL).start).toBe(start);
    expect(economy(ALL).start).toBe(start);
    expect(economy(ALL).weekly).toHaveLength(Math.ceil((NOW - start) / WEEK));
  });

  test("all on an empty database is a small bounded array", () => {
    const start = Math.floor(NOW / WEEK) * WEEK - WEEK;
    expect(moderationSeries(ALL)).toEqual({ start, weekly: [0, 0], byAction: [] });
    const e = economy(ALL);
    expect(e.start).toBe(start);
    expect(e.weekly).toEqual([
      { in: 0, out: 0 },
      { in: 0, out: 0 },
    ]);
  });
});

describe("relations", () => {
  test("replies: A to B and B to A merge into one pair, sorted by weight", () => {
    msg({ userId: "1", replyToUserId: "3", replyToMessageId: "x" });
    msg({ userId: "1", replyToUserId: "2", replyToMessageId: "x" });
    msg({ userId: "1", replyToUserId: "2", replyToMessageId: "x" });
    msg({ userId: "2", replyToUserId: "1", replyToMessageId: "x" });
    msg({ userId: "2", replyToUserId: "2", replyToMessageId: "x" }); // self reply
    msg({ userId: "1", replyToUserId: "2", replyToMessageId: "x", ts: NOW - 40 * DAY }); // before the period
    expect(relations(P, "replies")).toEqual([
      { a: "1", b: "2", weight: 3 },
      { a: "1", b: "3", weight: 1 },
    ]);
  });

  test("mentions come from activity_mentions", () => {
    msg({ userId: "4", mentionedUserIds: ["5", "6"] });
    msg({ userId: "5", mentionedUserIds: ["4"] });
    expect(relations(P, "mentions")).toEqual([
      { a: "4", b: "5", weight: 2 },
      { a: "4", b: "6", weight: 1 },
    ]);
  });

  test("voice: overlapping seconds in the same channel", () => {
    const t = NOW - 2 * DAY;
    voice("7", "v1", t, t + 1000);
    voice("8", "v1", t + 400, t + 2000);
    voice("9", "v2", t, t + 1000); // other channel
    expect(relations(P, "voice")).toEqual([{ a: "7", b: "8", weight: 600 }]);
  });

  test("a thread under a channel excluded later disappears", () => {
    msg({ userId: "1", channelId: "t1", parentChannelId: "c9", replyToUserId: "2", replyToMessageId: "x" });
    msg({ userId: "1", channelId: "t1", parentChannelId: "c9", mentionedUserIds: ["3"] });
    const t = NOW - 2 * DAY;
    voice("7", "v9", t, t + 100);
    voice("8", "v9", t, t + 100);
    expect(relations(P, "replies")).toHaveLength(1);
    expect(relations(P, "mentions")).toHaveLength(1);
    expect(relations(P, "voice")).toHaveLength(1);
    setExcluded("c9,v9");
    expect(relations(P, "replies")).toEqual([]);
    expect(relations(P, "mentions")).toEqual([]);
    expect(relations(P, "voice")).toEqual([]);
  });

  test("keeps the top 50 pairs", () => {
    for (let i = 0; i < 60; i++) msg({ userId: "1", replyToUserId: String(100 + i), replyToMessageId: "x" });
    expect(relations(P, "replies")).toHaveLength(50);
  });
});

describe("botUsage", () => {
  test("counts runs and failures (ok = 0)", () => {
    recordCommand("1", "profile", true, NOW - DAY);
    recordCommand("2", "profile", false, NOW - DAY);
    recordCommand("1", "profile", true, NOW - DAY);
    recordCommand("1", "leaderboard", true, NOW - DAY);
    recordCommand("1", "leaderboard", false, NOW - 40 * DAY); // before the period
    expect(botUsage(P)).toEqual([
      { name: "profile", uses: 3, failures: 1 },
      { name: "leaderboard", uses: 1, failures: 0 },
    ]);
  });
});

describe("memberInspect", () => {
  test("an unknown user gets zeros and no closest, never throws", () => {
    expect(memberInspect("999", P)).toEqual({ sent: 0, received: 0, ties: 0, busiestHour: null, closest: [] });
  });

  test("counts sent, received, ties and the busiest UTC hour", () => {
    // NOW is 2027-01-15 08:00 UTC.
    const at = (h: number) => NOW - DAY + (h - 8) * 3600;
    msg({ userId: "1", ts: at(9), replyToUserId: "2", replyToMessageId: "x" });
    msg({ userId: "1", ts: at(9) + 5, mentionedUserIds: ["2", "3"] });
    msg({ userId: "1", ts: at(14) });
    msg({ userId: "2", replyToUserId: "1", replyToMessageId: "x" });
    msg({ userId: "4", mentionedUserIds: ["1"] });
    msg({ userId: "1", channelId: "t1", parentChannelId: "c9", replyToUserId: "5", replyToMessageId: "x" });
    setExcluded("c9");
    expect(memberInspect("1", P)).toEqual({
      sent: 3,
      received: 2,
      ties: 3,
      busiestHour: 9,
      closest: [
        { userId: "2", weight: 3 },
        { userId: "3", weight: 1 },
        { userId: "4", weight: 1 },
      ],
    });
  });
});

describe("channelHealth", () => {
  test("unanswered share and median reply time, threads under their parent", () => {
    const t = NOW - 2 * DAY;
    const a = msg({ userId: "1", ts: t });
    msg({ userId: "2", ts: t + 60, replyToUserId: "1", replyToMessageId: a });
    msg({ userId: "2", ts: t + 600, replyToUserId: "1", replyToMessageId: a }); // later reply, not the first
    const own = msg({ userId: "3", ts: t });
    msg({ userId: "3", ts: t + 10, replyToUserId: "3", replyToMessageId: own }); // self reply
    msg({ userId: "4", channelId: "t2", parentChannelId: "c2", ts: t });
    msg({ userId: "4", channelId: "t9", parentChannelId: "c9", ts: t });
    setExcluded("c9");
    expect(channelHealth(P)).toEqual([
      // 5 messages in c1: a, own and the self reply are unanswered; the replies themselves are too.
      { channelId: "c1", messages: 5, unansweredPct: 80, medianReplySec: 60 },
      { channelId: "c2", messages: 1, unansweredPct: 100, medianReplySec: null },
    ]);
  });

  test("exact percentage and an even-count median", () => {
    const t = NOW - 3 * DAY;
    const a = msg({ userId: "1", ts: t });
    const b = msg({ userId: "1", ts: t });
    msg({ userId: "1", ts: t });
    msg({ userId: "2", ts: t + 60, replyToUserId: "1", replyToMessageId: a });
    msg({ userId: "3", ts: t + 121, replyToUserId: "1", replyToMessageId: b });
    msg({ userId: "2", ts: t + 50, channelId: "c3", replyToUserId: "1", replyToMessageId: "old" }); // target not recorded
    // c1: 5 messages, a and b answered (60 s and 121 s): 3 of 5 unanswered, median (60 + 121) / 2 = 90.5.
    expect(channelHealth(P)).toEqual([
      { channelId: "c1", messages: 5, unansweredPct: 60, medianReplySec: 91 },
      { channelId: "c3", messages: 1, unansweredPct: 100, medianReplySec: null },
    ]);
  });

  test("one decimal, and a reply to a message before the period does not count", () => {
    const t = NOW - 3 * DAY;
    const before = msg({ userId: "1", ts: NOW - 31 * DAY });
    const a = msg({ userId: "1", ts: t });
    msg({ userId: "2", ts: t + 30, replyToUserId: "1", replyToMessageId: a });
    msg({ userId: "2", ts: t + 40, replyToUserId: "1", replyToMessageId: before });
    // 3 messages in the period, 1 answered: 66.666... -> 66.7.
    expect(channelHealth(P)).toEqual([{ channelId: "c1", messages: 3, unansweredPct: 66.7, medianReplySec: 30 }]);
  });
});

describe("moderation", () => {
  test("weekly series and counts by action, non-moderation rows left out", () => {
    const row = (action: "warn" | "timeout" | "ban" | "credits_grant", userId: string, createdAt: number) => ({
      action,
      userId,
      moderatorId: "99",
      createdAt,
    });
    db.insert(schema.modLog)
      .values([
        row("warn", "40", NOW - 20 * DAY),
        row("warn", "40", NOW - DAY),
        row("timeout", "40", NOW - DAY),
        row("ban", "41", NOW - DAY),
        row("credits_grant", "42", NOW - DAY),
        row("warn", "43", NOW - 40 * DAY),
      ])
      .run();
    const m = moderationSeries(P);
    expect(m.byAction).toEqual([
      { action: "warn", count: 2 },
      { action: "ban", count: 1 },
      { action: "timeout", count: 1 },
    ]);
    expect(m.start).toBe(P.from);
    expect(m.weekly).toEqual([0, 1, 0, 0, 3]);
  });

  test("no moderation still gives padded weeks", () => {
    expect(moderationSeries(P)).toEqual({ start: P.from, weekly: [0, 0, 0, 0, 0], byAction: [] });
  });

  test("repeat offenders: warnings plus timeouts, kicks and bans, twice or more", () => {
    db.insert(schema.warnings)
      .values([
        { userId: "40", moderatorId: "99", createdAt: NOW - DAY },
        { userId: "41", moderatorId: "99", createdAt: NOW - DAY },
        { userId: "42", moderatorId: "99", createdAt: NOW - 40 * DAY },
        { userId: "42", moderatorId: "99", createdAt: NOW - DAY },
      ])
      .run();
    db.insert(schema.modLog)
      .values([
        { action: "warn", userId: "40", moderatorId: "99", createdAt: NOW - DAY }, // mirrors the warning
        { action: "timeout", userId: "40", moderatorId: "99", createdAt: NOW - DAY },
        { action: "kick", userId: "40", moderatorId: "99", createdAt: NOW - DAY },
        { action: "untimeout", userId: "41", moderatorId: "99", createdAt: NOW - DAY },
      ])
      .run();
    expect(repeatOffenders(P)).toEqual([{ userId: "40", count: 3 }]);
  });
});

describe("clubsAndEvents", () => {
  test("club messages and dead clubs, events with attendees", () => {
    const old = NOW - 100 * DAY;
    db.insert(schema.clubs)
      .values([
        { id: 1, name: "alive", ownerId: "1", status: "approved", channelId: "k1", createdAt: old },
        { id: 2, name: "dead", ownerId: "1", status: "approved", threadId: "k2", createdAt: old },
        { id: 3, name: "new", ownerId: "1", status: "approved", threadId: "k3", createdAt: NOW - 5 * DAY },
        { id: 4, name: "gone", ownerId: "1", status: "terminated", channelId: "k4", createdAt: old },
      ])
      .run();
    msg({ channelId: "k1", ts: NOW - DAY });
    msg({ channelId: "kt", parentChannelId: "k1", ts: NOW - DAY }); // thread in the club channel
    msg({ channelId: "k2", ts: NOW - 31 * DAY });
    msg({ channelId: "k4", ts: NOW - DAY });

    db.insert(schema.events)
      .values([
        { id: 1, title: "movie night", startAt: NOW - 3 * DAY, createdBy: "1" },
        { id: 2, title: "weekly", startAt: NOW - 90 * DAY, recurrence: "weekly", createdBy: "1" },
        { id: 3, title: "long ago", startAt: NOW - 90 * DAY, createdBy: "1" },
      ])
      .run();
    db.insert(schema.eventParticipants)
      .values([
        { eventId: 1, userId: "1" },
        { eventId: 2, userId: "1" },
        { eventId: 2, userId: "2" },
        { eventId: 3, userId: "1" },
      ])
      .run();

    expect(clubsAndEvents(P)).toEqual({
      clubs: [
        { id: 1, name: "alive", messages: 2, dead: false },
        { id: 2, name: "dead", messages: 0, dead: true },
        { id: 3, name: "new", messages: 0, dead: false },
      ],
      events: [
        { id: 2, title: "weekly", attendees: 2 },
        { id: 1, title: "movie night", attendees: 1 },
      ],
    });
  });

  test("a club silent for exactly 30 days is alive, one second more is dead", () => {
    const old = NOW - 100 * DAY;
    db.insert(schema.clubs)
      .values([
        { id: 1, name: "edge", ownerId: "1", status: "approved", channelId: "k1", createdAt: old },
        { id: 2, name: "past", ownerId: "1", status: "approved", channelId: "k2", voiceChannelId: "kv", createdAt: old },
        { id: 3, name: "just old enough", ownerId: "1", status: "approved", threadId: "k3", createdAt: NOW - 30 * DAY },
      ])
      .run();
    msg({ channelId: "k1", ts: NOW - 30 * DAY });
    msg({ channelId: "kv", ts: NOW - 30 * DAY - 1 });
    expect(clubsAndEvents(P).clubs).toEqual([
      { id: 1, name: "edge", messages: 1, dead: false },
      { id: 2, name: "past", messages: 0, dead: true },
      { id: 3, name: "just old enough", messages: 0, dead: true },
    ]);
  });

  test("messages in an excluded club thread do not keep it alive", () => {
    db.insert(schema.clubs)
      .values({ id: 1, name: "hidden", ownerId: "1", status: "approved", channelId: "k1", createdAt: NOW - 100 * DAY })
      .run();
    msg({ channelId: "kt", parentChannelId: "k1", ts: NOW - DAY });
    expect(clubsAndEvents(P).clubs).toEqual([{ id: 1, name: "hidden", messages: 1, dead: false }]);
    setExcluded("k1");
    expect(clubsAndEvents(P).clubs).toEqual([{ id: 1, name: "hidden", messages: 0, dead: true }]);
  });
});
