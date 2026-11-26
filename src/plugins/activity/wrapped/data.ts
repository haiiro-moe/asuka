/**
 * Builds a member's Wrapped snapshot from the activity log.
 *
 * Everything here is a read. The numbers come only from the member's own rows
 * (their messages, the emoji they used, the reactions they added, their voice
 * segments). The soulmate and most-replied-to fields read the counterpart ids on those rows
 * (who they replied to and mentioned) and the voice segments that overlap the
 * member's own; the snapshot keeps only the winning id, never a number about
 * the other member. Excluded channels, and threads under them, are left out.
 *
 * See docs/activity/wrapped.md.
 *
 * @packageDocumentation
 */
import { and, asc, count, desc, eq, gt, gte, isNotNull, isNull, lt, ne, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/sqlite-core";
import { db, schema } from "../../../db/index.ts";
import { notExcluded } from "../exclusion.ts";
import type { Period } from "../time.ts";
import type { WrappedData, WrappedEmoji } from "../types/wrapped.ts";
import { clubFor, clubYearStats, presidencyFor, presidencyTermsIn, yearPeriod } from "./extras.ts";
import type { ClubYearStats, TermInYear } from "./extras.ts";
import { titleAwards, titlesFor } from "./titles.ts";
import type { TitleAward } from "./titles.ts";
import { voiceReadiness } from "../voice-ready.ts";

/** How many emoji a snapshot lists. */
const TOP_EMOJI = 3;

/**
 * Seconds in voice together that weigh as much as one reply or one mention
 * when picking the soulmate (ten minutes).
 */
export const VOICE_OVERLAP_SECONDS_PER_POINT = 600;

/** Weekday names by SQLite `strftime('%w')` (0 = Sunday). */
const WEEKDAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];

/**
 * The UTC calendar year as a period.
 *
 * @param year - The year, e.g. 2026.
 * @returns `from` = 1 Jan 00:00:00 UTC (inclusive), `to` = the next 1 Jan 00:00:00 UTC (exclusive).
 */
export function yearBounds(year: number): Period {
  return yearPeriod(year);
}

/**
 * Year aggregates shared by every member's snapshot: club stats, presidency
 * terms and title winners. A run computes them once with
 * {@link wrappedShared} and passes them to {@link buildWrapped}.
 */
export interface WrappedShared {
  /** {@link clubYearStats} for the year. */
  clubs: ClubYearStats[];
  /** {@link presidencyTermsIn} for the year. */
  terms: TermInYear[];
  /** {@link titleAwards} for the year. */
  awards: TitleAward[];
  /**
   * Whether voice figures may be shown (`voiceReadiness().ready`, checked once
   * per run). When false every voice-derived figure is left out.
   */
  voiceReady: boolean;
}

/**
 * Compute the year aggregates every member's snapshot needs.
 *
 * @param year - The UTC calendar year.
 * @param voiceReady - Whether voice figures may be shown; a run checks
 *   `voiceReadiness()` once and passes it. Left out, it is checked here.
 */
export function wrappedShared(year: number, voiceReady: boolean = voiceReadiness().ready): WrappedShared {
  const clubs = clubYearStats(year, voiceReady);
  const terms = presidencyTermsIn(year);
  return { clubs, terms, awards: titleAwards(year, { clubs, terms, voiceReady }), voiceReady };
}

/**
 * The members a Wrapped run covers for a year: everyone with a message, a
 * reaction or voice time that year outside the excluded channels, minus the
 * members whose latest membership change is a leave. While voice is not
 * ready, voice time alone does not make a member active (their story would
 * have nothing to show).
 *
 * @param year - The UTC calendar year.
 * @param voiceReady - Whether voice counts (see `voice-ready.ts`).
 * @returns User ids, sorted ascending, so a resumed run walks them in the same order.
 */
