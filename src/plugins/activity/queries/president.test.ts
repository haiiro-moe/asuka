import { afterAll, beforeAll, beforeEach, expect, spyOn, test } from "bun:test";
import { eq } from "drizzle-orm";
import type { ApiContext, ApiRoute } from "../../../core/plugin.ts";
import { db, initDb, schema } from "../../../db/index.ts";
import { createPresidentRoutes, presidentRoutes } from "../api/president.ts";
import type { MessageFacts } from "../facts.ts";
import { closeVoiceSegment, openVoiceSegment, recordMembership, recordMessage } from "../record.ts";
import type { Period } from "../time.ts";
import type {
  PresidentClubEventHealth,
  PresidentConnection,
  PresidentEngagement,
  PresidentGroupSizes,
  PresidentWeeklySeries,
} from "../types/president.ts";
import {
  QUIET_LOOKBACK_DAYS,
  clubEventHealth,
  connection,
  engagement,
  groupSizes,
  presidentPeriod,
  weeklySeries,
} from "./president.ts";

const MINUTE = 60;
const HOUR = 3600;
const DAY = 86400;

/** Thursday 26 Nov 2026, 15:30 UTC: what the injected clock reads. */
const NOW = Date.UTC(2026, 10, 26, 15, 30) / 1000;
/** Thursday 26 Nov 2026, 00:00 UTC: where every president period ends. */
const TODAY = Date.UTC(2026, 10, 26) / 1000;
/** Monday 23 Nov 2026, 00:00 UTC: the week boundary inside {@link WEEK}. */
const MONDAY = Date.UTC(2026, 10, 23) / 1000;
/** The `week` period for {@link NOW}: Thursday 19 Nov up to Thursday 26 Nov. */
const WEEK: Period = { from: TODAY - 7 * DAY, to: TODAY };
/** A moment inside {@link WEEK}: Tuesday 24 Nov, 00:00 UTC. */
const IN_WEEK = TODAY - 2 * DAY;

/** An 18-digit id, like a Discord snowflake. */
const snowflake = (lead: number, n: number) => `${lead}${String(n).padStart(17, "0")}`;
const user = (n: number) => snowflake(9, n);
const channel = (n: number) => snowflake(8, n);
/** Members `from` to `to`, both included. */
const users = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => user(from + i));

const TEXT = channel(1);
const VOICE = channel(2);

