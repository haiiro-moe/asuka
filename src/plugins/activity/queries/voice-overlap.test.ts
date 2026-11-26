/**
 * Characterisation tests for the shared voice-overlap sweep.
 *
 * The three self-join implementations it replaced (admin `voiceEdges`, the
 * member Wrapped `voiceOverlaps` and the server Wrapped `bestPairOf`) are kept
 * here verbatim as SQL, and every test asserts that the sweep gives the same
 * answer on the same seeded data.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { and, eq, gt, lt, ne, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/sqlite-core";
import { db, initDb, schema } from "../../../db/index.ts";
import { notExcluded } from "../exclusion.ts";
import { recordMessage } from "../record.ts";
import type { Period } from "../time.ts";
import { msg } from "../wrapped/testing.ts";
import { VOICE_OVERLAP_SECONDS_PER_POINT } from "../wrapped/data.ts";
import { bestPairOf } from "../wrapped/server.ts";
import { relations } from "./admin.ts";
import { memberVoiceOverlaps, sharedVoiceSeconds, voicePairs, voiceSpansIn } from "./voice-overlap.ts";

const touched = [schema.activityVoice, schema.activityMessages, schema.activityMentions, schema.activityEmoji];

/** Set the excluded-channel list. */
function setExcluded(list: string) {
  db.update(schema.guildConfig).set({ activityExcludedChannelIds: list }).where(eq(schema.guildConfig.id, 1)).run();
}

/** Insert one voice segment. `end` null leaves it open, running to `lastSeen`. */
function seg(userId: string, channelId: string, start: number, end: number | null, lastSeen = end ?? start) {
  db.insert(schema.activityVoice)
    .values({ userId, channelId, startedAt: start, endedAt: end, lastSeenAt: lastSeen })
    .run();
}

// ---------------------------------------------------------------------------
// The old implementations, copied as they were.
// ---------------------------------------------------------------------------

/** Old `queries/admin.ts` voiceEdges. */
function oldVoiceEdges(p: Period): { from: string; to: string; weight: number }[] {
  const v = schema.activityVoice;
  const a = alias(v, "a");
  const b = alias(v, "b");
  const aEnd = sql`coalesce(${a.endedAt}, ${a.lastSeenAt})`;
  const bEnd = sql`coalesce(${b.endedAt}, ${b.lastSeenAt})`;
  const overlap = sql<number>`sum(min(${aEnd}, ${bEnd}, ${p.to}) - max(${a.startedAt}, ${b.startedAt}, ${p.from}))`;
  return db
    .select({ from: a.userId, to: b.userId, weight: overlap })
    .from(a)
    .innerJoin(b, and(eq(a.channelId, b.channelId), lt(a.userId, b.userId), lt(a.startedAt, bEnd), lt(b.startedAt, aEnd)))
    .where(and(lt(a.startedAt, p.to), gt(aEnd, p.from), lt(b.startedAt, p.to), gt(bEnd, p.from), notExcluded(a.channelId)))
    .groupBy(a.userId, b.userId)
    .all()
    .map((e) => ({ ...e, weight: Number(e.weight) }));
}

/** Old `wrapped/data.ts` voiceOverlaps. */
function oldVoiceOverlaps(userId: string, from: number, to: number): { userId: string; seconds: number }[] {
  const v = schema.activityVoice;
  const o = alias(schema.activityVoice, "other_voice");
  const vEnd = sql`coalesce(${v.endedAt}, ${v.lastSeenAt})`;
  const oEnd = sql`coalesce(${o.endedAt}, ${o.lastSeenAt})`;
  const rows = db
    .select({
      userId: o.userId,
      seconds: sql<number>`sum(max(0, min(${vEnd}, ${oEnd}, ${to}) - max(${v.startedAt}, ${o.startedAt}, ${from})))`,
    })
    .from(v)
    .innerJoin(o, and(eq(o.channelId, v.channelId), ne(o.userId, v.userId), sql`${o.startedAt} < ${vEnd}`, sql`${oEnd} > ${v.startedAt}`))
    .where(and(eq(v.userId, userId), lt(v.startedAt, to), gt(vEnd, from), notExcluded(v.channelId)))
    .groupBy(o.userId)
    .all();
  return rows.map((row) => ({ userId: row.userId, seconds: Number(row.seconds) }));
}