export function activeMemberIds(year: number, voiceReady: boolean): string[] {
  const { from, to } = yearBounds(year);
  const m = schema.activityMessages;
  const r = schema.activityReactions;
  const v = schema.activityVoice;
  const vEnd = sql`coalesce(${v.endedAt}, ${v.lastSeenAt})`;

  const ids = new Set<string>();
  const add = (rows: { userId: string }[]) => rows.forEach((row) => ids.add(row.userId));
  add(
    db
      .selectDistinct({ userId: m.userId })
      .from(m)
      .where(and(gte(m.ts, from), lt(m.ts, to), notExcluded(m.channelId, m.parentChannelId)))
      .all(),
  );
  add(
    db
      .selectDistinct({ userId: r.userId })
      .from(r)
      .where(and(gte(r.addedAt, from), lt(r.addedAt, to), isNull(r.removedAt), notExcluded(r.channelId, r.parentChannelId)))
      .all(),
  );
  if (voiceReady) {
    add(
      db
        .selectDistinct({ userId: v.userId })
        .from(v)
        .where(and(lt(v.startedAt, to), sql`min(${vEnd}, ${to}) > max(${v.startedAt}, ${from})`, notExcluded(v.channelId)))
        .all(),
    );
  }

  const left = leftMemberIds();
  return [...ids].filter((id) => !left.has(id)).sort();
}

/**
 * Members who have left: those whose latest row in `activity_membership` is a
 * `leave`. A member who left and joined again is not in the set.
 */
export function leftMemberIds(): Set<string> {
  const rows = db
    .select({ userId: schema.activityMembership.userId, kind: schema.activityMembership.kind })
    .from(schema.activityMembership)
    .orderBy(asc(schema.activityMembership.ts), asc(schema.activityMembership.id))
    .all();
  const latest = new Map<string, "join" | "leave">();
  for (const row of rows) latest.set(row.userId, row.kind);
  return new Set([...latest].filter(([, kind]) => kind === "leave").map(([id]) => id));
}

/**
 * Build a member's Wrapped for one UTC calendar year.
 *
 * - `messages`, `busiestHour`, `busiestDay`, `topChannelId`: the member's messages.
 * - `voiceHours`: their voice segments, clipped to the year.
 * - `topEmoji`: emoji in their message text plus reactions they added and did
 *   not remove, merged by emoji, at most three.
 * - `mostRepliedToId`: the member they replied to most (not themselves).
 * - `soulmateId`: the counterpart with the highest weight, where each
 *   reply and each mention the member sent is one point and every
 *   {@link VOICE_OVERLAP_SECONDS_PER_POINT} seconds in the same voice channel
 *   at the same time is one point. Reply pings are not mention rows, and bots
 *   are never recorded as targets, so neither is counted.
 * - `xpLevel`: the member's current level.
 * - `club`, `presidency`, `titles`: see `extras.ts` and `titles.ts`.
 *
 * Ties go to the lowest hour, the earliest weekday (Monday first) and the
 * lowest id, so the result is stable.
 *
 * @param userId - The member.
 * @param year - The UTC calendar year.
 * While voice is not ready (`shared.voiceReady` false) `voiceHours` is null,
 * voice time does not make the member active, the soulmate is chosen from
 * replies and mentions only, and the club's voice rank and voice titles are
 * left out; `voiceReady` records which applied.
 *
 * @param shared - The year aggregates, when the caller already has them (a run).
 *   Left out, they are computed here (which checks voice readiness once).
 * @returns The snapshot, or null when the member has no message, reaction or
 *   (counted) voice time that year.
 */