/** Every table this file writes to. Emptied before each test. */
const touchedTables = [
  schema.activityMessages,
  schema.activityMentions,
  schema.activityEmoji,
  schema.activityVoice,
  schema.activityMembership,
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

/** Set the singleton president row's term start. */
function setTermStart(termStart: number | null) {
  db.update(schema.president).set({ termStart }).where(eq(schema.president.id, 1)).run();
}

/** Empty the touched tables and put the singleton rows back as seeded. */
function reset() {
  for (const table of touchedTables) db.delete(table).run();
  setExcluded("");
  setTermStart(null);
}

let nextId = 0;

/** Record one message by `userId` at `ts`. */
function post(userId: string, ts: number, over: Partial<MessageFacts> = {}) {
  nextId += 1;
  const written = recordMessage({
    messageId: snowflake(7, nextId),
    userId,
    channelId: TEXT,
    parentChannelId: null,
    ts,
    replyToUserId: null,
    replyToMessageId: null,
    mentionedUserIds: [],
    attachmentKinds: [],
    linkDomains: [],
    stickerCount: 0,
    length: 12,
    emoji: [],
    source: "live",
    ...over,
  });
  expect(written).toBe(true);
}

/** Record a reply by `from` to a message of `to`. */
function reply(from: string, to: string, ts: number, over: Partial<MessageFacts> = {}) {
  post(from, ts, { replyToUserId: to, replyToMessageId: snowflake(6, 1), ...over });
}

/**
 * Make `ids` one tight group: at `ts`, every member replies once to every
 * other member. That is `n * (n - 1)` messages, and everybody has written.
 */
function chat(ids: string[], ts: number, over: Partial<MessageFacts> = {}) {
  for (const a of ids) {
    for (const b of ids) {
      if (a !== b) reply(a, b, ts, over);
    }
  }
}

/** Record a voice segment; `end` null leaves it open. */
function voice(userId: string, start: number, end: number | null, channelId = VOICE) {
  openVoiceSegment(userId, { channelId, muted: false, deafened: false, streaming: false, video: false }, start);
  if (end !== null) closeVoiceSegment(userId, end);
}

let nextClub = 0;

/** Insert an approved club that has existed for 60 days. */
function club(over: Partial<typeof schema.clubs.$inferInsert> = {}) {
  nextClub += 1;
  return db
    .insert(schema.clubs)
    .values({
      name: `club ${nextClub}`,
      ownerId: user(90),
      status: "approved",
      createdAt: TODAY - 60 * DAY,
      ...over,
    })
    .returning()
    .get();
}

/** Insert an event that was created ten days before it starts. */
function event(startAt: number, over: Partial<typeof schema.events.$inferInsert> = {}) {
  return db
    .insert(schema.events)
    .values({ title: "movie night", startAt, createdBy: user(90), createdAt: startAt - 10 * DAY, ...over })
    .returning()
    .get();
}

/** Sign `n` members up for an event. */
function attend(eventId: number, n: number, createdAt = TODAY - 20 * DAY) {
  for (let i = 0; i < n; i++) {
    db.insert(schema.eventParticipants).values({ eventId, userId: user(100 + i), createdAt }).run();
  }
}

/** A handler context. The president handlers read nothing from it. */
const CTX = { params: {}, session: { userId: user(1), role: "president" } } as unknown as ApiContext;

const ROUTE_NAMES = ["connection", "weekly", "groups", "engagement", "clubs"] as const;

/** Call one president route of `routes` with a raw query string. */
async function call(routes: ApiRoute[], name: string, query = ""): Promise<Response> {
  const route = routes.find((r) => r.path === `/api/activity/president/${name}`);
  if (!route) throw new Error(`no president route "${name}"`);
  return route.handle(new Request(`http://asuka.test${route.path}${query}`), CTX);
}

/** The JSON bodies of all five routes for one period, read at `clock`. */
async function callAll(clock: () => number, period: "week" | "term") {
  const routes = createPresidentRoutes(clock);
  const body = async (name: string) => {
    const res = await call(routes, name, `?period=${period}`);
    expect(res.status).toBe(200);
    return res.json() as Promise<unknown>;
  };
  return {
    connection: (await body("connection")) as PresidentConnection,
    weekly: (await body("weekly")) as PresidentWeeklySeries,
    groups: (await body("groups")) as PresidentGroupSizes,
    engagement: (await body("engagement")) as PresidentEngagement,
    clubs: (await body("clubs")) as PresidentClubEventHealth,
  };
}

const sum = (values: number[]) => values.reduce((a, b) => a + b, 0);

// bun test runs with NODE_ENV=test, so the database is in-memory.
beforeAll(() => {
  initDb();
});

beforeEach(reset);

// Other test files share this database: leave it as seeded.
afterAll(reset);

// --- presidentPeriod --------------------------------------------------------

test("week is the seven full UTC days before today", () => {
  expect(presidentPeriod("week", NOW)).toEqual({ from: TODAY - 7 * DAY, to: TODAY });
});

test("a missing period means week", () => {
  expect(presidentPeriod(null, NOW)).toEqual(presidentPeriod("week", NOW));
});

test("a period is the same at every moment of one UTC day and moves at midnight", () => {
  for (const value of ["week", "term"]) {
    expect(presidentPeriod(value, TODAY)).toEqual(presidentPeriod(value, NOW));
    expect(presidentPeriod(value, TODAY + DAY - 1)).toEqual(presidentPeriod(value, NOW));
    expect(presidentPeriod(value, TODAY + DAY).to).toBe(TODAY + DAY);
  }
});

test("term runs from the term start up to today 00:00 UTC", () => {
  setTermStart(TODAY - 40 * DAY + 5 * HOUR);
  expect(presidentPeriod("term", NOW)).toEqual({ from: TODAY - 40 * DAY + 5 * HOUR, to: TODAY });
});

test("term without a president is the 90 days before today 00:00 UTC", () => {
  expect(presidentPeriod("term", NOW)).toEqual({ from: TODAY - 90 * DAY, to: TODAY });
});

test("a term that began today is empty", () => {
  setTermStart(TODAY + 2 * HOUR);
  expect(presidentPeriod("term", NOW)).toEqual({ from: TODAY, to: TODAY });
});

test("any other period is a RangeError", () => {
  for (const value of ["30d", "7d", "year", "all", "", "Week", " week", "term ", "0"]) {
    expect(() => presidentPeriod(value, NOW)).toThrow(RangeError);
  }
});

// --- connection: gone quiet -------------------------------------------------

/** A member whose last message is `days` days and one second before the period ends. */
function lastSeen(userId: string, days: number) {
  post(userId, TODAY - days * DAY - 1);
}

test("exactly one member quiet for 30 days or more is hidden", () => {
  lastSeen(user(1), 30);
  chat(users(2, 5), IN_WEEK);
  expect(connection(WEEK).quiet).toBeNull();
});

test("two quiet members are hidden too", () => {
  lastSeen(user(1), 30);
  lastSeen(user(2), 45);
  expect(connection(WEEK).quiet).toBeNull();
});

test("three quiet members are counted", () => {
  lastSeen(user(1), 30);
  lastSeen(user(2), 45);
  lastSeen(user(3), 80);
  chat(users(4, 7), IN_WEEK);
  expect(connection(WEEK).quiet).toBe(3);
});

test("nobody quiet is 0", () => {
  chat(users(1, 4), IN_WEEK);
  expect(connection(WEEK).quiet).toBe(0);
});

test("a member seen within the last 30 days is not quiet", () => {
  for (const n of [1, 2, 3]) lastSeen(user(n), 40);
  // 30 days before the end, to the second: still inside the last 30 days.
  post(user(4), TODAY - 40 * DAY);
  post(user(4), TODAY - 30 * DAY);
  // In voice eleven days ago.
  post(user(5), TODAY - 40 * DAY);
  voice(user(5), TODAY - 11 * DAY, TODAY - 11 * DAY + HOUR);
  // Still connected: the segment was opened long ago and never closed.
  post(user(6), TODAY - 50 * DAY);
  voice(user(6), TODAY - 45 * DAY, null);
  expect(connection(WEEK).quiet).toBe(3);
});

test("voice counts as having been active before going quiet", () => {
  for (const n of [1, 2]) lastSeen(user(n), 40);
  voice(user(3), TODAY - 50 * DAY, TODAY - 50 * DAY + HOUR);
  expect(connection(WEEK).quiet).toBe(3);
});

test("a member who left is not quiet, one who came back is", () => {
  for (const n of [1, 2, 3, 4, 5]) lastSeen(user(n), 40);
  recordMembership(user(4), "leave", TODAY - 35 * DAY);
  recordMembership(user(5), "leave", TODAY - 35 * DAY);
  recordMembership(user(5), "join", TODAY - 33 * DAY);
  expect(connection(WEEK).quiet).toBe(4);
  // A leave after the period ended has not happened yet, as far as the period goes.
  recordMembership(user(1), "leave", TODAY + HOUR);
  expect(connection(WEEK).quiet).toBe(4);
});

test("a member silent for longer than the lookback is gone, not quiet", () => {
  for (const n of [1, 2, 3]) lastSeen(user(n), 40);
  lastSeen(user(4), 30 + QUIET_LOOKBACK_DAYS);
  expect(connection(WEEK).quiet).toBe(3);
});

test("activity after the period ended does not end the quiet", () => {
  for (const n of [1, 2, 3]) lastSeen(user(n), 40);
  post(user(1), TODAY + HOUR);
  voice(user(2), TODAY + HOUR, TODAY + 2 * HOUR);
  expect(connection(WEEK).quiet).toBe(3);
});

test("activity in an excluded channel neither makes nor ends a quiet", () => {
  const hidden = channel(50);
  for (const n of [1, 2, 3]) lastSeen(user(n), 40);
  // Recent, but only in the channel that gets excluded: quiet once it is.
  post(user(4), TODAY - 40 * DAY - 1);
  post(user(4), IN_WEEK, { channelId: hidden });
  // Old, and only in that channel: never seen at all once it is excluded.
  post(user(5), TODAY - 40 * DAY - 1, { channelId: channel(51), parentChannelId: hidden });
  voice(user(6), TODAY - 40 * DAY, TODAY - 40 * DAY + HOUR, hidden);
  expect(connection(WEEK).quiet).toBe(5);
  setExcluded(hidden);
  expect(connection(WEEK).quiet).toBe(4);
});

// --- connection: groups, connected, total, bridges --------------------------

test("groups counts groups of three or more only", () => {
  chat(users(1, 4), IN_WEEK);
  chat(users(5, 7), IN_WEEK + HOUR);
  chat(users(8, 9), IN_WEEK + 2 * HOUR);
  post(user(10), IN_WEEK + 3 * HOUR);
  const result = connection(WEEK);
  expect(result.groups).toBe(2);
  expect(result.connected).toBe(7);
  // The pair and the member nobody answered are three: enough to be counted.
  expect(result.total).toBe(10);
  expect(result.groups).toBe(groupSizes(WEEK).sizes.length);
});

test("nothing recorded is all zeros, not hidden", () => {
  expect(connection(WEEK)).toEqual({ connected: 0, total: 0, groups: 0, bridges: 0, quiet: 0 });
});

test("an empty period is all zeros", () => {
  chat(users(1, 4), IN_WEEK);
  const empty: Period = { from: TODAY, to: TODAY };
  expect(connection(empty)).toMatchObject({ connected: 0, total: 0, groups: 0, bridges: 0 });
  expect(groupSizes(empty)).toEqual({ sizes: [], other: 0 });
  expect(weeklySeries(empty)).toEqual({ replies: [], voiceHours: [] });
  expect(engagement(empty)).toEqual({ messages: 0, activeMembers: 0, voiceHours: 0 });
});

test("connected is the members of the shown groups, total adds the rest when it can be shown", () => {
  chat(users(1, 5), IN_WEEK);
  for (const n of [6, 7, 8]) post(user(n), IN_WEEK + HOUR);
  expect(connection(WEEK)).toMatchObject({ connected: 5, total: 8, groups: 1 });
});

test("total is hidden when one or two members are outside the shown groups", () => {
  chat(users(1, 5), IN_WEEK);
  post(user(6), IN_WEEK + HOUR);
  expect(connection(WEEK)).toMatchObject({ connected: 5, total: null, groups: 1 });
  post(user(7), IN_WEEK + HOUR);
  expect(connection(WEEK)).toMatchObject({ connected: 5, total: null, groups: 1 });
  post(user(8), IN_WEEK + HOUR);
  expect(connection(WEEK)).toMatchObject({ connected: 5, total: 8, groups: 1 });
});

test("one or two active members alone are hidden entirely", () => {
  post(user(1), IN_WEEK);
  post(user(2), IN_WEEK);
  expect(connection(WEEK)).toMatchObject({ connected: 0, total: null, groups: 0, bridges: 0 });
  expect(engagement(WEEK).activeMembers).toBeNull();
});

test("bridges counts the pairs that tie two shown groups together, hidden under three", () => {
  const left = users(1, 4);
  const right = users(11, 14);
  chat(left, IN_WEEK);
  chat(right, IN_WEEK + HOUR);
  expect(connection(WEEK)).toMatchObject({ groups: 2, bridges: 0 });

  reply(left[0]!, right[0]!, IN_WEEK + 2 * HOUR);
  expect(connection(WEEK)).toMatchObject({ groups: 2, bridges: null });

  reply(right[1]!, left[1]!, IN_WEEK + 2 * HOUR);
  expect(connection(WEEK)).toMatchObject({ groups: 2, bridges: null });

  reply(left[2]!, right[2]!, IN_WEEK + 2 * HOUR);
  // A second reply between the same two members is still one pair.
  reply(right[2]!, left[2]!, IN_WEEK + 2 * HOUR);
  expect(connection(WEEK)).toMatchObject({ groups: 2, bridges: 3, connected: 8, total: 8 });
});

test("a tie to a pair outside the shown groups is not a bridge", () => {
  chat(users(1, 4), IN_WEEK);
  // 5 and 6 answer each other often, and 5 once answers someone in the group.
  for (let i = 0; i < 3; i++) {
    reply(user(5), user(6), IN_WEEK + HOUR + i);
    reply(user(6), user(5), IN_WEEK + HOUR + i);
  }
  reply(user(5), user(1), IN_WEEK + 2 * HOUR);
  const result = connection(WEEK);
  expect(groupSizes(WEEK)).toEqual({ sizes: [4], other: null });
  expect(result).toMatchObject({ groups: 1, bridges: 0, connected: 4, total: null });
});

test("a reply to yourself, to a bot or to someone not active in the period ties nobody", () => {
  // Self replies.
  reply(user(1), user(1), IN_WEEK);
  // A reply to a bot's message keeps the message id but has no user.
  post(user(2), IN_WEEK, { replyToMessageId: snowflake(6, 2) });
  // user(9) wrote nothing in the week: three members answer an old message of theirs.
  post(user(9), TODAY - 20 * DAY);
  for (const n of [3, 4, 5]) reply(user(n), user(9), IN_WEEK);
  // Five members wrote, each tied to nobody. user(9) is not one of them.
  expect(groupSizes(WEEK)).toEqual({ sizes: [], other: 5 });
  expect(connection(WEEK)).toMatchObject({ connected: 0, total: 5, groups: 0, bridges: 0 });
  expect(engagement(WEEK).activeMembers).toBe(5);
});

test("a mention is not a tie", () => {
  for (const n of [1, 2, 3]) {
    post(user(n), IN_WEEK, { mentionedUserIds: users(1, 3).filter((id) => id !== user(n)) });
  }
  expect(groupSizes(WEEK)).toEqual({ sizes: [], other: 3 });
});

test("sharing a voice channel ties members together", () => {
  for (const n of [1, 2, 3]) voice(user(n), IN_WEEK, IN_WEEK + 30 * MINUTE);
  expect(groupSizes(WEEK)).toEqual({ sizes: [3], other: 0 });
  expect(connection(WEEK)).toMatchObject({ connected: 3, total: 3, groups: 1 });
});

test("a few minutes in the same voice channel are not a tie", () => {
  for (const n of [1, 2, 3]) voice(user(n), IN_WEEK, IN_WEEK + 9 * MINUTE);
  expect(groupSizes(WEEK)).toEqual({ sizes: [], other: 3 });
});

test("voice in different channels, or at different times, is not shared", () => {
  voice(user(1), IN_WEEK, IN_WEEK + HOUR, channel(21));
  voice(user(2), IN_WEEK, IN_WEEK + HOUR, channel(22));
  voice(user(3), IN_WEEK + 2 * HOUR, IN_WEEK + 3 * HOUR, channel(21));
  expect(groupSizes(WEEK)).toEqual({ sizes: [], other: 3 });
});

test("shared voice is measured inside the period only", () => {
  // Together for an hour, of which only the last five minutes are in the week.
  for (const n of [1, 2, 3]) voice(user(n), WEEK.from - 55 * MINUTE, WEEK.from + 5 * MINUTE);
  expect(groupSizes(WEEK)).toEqual({ sizes: [], other: 3 });
});

test("activity outside the period is not counted", () => {
  chat(users(1, 4), WEEK.from - 1);
  chat(users(5, 8), TODAY);
  expect(connection(WEEK)).toMatchObject({ connected: 0, total: 0, groups: 0 });
  // The first and the last second of the period are in it; its end is not.
  chat(users(1, 3), WEEK.from);
  expect(connection(WEEK)).toMatchObject({ connected: 3, total: 3, groups: 1 });
  chat(users(5, 7), TODAY - 1);
  expect(connection(WEEK)).toMatchObject({ connected: 6, total: 6, groups: 2 });
});

test("excluded channels, and threads under them, are left out of every number", () => {
  const hidden = channel(50);
  chat(users(1, 4), IN_WEEK, { channelId: hidden });
  chat(users(5, 8), IN_WEEK + HOUR, { channelId: channel(51), parentChannelId: hidden });
  for (const n of [9, 10, 11]) voice(user(n), IN_WEEK, IN_WEEK + HOUR, hidden);
  chat(users(12, 14), IN_WEEK + 2 * HOUR);

  expect(connection(WEEK)).toMatchObject({ connected: 14, total: 14, groups: 4 });
  expect(engagement(WEEK)).toEqual({ messages: 30, activeMembers: 14, voiceHours: 3 });
  expect(sum(weeklySeries(WEEK).replies)).toBe(30);

  setExcluded(`${hidden}, ${channel(60)}`);
  expect(connection(WEEK)).toMatchObject({ connected: 3, total: 3, groups: 1 });
  expect(groupSizes(WEEK)).toEqual({ sizes: [3], other: 0 });
  expect(engagement(WEEK)).toEqual({ messages: 6, activeMembers: 3, voiceHours: 0 });
  expect(weeklySeries(WEEK)).toEqual({ replies: [0, 6], voiceHours: [0, 0] });
});

// --- groupSizes -------------------------------------------------------------

test("groupSizes shows the groups of three or more and merges the rest into other", () => {
  // Groups of 14, 9, 2, 1 and 5.
  chat(users(1, 14), IN_WEEK);
  chat(users(15, 23), IN_WEEK + HOUR);
  chat(users(24, 25), IN_WEEK + 2 * HOUR);
  post(user(26), IN_WEEK + 3 * HOUR);
  chat(users(27, 31), IN_WEEK + 4 * HOUR);
  expect(groupSizes(WEEK)).toEqual({ sizes: [14, 9, 5], other: 3 });
  expect(connection(WEEK)).toMatchObject({ connected: 28, total: 31, groups: 3 });
});

test("groupSizes hides other when it is one small group of two", () => {
  chat(users(1, 4), IN_WEEK);
  chat(users(5, 6), IN_WEEK + HOUR);
  expect(groupSizes(WEEK)).toEqual({ sizes: [4], other: null });
});

test("groupSizes lists the largest group first, whatever the ids are", () => {
  chat(users(1, 3), IN_WEEK);
  chat(users(11, 16), IN_WEEK + HOUR);
  chat(users(21, 24), IN_WEEK + 2 * HOUR);
  expect(groupSizes(WEEK)).toEqual({ sizes: [6, 4, 3], other: 0 });
});

// --- weeklySeries -----------------------------------------------------------

test("weeklySeries buckets replies and voice hours by UTC week, Monday first", () => {
  // The week period covers Thu 19 to Sun 22 Nov and Mon 23 to Wed 25 Nov.
  const friday = MONDAY - 3 * DAY;
  reply(user(1), user(2), friday);
  reply(user(2), user(1), MONDAY - 1);
  reply(user(1), user(2), MONDAY);
  reply(user(3), user(1), MONDAY + DAY);
  reply(user(2), user(3), TODAY - 1);
  // Not replies to a member: a plain message, a self reply, a reply to a bot.
  post(user(1), friday);
  reply(user(1), user(1), friday);
  post(user(1), friday, { replyToMessageId: snowflake(6, 2) });

  // One hour before Monday and two after it.
  voice(user(1), MONDAY - HOUR, MONDAY + 2 * HOUR);
  // Started before the period: only the 90 minutes inside it count.
  voice(user(2), WEEK.from - 2 * HOUR, WEEK.from + 90 * MINUTE);
  // Still open: it runs to the end of the period, not to now.
  voice(user(3), TODAY - 2 * HOUR, null);

  expect(weeklySeries(WEEK)).toEqual({ replies: [2, 3], voiceHours: [2.5, 4] });
});

test("weeklySeries has one bucket for every UTC week the period touches", () => {
  // Monday 2 Nov, 12:00 UTC up to Thursday 26 Nov: four weeks, the first and the last partial.
  const term: Period = { from: MONDAY - 21 * DAY + 12 * HOUR, to: TODAY };
  reply(user(1), user(2), MONDAY - 21 * DAY + 11 * HOUR);
  reply(user(1), user(2), MONDAY - 21 * DAY + 12 * HOUR);
  reply(user(1), user(2), MONDAY - 14 * DAY);
  reply(user(1), user(2), MONDAY - 14 * DAY + 5);
  reply(user(1), user(2), MONDAY + 5);
  voice(user(1), MONDAY - 8 * DAY, MONDAY - 8 * DAY + 3 * HOUR);
  expect(weeklySeries(term)).toEqual({ replies: [1, 2, 0, 1], voiceHours: [0, 3, 0, 0] });

  // Three whole weeks ending on a Monday are exactly three buckets.
  expect(weeklySeries({ from: MONDAY - 21 * DAY, to: MONDAY })).toEqual({
    replies: [2, 2, 0],
    voiceHours: [0, 3, 0],
  });
});

// --- engagement -------------------------------------------------------------

test("engagement counts messages, active members and voice hours", () => {
  chat(users(1, 3), IN_WEEK);
  post(user(1), IN_WEEK + HOUR);
  post(user(2), IN_WEEK + HOUR);
  // Only in voice: active without a message.
  for (const n of [4, 5, 6]) voice(user(n), IN_WEEK, IN_WEEK + 30 * MINUTE);
  expect(engagement(WEEK)).toEqual({ messages: 8, activeMembers: 6, voiceHours: 1.5 });
});

test("engagement gives voice hours to one decimal", () => {
  voice(user(1), IN_WEEK, IN_WEEK + 100 * MINUTE);
  expect(engagement(WEEK).voiceHours).toBe(1.7);
});

test("activeMembers is the same number as the connection total", () => {
  chat(users(1, 5), IN_WEEK);
  post(user(6), IN_WEEK + HOUR);
  expect(engagement(WEEK).activeMembers).toBeNull();
  expect(connection(WEEK).total).toBeNull();
  for (const n of [7, 8]) post(user(n), IN_WEEK + HOUR);
  expect(engagement(WEEK).activeMembers).toBe(8);
  expect(connection(WEEK).total).toBe(8);
});

// --- clubEventHealth --------------------------------------------------------

test("clubEventHealth splits the approved clubs into active and quiet", () => {
  // Active through a message in the club's thread.
  club({ threadId: channel(31) });
  post(user(1), IN_WEEK, { channelId: channel(31), parentChannelId: channel(30) });
  // Active through a message in a thread under the club's channel.
  club({ channelId: channel(32) });
  post(user(2), IN_WEEK, { channelId: channel(33), parentChannelId: channel(32) });
  // Active through its voice channel.
  club({ channelId: channel(34), voiceChannelId: channel(35) });
  voice(user(3), IN_WEEK, IN_WEEK + HOUR, channel(35));
  // Quiet: nothing, activity before the period, and no channel at all.
  club({ threadId: channel(36) });
  club({ channelId: channel(37) });
  post(user(4), WEEK.from - HOUR, { channelId: channel(37) });
  club();
  // Not approved, or created after the period ended: not counted.
  club({ status: "pending", channelId: channel(38) });
  club({ status: "terminated", channelId: channel(39) });
  club({ channelId: channel(40), createdAt: TODAY + HOUR });

  expect(clubEventHealth(WEEK)).toMatchObject({ clubsActive: 3, clubsQuiet: 3 });
});

test("clubEventHealth hides both club counts when either is one or two", () => {
  for (const n of [1, 2, 3, 4]) {
    club({ channelId: channel(30 + n) });
    post(user(n), IN_WEEK, { channelId: channel(30 + n) });
  }
  expect(clubEventHealth(WEEK)).toMatchObject({ clubsActive: 4, clubsQuiet: 0 });
  club({ channelId: channel(40) });
  expect(clubEventHealth(WEEK)).toMatchObject({ clubsActive: null, clubsQuiet: null });
});

test("clubEventHealth leaves out a club whose channels are excluded", () => {
  for (const n of [1, 2, 3]) {
    club({ channelId: channel(30 + n) });
    post(user(n), IN_WEEK, { channelId: channel(30 + n) });
  }
  club({ channelId: channel(40), voiceChannelId: channel(41) });
  post(user(4), IN_WEEK, { channelId: channel(40) });
  expect(clubEventHealth(WEEK)).toMatchObject({ clubsActive: 4, clubsQuiet: 0 });
  setExcluded(`${channel(40)},${channel(41)}`);
  expect(clubEventHealth(WEEK)).toMatchObject({ clubsActive: 3, clubsQuiet: 0 });
});

test("clubEventHealth counts the event occurrences in the period and their attendance", () => {
  // One-off, in the week, four signed up.
  const movie = event(IN_WEEK + 12 * HOUR);
  attend(movie.id, 4);
  // Weekly at noon since 30 days ago: once in the week, five times in 90 days. Six signed up.
  const weekly = event(TODAY - 30 * DAY + 12 * HOUR, { recurrence: "weekly" });
  attend(weekly.id, 6);
  // Outside the week: before it, and later today.
  event(WEEK.from - DAY);
  event(TODAY + HOUR, { createdAt: TODAY - DAY });

  expect(clubEventHealth(WEEK)).toMatchObject({ eventsHeld: 2, avgAttendance: 5 });
  const ninetyDays: Period = { from: TODAY - 90 * DAY, to: TODAY };
  // 5 occurrences with 6, one with 4, one with nobody: 34 / 7.
  expect(clubEventHealth(ninetyDays)).toMatchObject({ eventsHeld: 7, avgAttendance: 4.9 });
});

test("clubEventHealth hides an average attendance under three", () => {
  const small = event(IN_WEEK);
  attend(small.id, 2);
  expect(clubEventHealth(WEEK)).toMatchObject({ eventsHeld: 1, avgAttendance: null });
  const large = event(IN_WEEK + HOUR);
  attend(large.id, 5);
  expect(clubEventHealth(WEEK)).toMatchObject({ eventsHeld: 2, avgAttendance: 3.5 });
});

test("clubEventHealth without events or clubs is zeros", () => {
  expect(clubEventHealth(WEEK)).toEqual({ clubsActive: 0, clubsQuiet: 0, eventsHeld: 0, avgAttendance: 0 });
  // Nobody signed up: an average of 0 identifies nobody.
  event(IN_WEEK);
  expect(clubEventHealth(WEEK)).toMatchObject({ eventsHeld: 1, avgAttendance: 0 });
});

test("clubEventHealth ignores sign-ups and events made after the period ended", () => {
  const movie = event(IN_WEEK);
  attend(movie.id, 4);
  expect(clubEventHealth(WEEK)).toMatchObject({ eventsHeld: 1, avgAttendance: 4 });
  db.insert(schema.eventParticipants).values({ eventId: movie.id, userId: user(150), createdAt: TODAY + HOUR }).run();
  event(IN_WEEK + HOUR, { createdAt: TODAY + HOUR });
  expect(clubEventHealth(WEEK)).toMatchObject({ eventsHeld: 1, avgAttendance: 4 });
});

// --- routes -----------------------------------------------------------------

test("the president routes are the five GET routes, all president tier", () => {
  expect(presidentRoutes.map((r) => r.path).sort()).toEqual(
    ROUTE_NAMES.map((name) => `/api/activity/president/${name}`).sort(),
  );
  for (const route of presidentRoutes) {
    expect(route.method).toBe("GET");
    expect(route.access).toBe("president");
  }
});

test("routes reject ?period=30d with 400", async () => {
  for (const name of ROUTE_NAMES) {
    const res = await call(presidentRoutes, name, "?period=30d");
    expect(res.status).toBe(400);
    expect(res.headers.get("content-type")).toContain("application/json");
    const body = (await res.json()) as { error: unknown };
    expect(Object.keys(body)).toEqual(["error"]);
    expect(typeof body.error).toBe("string");
  }
});

test("routes reject every period but week and term, and never echo it", async () => {
  const bad = ["7d", "year", "all", "", "WEEK", "week,term", "1764115200", user(1)];
  for (const name of ROUTE_NAMES) {
    for (const value of bad) {
      const res = await call(presidentRoutes, name, `?period=${encodeURIComponent(value)}`);
      expect(res.status).toBe(400);
      expect(await res.text()).not.toMatch(/\d{15,}/);
    }
  }
});

test("routes accept week and term, and week when the period is missing", async () => {
  chat(users(1, 4), IN_WEEK);
  const routes = createPresidentRoutes(() => NOW);
  for (const name of ROUTE_NAMES) {
    for (const query of ["?period=week", "?period=term", "", "?other=1"]) {
      const res = await call(routes, name, query);
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toContain("application/json");
    }
    const missing = await (await call(routes, name)).json();
    const week = await (await call(routes, name, "?period=week")).json();
    expect(missing).toEqual(week);
  }
});

test("routes answer with what the queries return for the fixed period", async () => {
  setTermStart(TODAY - 20 * DAY);
  chat(users(1, 4), IN_WEEK);
  chat(users(5, 9), TODAY - 15 * DAY);
  voice(user(1), IN_WEEK, IN_WEEK + HOUR);
  const term: Period = { from: TODAY - 20 * DAY, to: TODAY };
  for (const [name, p] of [
    ["week", WEEK],
    ["term", term],
  ] as const) {
    const bodies = await callAll(() => NOW, name);
    expect(bodies.connection).toEqual(connection(p));
    expect(bodies.weekly).toEqual(weeklySeries(p));
    expect(bodies.groups).toEqual(groupSizes(p));
    expect(bodies.engagement).toEqual(engagement(p));
    expect(bodies.clubs).toEqual(clubEventHealth(p));
  }
  expect((await callAll(() => NOW, "week")).connection.connected).toBe(4);
  expect((await callAll(() => NOW, "term")).connection.connected).toBe(9);
});

test("a failure inside a handler is a plain 500 that says nothing about its cause", async () => {
  const logged = spyOn(console, "error").mockImplementation(() => {});
  try {
    const routes = createPresidentRoutes(() => {
      throw new Error(`cannot read ${user(1)} in ${channel(1)}`);
    });
    for (const name of ROUTE_NAMES) {
      const res = await call(routes, name, "?period=week");
      expect(res.status).toBe(500);
      expect(await res.json()).toEqual({ error: "internal error" });
    }
    // The cause goes to the server log, not to the president.
    expect(logged).toHaveBeenCalledTimes(ROUTE_NAMES.length);
  } finally {
    logged.mockRestore();
  }
});

test("the default routes work without an injected clock", async () => {
  for (const query of ["", "?period=week", "?period=term"]) {
    const res = await call(presidentRoutes, "connection", query);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ connected: 0, total: 0, groups: 0, bridges: 0, quiet: 0 });
  }
});

