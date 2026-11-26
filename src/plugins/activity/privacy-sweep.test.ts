/**
 * Privacy sweep over the president tier.
 *
 * Calls every route whose `access` is `"president"` (found through the
 * plugin's exported route list, so a new route cannot be missed) for both
 * fixed periods, on several seeded servers, and checks the serialised JSON:
 * no id, no name, no key that names an id, no count of one or two members
 * where the docs require hiding, and no zero standing in for voice that is
 * not ready. The rules are in docs/activity/queries-president.md.
 */
import { afterAll, beforeAll, beforeEach, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import type { ApiContext } from "../../core/plugin.ts";
import { db, initDb, schema } from "../../db/index.ts";
import { activityRoutes } from "./api.ts";
import { createPresidentRoutes } from "./api/president.ts";
import type { MessageFacts } from "./facts.ts";
import { closeVoiceSegment, openVoiceSegment, recordMembership, recordMessage } from "./record.ts";

const MINUTE = 60;
const HOUR = 3600;
const DAY = 86400;
/** Thursday 26 Nov 2026, 15:30 UTC. */
const NOW = Date.UTC(2026, 10, 26, 15, 30) / 1000;
/** Today 00:00 UTC: where both president periods end. */
const TODAY = Date.UTC(2026, 10, 26) / 1000;
const IN_WEEK = TODAY - 2 * DAY;

const snowflake = (lead: number, n: number) => `${lead}${String(n).padStart(17, "0")}`;
const user = (n: number) => snowflake(9, n);
const channel = (n: number) => snowflake(8, n);
const users = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => user(from + i));

/** Display names and usernames of the seeded members. Stored where a name can live (club names, event titles). */
const NAMES = ["Mirei Hoshino", "kuroneko_77", "Tanaka Ren", "sora-chan", "Bot Yuki", "pixelwitch", "Haru Ito"];

const touched = [
  schema.activityMessages,
  schema.activityMentions,
  schema.activityEmoji,
  schema.activityVoice,
  schema.activityMembership,
  schema.eventParticipants,
  schema.events,
  schema.clubs,
];

function reset() {
  for (const table of touched) db.delete(table).run();
  db.update(schema.guildConfig).set({ activityExcludedChannelIds: "" }).where(eq(schema.guildConfig.id, 1)).run();
  db.update(schema.president).set({ termStart: null }).where(eq(schema.president.id, 1)).run();
}

let nextId = 0;
function post(userId: string, ts: number, over: Partial<MessageFacts> = {}) {
  nextId += 1;
  recordMessage({
    messageId: snowflake(7, nextId),
    userId,
    channelId: channel(1),
    parentChannelId: null,
    ts,
    replyToUserId: null,
    replyToMessageId: null,
    mentionedUserIds: [],
    attachmentKinds: [],
    linkDomains: [],
    stickerCount: 0,
    length: 12,
    emoji: [{ emoji: "custom:123456789012345678", name: "pog", count: 1 }],
    source: "live",
    ...over,
  });
}

function chat(ids: string[], ts: number, over: Partial<MessageFacts> = {}) {
  for (const a of ids) for (const b of ids) if (a !== b) post(a, ts, { replyToUserId: b, replyToMessageId: snowflake(6, 1), ...over });
}

function voice(userId: string, start: number, end: number, channelId = channel(2)) {
  openVoiceSegment(userId, { channelId, muted: false, deafened: false, streaming: false, video: false }, start);
  closeVoiceSegment(userId, end);
}

function club(name: string, over: Partial<typeof schema.clubs.$inferInsert> = {}) {
  return db
    .insert(schema.clubs)
    .values({ name, ownerId: user(1), status: "approved", createdAt: TODAY - 60 * DAY, ...over })
    .returning()
    .get();
}

function event(startAt: number, title: string, signups: number) {
  const row = db
    .insert(schema.events)
    .values({ title, startAt, createdBy: user(1), createdAt: startAt - 10 * DAY })
    .returning()
    .get();
  for (let i = 0; i < signups; i++) {
    db.insert(schema.eventParticipants).values({ eventId: row.id, userId: user(100 + i), createdAt: TODAY - 20 * DAY }).run();
  }
}