export function buildWrapped(userId: string, year: number, shared?: WrappedShared): WrappedData | null {
  const { from, to } = yearBounds(year);
  const agg = shared ?? wrappedShared(year);
  const voiceReady = agg.voiceReady;
  const m = schema.activityMessages;

  const msgWhere = and(eq(m.userId, userId), gte(m.ts, from), lt(m.ts, to), notExcluded(m.channelId, m.parentChannelId));
  const messages = db.select({ n: count() }).from(m).where(msgWhere).get()?.n ?? 0;
  const voiceSeconds = voiceReady ? voiceSecondsOf(userId, from, to) : null;
  const reactions = reactionCount(userId, from, to);
  if (messages === 0 && !voiceSeconds && reactions === 0) return null;

  const hourExpr = sql<number>`cast(strftime('%H', ${m.ts}, 'unixepoch') as integer)`;
  const busiestHour =
    db
      .select({ hour: hourExpr, n: count() })
      .from(m)
      .where(msgWhere)
      .groupBy(hourExpr)
      .orderBy(desc(count()), asc(hourExpr))
      .limit(1)
      .get()?.hour ?? null;

  const dayExpr = sql<number>`cast(strftime('%w', ${m.ts}, 'unixepoch') as integer)`;
  const day = db
    .select({ day: dayExpr, n: count() })
    .from(m)
    .where(msgWhere)
    .groupBy(dayExpr)
    .orderBy(desc(count()), asc(sql`(${dayExpr} + 6) % 7`))
    .limit(1)
    .get();
  const busiestDay = day ? WEEKDAYS[day.day]! : null;

  // A thread is a channel of its own here: grouped by the message's own channel.
  const topChannelId =
    db
      .select({ channelId: m.channelId, n: count() })
      .from(m)
      .where(msgWhere)
      .groupBy(m.channelId)
      .orderBy(desc(count()), asc(m.channelId))
      .limit(1)
      .get()?.channelId ?? null;

  const replies = db
    .select({ toUserId: m.replyToUserId, n: count() })
    .from(m)
    .where(and(msgWhere, isNotNull(m.replyToUserId), ne(m.replyToUserId, userId)))
    .groupBy(m.replyToUserId)
    .all();
  const mostRepliedToId = pickTop(new Map(replies.map((row) => [row.toUserId!, row.n])));

  const weights = new Map<string, number>();
  const bump = (id: string, w: number) => weights.set(id, (weights.get(id) ?? 0) + w);
  for (const row of replies) bump(row.toUserId!, row.n);
  for (const row of mentionCounts(userId, from, to)) bump(row.toUserId, row.n);
  if (voiceReady) {
    for (const row of voiceOverlaps(userId, from, to)) bump(row.userId, row.seconds / VOICE_OVERLAP_SECONDS_PER_POINT);
  }
  const soulmateId = pickTop(weights);

  const level =
    db.select({ level: schema.members.level }).from(schema.members).where(eq(schema.members.userId, userId)).get()?.level ?? 0;

  return {
    year,
    messages,
    voiceHours: voiceSeconds === null ? null : Math.round(voiceSeconds / 360) / 10,
    topEmoji: topEmoji(userId, from, to),
    busiestHour,
    busiestDay,
    soulmateId,
    mostRepliedToId,
    topChannelId,
    xpLevel: level,
    club: clubFor(userId, year, agg.clubs),
    presidency: presidencyFor(userId, year, agg.terms),
    titles: titlesFor(userId, year, agg.awards),
    voiceReady,
  };
}

/** The id with the highest positive weight; ties go to the lowest id. Null when the map is empty. */
function pickTop(weights: Map<string, number>): string | null {
  let best: string | null = null;
  let bestWeight = 0;
  for (const [id, w] of weights) {
    if (w <= 0) continue;
    if (w > bestWeight || (w === bestWeight && best !== null && id < best)) {
      best = id;
      bestWeight = w;
    }
  }
  return best;
}