test("two requests minutes apart return identical numbers", async () => {
  setTermStart(TODAY - 40 * DAY);
  chat(users(1, 5), IN_WEEK);
  chat(users(6, 8), TODAY - 20 * DAY);
  for (const n of [9, 10, 11]) lastSeen(user(n), 33);
  for (const n of [1, 2, 3]) voice(user(n), IN_WEEK, IN_WEEK + 47 * MINUTE);
  // Connected since yesterday evening and still there at the first request.
  voice(user(4), TODAY - 3 * HOUR, null);
  club({ channelId: channel(31) });
  post(user(1), IN_WEEK, { channelId: channel(31) });
  const movie = event(IN_WEEK);
  attend(movie.id, 4);

  let clock = NOW;
  const before = { week: await callAll(() => clock, "week"), term: await callAll(() => clock, "term") };

  // Five minutes of live activity: none of it is in a period that ended at 00:00 UTC.
  clock = NOW + 5 * MINUTE;
  chat(users(20, 24), NOW + MINUTE);
  reply(user(9), user(1), NOW + 2 * MINUTE);
  closeVoiceSegment(user(4), NOW + 2 * MINUTE);
  voice(user(21), NOW + MINUTE, null);
  post(user(22), NOW + 3 * MINUTE, { channelId: channel(31) });
  recordMembership(user(10), "leave", NOW + 3 * MINUTE);
  db.insert(schema.eventParticipants).values({ eventId: movie.id, userId: user(160), createdAt: NOW + MINUTE }).run();

  const after = { week: await callAll(() => clock, "week"), term: await callAll(() => clock, "term") };
  expect(after).toEqual(before);

  // The numbers did have something to hold still.
  expect(before.week.connection).toEqual({ connected: 5, total: 5, groups: 1, bridges: 0, quiet: 3 });
  // In the term the three members who went quiet were still writing, each alone.
  expect(before.term.connection).toMatchObject({ connected: 8, total: 11, groups: 2, quiet: 3 });
  expect(before.week.clubs).toEqual({ clubsActive: null, clubsQuiet: null, eventsHeld: 1, avgAttendance: 4 });
  expect(before.week.engagement.voiceHours).toBe(5.4);
});