/** Voice ready: a segment 150 days back. Young: the first segment is 12 days old. */
function seed(shape: "busy" | "small", voiceReady: boolean) {
  reset();
  if (voiceReady) voice(user(99), TODAY - 150 * DAY, TODAY - 150 * DAY + MINUTE, channel(98));
  db.update(schema.president).set({ termStart: TODAY - 50 * DAY }).where(eq(schema.president.id, 1)).run();
  voice(user(15), TODAY - 12 * DAY, TODAY - 12 * DAY + 20 * MINUTE);
  if (shape === "busy") {
    chat(users(1, 6), IN_WEEK); // group of 6
    chat(users(7, 10), IN_WEEK + HOUR); // group of 4
    chat(users(11, 13), IN_WEEK + 2 * HOUR, { channelId: channel(3), parentChannelId: channel(1) }); // group of 3 in a thread
    chat(users(14, 15), IN_WEEK + 3 * HOUR); // a pair
    post(user(16), IN_WEEK + 4 * HOUR, { mentionedUserIds: [user(1)] }); // a lone member
    for (const n of [1, 2, 3]) voice(user(n), IN_WEEK, IN_WEEK + 95 * MINUTE);
    for (const n of [20, 21, 22, 23]) post(user(n), TODAY - 80 * DAY);
    recordMembership(user(23), "leave", TODAY - 30 * DAY);
    for (const n of [1, 2, 3, 4]) club(`${NAMES[n - 1]} club`, { channelId: channel(30 + n) });
    for (const n of [1, 2, 3]) post(user(n), IN_WEEK, { channelId: channel(30 + n) });
    event(IN_WEEK, `${NAMES[0]} party`, 5);
  } else {
    // Counts of one and two on purpose: a pair, one lone member, one quiet, one club, an event with two.
    chat(users(1, 2), IN_WEEK);
    post(user(3), IN_WEEK);
    post(user(4), TODAY - 40 * DAY);
    club(`${NAMES[1]}'s corner`, { channelId: channel(31) });
    post(user(1), IN_WEEK, { channelId: channel(31) });
    event(IN_WEEK, `${NAMES[2]} movie night`, 2);
  }
}

const CTX = { params: {}, session: { userId: user(1), role: "president" } } as unknown as ApiContext;

/** Fields that count members, pairs or clubs and must never be 1 or 2. */
const HIDDEN_COUNTS = new Set(["connected", "total", "bridges", "quiet", "other", "clubsActive", "clubsQuiet", "activeMembers"]);

function walk(value: unknown, path: string, visit: (key: string, leaf: unknown, parent: string) => void) {
  if (Array.isArray(value)) {
    value.forEach((item) => walk(item, path, visit));
  } else if (value !== null && typeof value === "object") {
    for (const [key, item] of Object.entries(value)) {
      if (item !== null && typeof item === "object") walk(item, key, visit);
      else visit(key, item, path);
    }
  }
}

beforeAll(() => {
  initDb();
});
beforeEach(reset);
afterAll(reset);

test("every president route is swept, in both periods, on every seeded server", async () => {
  const listed = activityRoutes.filter((r) => r.access === "president");
  expect(listed.length).toBeGreaterThan(0);
  const clocked = createPresidentRoutes(() => NOW);
  const swept = new Set<string>();
  let shown = 0;
  let hidden = 0;

  for (const shape of ["busy", "small"] as const) {
    for (const voiceReady of [true, false]) {
      seed(shape, voiceReady);
      for (const period of ["week", "term"]) {
        for (const listedRoute of listed) {
          const route = clocked.find((r) => r.path === listedRoute.path);
          expect(route, `no clocked twin of ${listedRoute.path}`).toBeDefined();
          const res = await route!.handle(new Request(`http://asuka.test${route!.path}?period=${period}`), CTX);
          expect(res.status).toBe(200);
          const text = await res.text();
          swept.add(listedRoute.path);

          // (a) no snowflake-like id, no seeded name.
          expect(text).not.toMatch(/\d{15,}/);
          for (const name of NAMES) expect(text.toLowerCase()).not.toContain(name.toLowerCase());

          const body = JSON.parse(text) as Record<string, unknown>;
          walk(body, "", (key, leaf, parent) => {
            // (d) no key that names an id (the docs show presidents no channel ids either).
            expect(key).not.toMatch(/userId|channelId|memberId|name|id$/i);
            expect(leaf === null || typeof leaf === "number").toBe(true);
            // (b) counts of members, pairs and clubs are hidden at 1 and 2.
            if (HIDDEN_COUNTS.has(key)) expect(leaf === 1 || leaf === 2).toBe(false);
            if (key === "avgAttendance" && typeof leaf === "number") expect(leaf > 0 && leaf < 3).toBe(false);
            void parent;
            if (HIDDEN_COUNTS.has(key)) leaf === null ? (hidden += 1) : (shown += 1);
          });
          // Groups under three are never listed.
          if (Array.isArray(body.sizes)) for (const size of body.sizes as number[]) expect(size).toBeGreaterThanOrEqual(3);

          // (c) voice not ready: null, never 0 or a list of zeros.
          if (!voiceReady && "voiceHours" in body) expect(body.voiceHours).toBeNull();
        }
      }
    }
  }

  // A president route that was never exercised fails the sweep.
  expect([...swept].sort()).toEqual(listed.map((r) => r.path).sort());
  expect(swept.size).toBe(clocked.length);
  // The seeds exercised both outcomes: counts that were shown and counts that were hidden.
  expect(shown).toBeGreaterThan(0);
  expect(hidden).toBeGreaterThan(0);
});