/** Seconds of the member's voice segments inside `[from, to)`, outside excluded channels. */
function voiceSecondsOf(userId: string, from: number, to: number): number {
  const v = schema.activityVoice;
  const vEnd = sql`coalesce(${v.endedAt}, ${v.lastSeenAt})`;
  const row = db
    .select({ seconds: sql<number | null>`sum(max(0, min(${vEnd}, ${to}) - max(${v.startedAt}, ${from})))` })
    .from(v)
    .where(and(eq(v.userId, userId), lt(v.startedAt, to), gt(vEnd, from), notExcluded(v.channelId)))
    .get();
  return Number(row?.seconds ?? 0);
}

/** Reactions the member added in `[from, to)` and still has, outside excluded channels. */
function reactionCount(userId: string, from: number, to: number): number {
  const r = schema.activityReactions;
  return (
    db
      .select({ n: count() })
      .from(r)
      .where(reactionWhere(userId, from, to))
      .get()?.n ?? 0
  );
}

/** Filter for the member's live reactions added in `[from, to)`, outside excluded channels. */
function reactionWhere(userId: string, from: number, to: number) {
  const r = schema.activityReactions;
  return and(
    eq(r.userId, userId),
    gte(r.addedAt, from),
    lt(r.addedAt, to),
    isNull(r.removedAt),
    notExcluded(r.channelId, r.parentChannelId),
  );
}

/** Mentions the member sent in `[from, to)`, per target, outside excluded channels. */
function mentionCounts(userId: string, from: number, to: number): { toUserId: string; n: number }[] {
  const mt = schema.activityMentions;
  return db
    .select({ toUserId: mt.toUserId, n: count() })
    .from(mt)
    .where(
      and(
        eq(mt.fromUserId, userId),
        ne(mt.toUserId, userId),
        gte(mt.ts, from),
        lt(mt.ts, to),
        notExcluded(mt.channelId, mt.parentChannelId),
      ),
    )
    .groupBy(mt.toUserId)
    .all();
}

/**
 * Seconds the member spent in the same voice channel as each other member,
 * clipped to `[from, to)`, outside excluded channels.
 */
function voiceOverlaps(userId: string, from: number, to: number): { userId: string; seconds: number }[] {
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
    .innerJoin(
      o,
      and(eq(o.channelId, v.channelId), ne(o.userId, v.userId), sql`${o.startedAt} < ${vEnd}`, sql`${oEnd} > ${v.startedAt}`),
    )
    .where(and(eq(v.userId, userId), lt(v.startedAt, to), gt(vEnd, from), notExcluded(v.channelId)))
    .groupBy(o.userId)
    .all();
  return rows.map((row) => ({ userId: row.userId, seconds: Number(row.seconds) }));
}

/** The member's top emoji in `[from, to)`: text use and reactions merged, at most {@link TOP_EMOJI}. */
function topEmoji(userId: string, from: number, to: number): WrappedEmoji[] {
  const e = schema.activityEmoji;
  const r = schema.activityReactions;
  const text = db
    .select({ emoji: e.emoji, name: sql<string | null>`max(${e.name})`, n: sql<number>`sum(${e.count})` })
    .from(e)
    .where(and(eq(e.userId, userId), gte(e.ts, from), lt(e.ts, to), notExcluded(e.channelId, e.parentChannelId)))
    .groupBy(e.emoji)
    .all();
  const reacted = db
    .select({ emoji: r.emoji, name: sql<string | null>`max(${r.name})`, n: count() })
    .from(r)
    .where(reactionWhere(userId, from, to))
    .groupBy(r.emoji)
    .all();

  const merged = new Map<string, WrappedEmoji>();
  for (const row of [...text, ...reacted]) {
    const prev = merged.get(row.emoji);
    merged.set(row.emoji, {
      emoji: row.emoji,
      name: prev?.name ?? row.name ?? null,
      count: (prev?.count ?? 0) + Number(row.n),
    });
  }
  return [...merged.values()]
    .sort((a, b) => b.count - a.count || (a.emoji < b.emoji ? -1 : a.emoji > b.emoji ? 1 : 0))
    .slice(0, TOP_EMOJI);
}