test("the numbers move once the UTC day has ended", async () => {
  chat(users(1, 4), IN_WEEK);
  const today = await callAll(() => NOW, "week");
  chat(users(5, 7), NOW);
  expect(await callAll(() => NOW + 5 * MINUTE, "week")).toEqual(today);
  const tomorrow = await callAll(() => TODAY + DAY + MINUTE, "week");
  expect(today.connection).toMatchObject({ connected: 4, groups: 1 });
  expect(tomorrow.connection).toMatchObject({ connected: 7, groups: 2 });
});

// --- privacy invariants -----------------------------------------------------

/** Everything a president could see about a busy server: both periods, all five routes. */
async function everyResponse() {
  return { week: await callAll(() => NOW, "week"), term: await callAll(() => NOW, "term") };
}

/** Seed a server with groups, a pair, loners, quiet members, clubs and events. */
function seedBusyServer() {
  setTermStart(TODAY - 50 * DAY);
  chat(users(1, 6), IN_WEEK);
  chat(users(7, 10), IN_WEEK + HOUR);
  chat(users(11, 12), IN_WEEK + 2 * HOUR);
  post(user(13), IN_WEEK + 3 * HOUR, { mentionedUserIds: [user(1), user(7)] });
  for (const n of [1, 7, 8]) reply(user(n), user(n === 1 ? 7 : 1), IN_WEEK + 4 * HOUR);
  reply(user(2), user(8), IN_WEEK + 4 * HOUR);
  reply(user(3), user(9), IN_WEEK + 4 * HOUR);
  chat(users(14, 18), TODAY - 20 * DAY, { channelId: channel(3), parentChannelId: TEXT });
  for (const n of [1, 2, 3, 14]) voice(user(n), IN_WEEK, IN_WEEK + 95 * MINUTE);
  voice(user(15), TODAY - 12 * DAY, TODAY - 12 * DAY + 20 * MINUTE);
  for (const n of [20, 21, 22, 23]) lastSeen(user(n), 35 + n);
  recordMembership(user(23), "leave", TODAY - 30 * DAY);
  recordMembership(user(1), "join", TODAY - 80 * DAY);

  for (const n of [1, 2, 3, 4]) {
    club({ name: `club ${user(n)}`, ownerId: user(n), channelId: channel(30 + n), threadId: channel(40 + n) });
  }
  for (const n of [1, 2, 3]) post(user(n), IN_WEEK, { channelId: channel(30 + n) });
  post(user(4), TODAY - 20 * DAY, { channelId: channel(44), parentChannelId: channel(45) });
  attend(event(IN_WEEK, { title: `party ${user(1)}`, channelId: channel(31) }).id, 5);
  attend(event(TODAY - 25 * DAY, { recurrence: "weekly" }).id, 3);
}