/** Old `wrapped/server.ts` bestPairOf. */
function oldBestPairOf(from: number, to: number, voiceReady: boolean) {
  const m = schema.activityMessages;
  const v1 = alias(schema.activityVoice, "v1");
  const v2 = alias(schema.activityVoice, "v2");
  const e1 = sql`coalesce(${v1.endedAt}, ${v1.lastSeenAt})`;
  const e2 = sql`coalesce(${v2.endedAt}, ${v2.lastSeenAt})`;
  const [row] = db.all<{ a: string; b: string; replies: number; seconds: number }>(sql`
    select a, b, sum(replies) as replies, sum(seconds) as seconds from (
      select min(${m.userId}, ${m.replyToUserId}) as a, max(${m.userId}, ${m.replyToUserId}) as b,
             count(*) as replies, 0 as seconds
      from ${m}
      where ${m.ts} >= ${from} and ${m.ts} < ${to}
        and ${m.replyToUserId} is not null and ${m.replyToUserId} != ${m.userId}
        and ${notExcluded(m.channelId, m.parentChannelId)}
      group by a, b
      ${voiceReady ? sql`union all
      select ${v1.userId} as a, ${v2.userId} as b, 0 as replies,
             sum(max(0, min(${e1}, ${e2}, ${to}) - max(${v1.startedAt}, ${v2.startedAt}, ${from}))) as seconds
      from ${schema.activityVoice} as "v1" join ${schema.activityVoice} as "v2"
        on ${v2.channelId} = ${v1.channelId} and ${v1.userId} < ${v2.userId}
        and ${v2.startedAt} < ${e1} and ${e2} > ${v1.startedAt}
      where ${v1.startedAt} < ${to} and ${e1} > ${from} and ${notExcluded(v1.channelId)}
      group by a, b` : sql``}
    )
    group by a, b
    having sum(replies) + sum(seconds) > 0
    order by sum(replies) + sum(seconds) * 1.0 / ${VOICE_OVERLAP_SECONDS_PER_POINT} desc, a, b
    limit 1
  `);
  if (!row) return null;
  return { aId: row.a, bId: row.b, replies: Number(row.replies), seconds: Number(row.seconds) };
}

/** The old admin edges as `relations()` merged and sorted them. */
function oldRelations(p: Period) {
  return oldVoiceEdges(p)
    .map((e) => ({ a: e.from, b: e.to, weight: e.weight }))
    .sort((x, y) => y.weight - x.weight || x.a.localeCompare(y.a) || x.b.localeCompare(y.b))
    .slice(0, 50);
}

/** Sort pairs for comparison. */
const byPair = <T extends { a: string; b: string }>(list: T[]) =>
  [...list].sort((x, y) => x.a.localeCompare(y.a) || x.b.localeCompare(y.b));

// ---------------------------------------------------------------------------

/** Periods the comparisons run over: whole range, cutting through segments, tiny. */
const PERIODS: Period[] = [
  { from: 0, to: 2000 },
  { from: 200, to: 750 },
  { from: 460, to: 470 },
  { from: 850, to: 1200 },
  { from: 5000, to: 6000 },
];

const USERS = ["u1", "u2", "u3", "u4", "u5", "u6", "u7", "u8"];

/** The seeded dataset every comparison uses. */
function seed() {
  // Three people overlapping in v1, one of them with two segments of their own.
  seg("u1", "v1", 100, 500);
  seg("u1", "v1", 450, 480);
  seg("u2", "v1", 300, 800);
  seg("u3", "v1", 400, 450);
  // An open segment, running to its lastSeenAt.
  seg("u4", "v1", 700, null, 900);
  // Long segments crossing every period boundary.
  seg("u5", "v2", 50, 1000);
  seg("u6", "v2", 150, 260);
  seg("u6", "v2", 740, 1100);
  // Alone in a channel.
  seg("u7", "v3", 200, 400);
  // An excluded channel: never counted.
  seg("u1", "vx", 300, 400);
  seg("u2", "vx", 300, 400);
  // Same seconds, different channel: no overlap.
  seg("u8", "v4", 300, 800);
  // Replies, one in a thread under the excluded channel.
  recordMessage(msg("u7", 300, { replyToUserId: "u8" }));
  recordMessage(msg("u7", 310, { replyToUserId: "u8" }));
  recordMessage(msg("u8", 320, { replyToUserId: "u7" }));
  for (let i = 0; i < 5; i++) recordMessage(msg("u1", 330 + i, { replyToUserId: "u2", channelId: "t1", parentChannelId: "vx" }));
}

beforeAll(() => {
  initDb();
});

beforeEach(() => {
  for (const t of touched) db.delete(t).run();
  setExcluded("");
});

afterAll(() => {
  for (const t of touched) db.delete(t).run();
  setExcluded("");
});