/** Every key and every leaf value of a JSON value, however deep. */
function walk(value: unknown, keys: string[], leaves: unknown[]) {
  if (Array.isArray(value)) {
    for (const item of value) walk(item, keys, leaves);
  } else if (value !== null && typeof value === "object") {
    for (const [key, item] of Object.entries(value)) {
      keys.push(key);
      walk(item, keys, leaves);
    }
  } else {
    leaves.push(value);
  }
}

test("no president response holds an id, a name or anything but numbers", async () => {
  seedBusyServer();
  const routes = createPresidentRoutes(() => NOW);
  let checked = 0;
  for (const name of ROUTE_NAMES) {
    for (const query of ["", "?period=week", "?period=term"]) {
      const res = await call(routes, name, query);
      expect(res.status).toBe(200);
      const text = await res.text();
      // No snowflake-like run of digits, in a key or in a value.
      expect(text).not.toMatch(/\d{15,}/);

      const keys: string[] = [];
      const leaves: unknown[] = [];
      walk(JSON.parse(text), keys, leaves);
      for (const key of keys) {
        expect(key).not.toMatch(/userId|channelId|name|id$/i);
      }
      // Numbers and hidden numbers only: no string could carry a name.
      for (const leaf of leaves) {
        expect(leaf === null || (typeof leaf === "number" && Number.isFinite(leaf))).toBe(true);
      }
      expect(leaves.length).toBeGreaterThan(0);
      checked += 1;
    }
  }
  expect(checked).toBe(15);

  // The seed was worth checking: every route had real numbers to show.
  const { week, term } = await everyResponse();
  expect(week.groups).toEqual({ sizes: [7, 4], other: 3 });
  expect(week.connection).toEqual({ connected: 11, total: 14, groups: 2, bridges: 4, quiet: 3 });
  expect(term.groups).toEqual({ sizes: [7, 4, 4], other: 3 });
  expect(term.connection).toEqual({ connected: 15, total: 18, groups: 3, bridges: 8, quiet: 3 });
  expect(week.engagement.messages).toBeGreaterThan(20);
  expect(week.engagement.voiceHours).toBeGreaterThan(0);
  expect(week.clubs).toEqual({ clubsActive: null, clubsQuiet: null, eventsHeld: 2, avgAttendance: 4 });
  expect(term.clubs).toMatchObject({ clubsActive: 4, clubsQuiet: 0 });
});

test("no count of one or two members is ever shown", async () => {
  // One quiet member, one bridge, a pair, a club count of one and an event with two signed up.
  chat(users(1, 4), IN_WEEK);
  chat(users(5, 7), IN_WEEK + HOUR);
  reply(user(1), user(5), IN_WEEK + 2 * HOUR);
  chat(users(8, 9), IN_WEEK + 3 * HOUR);
  lastSeen(user(20), 40);
  club({ channelId: channel(31) });
  attend(event(IN_WEEK).id, 2);

  const { week } = await everyResponse();
  expect(week.connection).toEqual({ connected: 7, total: null, groups: 2, bridges: null, quiet: null });
  expect(week.groups).toEqual({ sizes: [4, 3], other: null });
  expect(week.engagement.activeMembers).toBeNull();
  expect(week.clubs).toEqual({ clubsActive: null, clubsQuiet: null, eventsHeld: 1, avgAttendance: null });
});

/**
 * The published totals of one period that count nested sets of members: the
 * members of the shown groups, those plus `other`, connected, total and active.
 * The difference of any two of them is a count of members too.
 */
function nestedCounts(bodies: Awaited<ReturnType<typeof callAll>>): number[] {
  const shown = sum(bodies.groups.sizes);
  const counts = [shown];
  if (bodies.groups.other !== null) counts.push(shown + bodies.groups.other);
  for (const value of [bodies.connection.connected, bodies.connection.total, bodies.engagement.activeMembers]) {
    if (value !== null) counts.push(value);
  }
  return counts;
}