describe("the sweep matches the old self-joins", () => {
  test("admin relations voice: same pairs and weights in every period", () => {
    seed();
    setExcluded("vx");
    for (const p of PERIODS) {
      expect(relations(p, "voice", true)).toEqual(oldRelations(p));
      expect(byPair(voicePairs(voiceSpansIn(p)).map((x) => ({ a: x.a, b: x.b, weight: x.seconds })))).toEqual(
        byPair(oldRelations(p)),
      );
    }
  });

  test("member overlaps: same counterparts and seconds for every member and period", () => {
    seed();
    setExcluded("vx");
    for (const p of PERIODS) {
      for (const u of USERS) {
        const old = oldVoiceOverlaps(u, p.from, p.to)
          .filter((r) => r.seconds > 0)
          .sort((x, y) => x.userId.localeCompare(y.userId));
        expect(memberVoiceOverlaps(u, p)).toEqual(old);
      }
    }
  });

  test("server best pair: same pair, replies and seconds, voice ready or not", () => {
    seed();
    setExcluded("vx");
    for (const p of PERIODS) {
      for (const ready of [true, false]) {
        expect(bestPairOf(p.from, p.to, ready)).toEqual(oldBestPairOf(p.from, p.to, ready));
      }
    }
  });

  test("without an exclusion list the excluded channel counts again, still matching", () => {
    seed();
    for (const p of PERIODS) {
      expect(relations(p, "voice", true)).toEqual(oldRelations(p));
      expect(bestPairOf(p.from, p.to, true)).toEqual(oldBestPairOf(p.from, p.to, true));
      for (const u of USERS) {
        const old = oldVoiceOverlaps(u, p.from, p.to)
          .filter((r) => r.seconds > 0)
          .sort((x, y) => x.userId.localeCompare(y.userId));
        expect(memberVoiceOverlaps(u, p)).toEqual(old);
      }
    }
  });

  test("a member alone has no overlaps, and an empty log has no pairs", () => {
    expect(relations(PERIODS[0]!, "voice", true)).toEqual([]);
    expect(bestPairOf(0, 2000, true)).toBeNull();
    seed();
    expect(memberVoiceOverlaps("u7", PERIODS[0]!)).toEqual([]);
  });

  test("the voice-readiness gate: no voice pairs when voice is not ready", () => {
    seed();
    expect(relations(PERIODS[0]!, "voice", false)).toEqual([]);
    // The best pair then comes from replies alone; the thread under vx counts until vx is excluded.
    expect(bestPairOf(0, 2000, false)).toEqual({ aId: "u1", bId: "u2", replies: 5, seconds: 0 });
    setExcluded("vx");
    expect(bestPairOf(0, 2000, false)).toEqual({ aId: "u7", bId: "u8", replies: 3, seconds: 0 });
  });
});

describe("sharedVoiceSeconds", () => {
  test("three people overlapping: every pair gets its own overlap", () => {
    const spans = [
      { userId: "a", channelId: "c", start: 0, end: 10 },
      { userId: "b", channelId: "c", start: 5, end: 15 },
      { userId: "c", channelId: "c", start: 8, end: 9 },
    ];
    const out = sharedVoiceSeconds(spans);
    expect(out.get("a")?.get("b")).toBe(5);
    expect(out.get("a")?.get("c")).toBe(1);
    expect(out.get("b")?.get("c")).toBe(1);
  });

  test("onlyUserId keeps only that member's pairs", () => {
    const spans = [
      { userId: "a", channelId: "c", start: 0, end: 10 },
      { userId: "b", channelId: "c", start: 0, end: 10 },
      { userId: "c", channelId: "c", start: 0, end: 10 },
    ];
    const out = sharedVoiceSeconds(spans, "c");
    expect(out.get("a")?.get("b")).toBeUndefined();
    expect(out.get("a")?.get("c")).toBe(10);
    expect(out.get("b")?.get("c")).toBe(10);
  });
});

test("performance: the admin voice relations over 20k segments in 40 channels finish in under 2 s", () => {
  const sqlite = db.$client;
  const insert = sqlite.prepare(
    "INSERT INTO activity_voice (user_id, channel_id, started_at, ended_at, last_seen_at) VALUES (?, ?, ?, ?, ?)",
  );
  // A fixed pseudo-random sequence, so the data is the same on every run.
  let state = 42;
  const rand = (n: number) => {
    state = (state * 1103515245 + 12345) % 2147483648;
    return state % n;
  };
  const YEAR_START = 1_767_225_600;
  sqlite.transaction(() => {
    for (let i = 0; i < 20_000; i++) {
      const start = YEAR_START + rand(365 * 86400);
      const end = start + 60 + rand(4 * 3600);
      insert.run(`u${rand(400)}`, `v${rand(40)}`, start, end, end);
    }
  })();
  const p = { from: YEAR_START, to: YEAR_START + 365 * 86400 };
  const t0 = performance.now();
  const pairs = relations(p, "voice", true);
  const ms = performance.now() - t0;
  expect(pairs.length).toBeGreaterThan(0);
  expect(ms).toBeLessThan(2000);
});