/** Fail when one of the counts, or the difference of any two of them, is 1 or 2. */
function expectNoSmallRemainder(counts: number[]) {
  for (const a of counts) {
    expect([1, 2]).not.toContain(a);
    for (const b of counts) expect([1, 2]).not.toContain(Math.abs(a - b));
  }
}

test("a hidden remainder cannot be recovered by subtraction", async () => {
  /** What is seeded next to one shown group of six, and how many members that hides. */
  const scenarios: { name: string; hidden: number; seed: () => void }[] = [
    { name: "a pair", hidden: 2, seed: () => chat(users(11, 12), IN_WEEK + HOUR) },
    { name: "one member alone", hidden: 1, seed: () => post(user(11), IN_WEEK + HOUR) },
    {
      name: "two members alone",
      hidden: 2,
      seed: () => {
        post(user(11), IN_WEEK + HOUR);
        post(user(12), IN_WEEK + HOUR);
      },
    },
    { name: "one member only in voice", hidden: 1, seed: () => voice(user(11), IN_WEEK, IN_WEEK + HOUR) },
  ];

  for (const scenario of scenarios) {
    reset();
    chat(users(1, 6), IN_WEEK);
    scenario.seed();
    const { week, term } = await everyResponse();

    for (const bodies of [week, term]) {
      // What is shown: the group of six. The remainder is hidden, not 0.
      expect(bodies.groups).toEqual({ sizes: [6], other: null });
      expect(bodies.connection).toMatchObject({ connected: 6, groups: 1 });

      // The attempts: every total a president could put against the shown groups.
      const shown = sum(bodies.groups.sizes);
      const totals = [bodies.connection.total, bodies.engagement.activeMembers];
      for (const total of totals) {
        if (total === null) continue;
        expect([1, 2]).not.toContain(total - shown);
        expect([1, 2]).not.toContain(total - bodies.connection.connected!);
        expect(total - shown).not.toBe(scenario.hidden);
      }
      expectNoSmallRemainder(nestedCounts(bodies));

      // How it is prevented here: the totals that would give it away are hidden too.
      expect(totals).toEqual([null, null]);
    }
  }
});

test("a remainder of three or more is shown, and the arithmetic comes out even", async () => {
  chat(users(1, 6), IN_WEEK);
  chat(users(11, 12), IN_WEEK + HOUR);
  post(user(13), IN_WEEK + HOUR);
  const { week } = await everyResponse();
  expect(week.groups).toEqual({ sizes: [6], other: 3 });
  expect(week.connection).toMatchObject({ connected: 6, total: 9 });
  expect(week.engagement.activeMembers).toBe(9);
  // total = shown groups + other, exactly: nothing is left over to find.
  expect(week.connection.total! - sum(week.groups.sizes) - week.groups.other!).toBe(0);
  expect(week.connection.total! - week.connection.connected!).toBe(3);
  expectNoSmallRemainder(nestedCounts(week));
});

test("the published member counts always add up, whatever is hidden", async () => {
  // Groups of 5, 4 and 3 next to 0 to 4 members outside any group.
  for (let outside = 0; outside <= 4; outside++) {
    reset();
    chat(users(1, 5), IN_WEEK);
    chat(users(11, 14), IN_WEEK + HOUR);
    chat(users(21, 23), IN_WEEK + 2 * HOUR);
    for (let i = 0; i < outside; i++) post(user(31 + i), IN_WEEK + 3 * HOUR);

    const { week } = await everyResponse();
    const hidden = outside === 1 || outside === 2;
    expect(week.groups).toEqual({ sizes: [5, 4, 3], other: hidden ? null : outside });
    expect(week.connection.connected).toBe(12);
    expect(week.connection.total).toBe(hidden ? null : 12 + outside);
    expect(week.engagement.activeMembers).toBe(week.connection.total);
    if (week.connection.total !== null) {
      expect(week.connection.total).toBe(sum(week.groups.sizes) + week.groups.other!);
    }
    expectNoSmallRemainder(nestedCounts(week));
  }
});

test("sixty scrambled servers: the counts are right, and never give a small one away", async () => {
  // A fixed pseudo-random sequence: the same sixty servers on every run.
  let state = 20261126;
  const next = (bound: number) => {
    state = (state * 1103515245 + 12345) % 2147483648;
    return state % bound;
  };

  let hiddenRounds = 0;
  let shownRounds = 0;
  for (let round = 0; round < 60; round++) {
    reset();
    // Counted here, independently of the queries: who wrote or was in voice.
    const active = new Set<string>();
    const members = 2 + next(14);
    const replies = next(40);
    for (let i = 0; i < replies; i++) {
      const from = user(1 + next(members));
      reply(from, user(1 + next(members)), IN_WEEK + next(DAY));
      active.add(from);
    }
    const posts = next(4);
    for (let i = 0; i < posts; i++) {
      const author = user(1 + next(members));
      post(author, IN_WEEK + next(DAY));
      active.add(author);
    }
    const inVoice = next(5);
    for (let i = 0; i < inVoice; i++) {
      const start = IN_WEEK + next(HOUR);
      voice(user(21 + i), start, start + 5 * MINUTE + next(HOUR), next(2) === 0 ? VOICE : channel(22));
      active.add(user(21 + i));
    }

    const { week } = await everyResponse();
    const shown = sum(week.groups.sizes);
    const rest = active.size - shown;

    for (const size of week.groups.sizes) expect(size).toBeGreaterThanOrEqual(3);
    expect(week.groups.sizes).toEqual([...week.groups.sizes].sort((a, b) => b - a));
    expect(week.connection.connected).toBe(shown);
    expect(week.connection.groups).toBe(week.groups.sizes.length);
    expect(rest).toBeGreaterThanOrEqual(0);
    if (rest === 1 || rest === 2) {
      hiddenRounds += 1;
      expect(week.groups.other).toBeNull();
      expect(week.connection.total).toBeNull();
      expect(week.engagement.activeMembers).toBeNull();
    } else {
      shownRounds += 1;
      expect(week.groups.other).toBe(rest);
      expect(week.connection.total).toBe(active.size);
      expect(week.engagement.activeMembers).toBe(active.size);
    }
    expect([1, 2]).not.toContain(week.connection.bridges);
    expect(week.connection.quiet).toBe(0);
    expect(week.engagement.messages).toBe(replies + posts);
    expectNoSmallRemainder(nestedCounts(week));
  }
  // Both cases came up often enough to mean something.
  expect(hiddenRounds).toBeGreaterThan(5);
  expect(shownRounds).toBeGreaterThan(5);
});

// --- the route file ---------------------------------------------------------

test("the route file imports only the president queries and the group detection", async () => {
  const source = await Bun.file(new URL("../api/president.ts", import.meta.url)).text();

  const imports = [...source.matchAll(/^import\s+(type\s+)?[^;]*?\sfrom\s+"([^"]+)";/gms)].map((match) => ({
    typeOnly: match[1] !== undefined,
    from: match[2]!,
  }));
  expect(imports.length).toBeGreaterThan(0);
  // Every way of loading a module is one of the imports found above.
  expect(source.match(/\bfrom\s+["']/g)?.length).toBe(imports.length);
  expect(source).not.toMatch(/\bimport\s*\(/);
  expect(source).not.toMatch(/\brequire\s*\(/);
  expect(source).not.toMatch(/^import\s+["']/m);

  const valueImports = imports.filter((i) => !i.typeOnly).map((i) => i.from);
  for (const from of valueImports) {
    expect(["../queries/president.ts", "../groups.ts"]).toContain(from);
  }
  expect(valueImports).toContain("../queries/president.ts");
  // Types may also come from the plugin contract and the shared response types.
  for (const { from } of imports) {
    expect(["../queries/president.ts", "../groups.ts", "../../../core/plugin.ts", "../types/president.ts"]).toContain(
      from,
    );
  }

  expect(source).not.toMatch(/queries\/admin/);
  expect(source).not.toMatch(/queries\/user/);
  expect(source).not.toMatch(/db\/index|schema/);
});
