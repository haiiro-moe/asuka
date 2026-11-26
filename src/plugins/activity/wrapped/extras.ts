/**
 * Per-member Wrapped extras: the club a member owns and the presidency they
 * held, plus the shared year aggregates (club stats, presidency terms, emoji
 * totals) that the titles and the server Wrapped reuse.
 *
 * All aggregation happens in SQL; only one row per club, per term or per
 * emoji comes back. See docs/activity/wrapped.md.
 *
 * @packageDocumentation
 */
import { and, count, eq, gte, inArray, isNull, lt, or, sql } from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import type { SQLiteColumn } from "drizzle-orm/sqlite-core";
import { nowSec } from "../../../core/util.ts";
import { db, schema } from "../../../db/index.ts";
import { getPresidencyHistory } from "../../elections/service.ts";
import { notExcluded } from "../exclusion.ts";
import { voiceReadiness } from "../voice-ready.ts";
import type { Period } from "../time.ts";
import type { WrappedClub, WrappedEmoji, WrappedPresidency } from "../types/wrapped.ts";

/** Seconds in a day. */
const DAY = 86400;

/**
 * The UTC calendar year as a period (start inclusive, end exclusive).
 *
 * @param year - The year, e.g. 2026.
 */
export function yearPeriod(year: number): Period {
  return { from: Date.UTC(year, 0, 1) / 1000, to: Date.UTC(year + 1, 0, 1) / 1000 };
}

/**
 * The year up to now: the whole year once it is over, otherwise its start to
 * `now`. Rates "per day of the year" divide by this.
 */
export function elapsedYear(year: number, now: number = nowSec()): Period {
  const p = yearPeriod(year);
  return { from: p.from, to: Math.max(p.from, Math.min(p.to, now)) };
}

/** A filter: `column` falls in any of `spans` (each start inclusive, end exclusive). */
export function inSpans(column: SQLiteColumn, spans: Period[]): SQL {
  if (spans.length === 0) return sql`0 = 1`;
  return or(...spans.map((s) => and(gte(column, s.from), lt(column, s.to))))!;
}

/** Competition rank of `value` among `values`, highest first: 1 + how many are strictly higher. */
export function rankOf(values: number[], value: number): number {
  return 1 + values.filter((v) => v > value).length;
}

/** An approved club's year. */
export interface ClubYearStats {
  /** The club's id. */
  clubId: number;
  /** The club's name. */
  name: string;
  /** The owner (founder). */
  ownerId: string;
  /** Accepted members right now. */
  members: number;
  /** Messages that year in the club's channel or thread, or in threads under them. */
  messages: number;
  /** Seconds that year in the club's voice channel (and its channel); null while voice is not ready. */
  voiceSeconds: number | null;
}

/**
 * Every approved club's year: members, messages and voice seconds.
 *
 * Messages are attributed by the club's `channelId` and `threadId`, matching
 * a message's own channel or its parent (so threads under the club channel
 * count). Voice is attributed by `voiceChannelId` and `channelId`. Excluded
 * channels are left out.
 *
 * @param year - The UTC calendar year.
 * @param voiceReady - Whether voice figures may be shown; when false the voice
 *   query is skipped and `voiceSeconds` is null. Left out, it is checked here.
 * @returns One row per approved club, by id.
 */
export function clubYearStats(year: number, voiceReady: boolean = voiceReadiness().ready): ClubYearStats[] {
  const { from, to } = yearPeriod(year);
  const c = schema.clubs;
  const m = schema.activityMessages;
  const v = schema.activityVoice;
  const cm = schema.clubMembers;

  const clubs = db
    .select({ clubId: c.id, name: c.name, ownerId: c.ownerId })
    .from(c)
    .where(eq(c.status, "approved"))
    .orderBy(c.id)
    .all();
  if (clubs.length === 0) return [];

  const members = new Map(
    db
      .select({ clubId: cm.clubId, n: count() })
      .from(cm)
      .innerJoin(c, eq(c.id, cm.clubId))
      .where(and(eq(c.status, "approved"), eq(cm.accepted, 1)))
      .groupBy(cm.clubId)
      .all()
      .map((r) => [r.clubId, r.n]),
  );

  const messages = new Map(
    db
      .select({ clubId: c.id, n: count(m.id) })
      .from(c)
      .innerJoin(
        m,
        or(eq(m.channelId, c.channelId), eq(m.channelId, c.threadId), eq(m.parentChannelId, c.channelId), eq(m.parentChannelId, c.threadId)),
      )
      .where(and(eq(c.status, "approved"), gte(m.ts, from), lt(m.ts, to), notExcluded(m.channelId, m.parentChannelId)))
      .groupBy(c.id)
      .all()
      .map((r) => [r.clubId, r.n]),
  );

  const vEnd = sql`coalesce(${v.endedAt}, ${v.lastSeenAt})`;
  const voice = new Map(
    (voiceReady ? db
      .select({ clubId: c.id, seconds: sql<number>`sum(max(0, min(${vEnd}, ${to}) - max(${v.startedAt}, ${from})))` })
      .from(c)
      .innerJoin(v, or(eq(v.channelId, c.voiceChannelId), eq(v.channelId, c.channelId)))
      .where(and(eq(c.status, "approved"), lt(v.startedAt, to), sql`${vEnd} > ${from}`, notExcluded(v.channelId)))
      .groupBy(c.id)
      .all()
      .map((r) => [r.clubId, Number(r.seconds)] as const) : []),
  );

  return clubs.map((club) => ({
    ...club,
    members: members.get(club.clubId) ?? 0,
    messages: messages.get(club.clubId) ?? 0,
    voiceSeconds: voiceReady ? (voice.get(club.clubId) ?? 0) : null,
  }));
}

/**
 * The club a member owns with the most messages that year (ties: lowest id),
 * with its ranks among all approved clubs.
 *
 * @param userId - The member.
 * @param year - The UTC calendar year.
 * @param stats - {@link clubYearStats} for the year, when the caller already has it.
 * @returns The club, or null when they own no approved club.
 */
export function clubFor(userId: string, year: number, stats: ClubYearStats[] = clubYearStats(year)): WrappedClub | null {
  const owned = stats.filter((s) => s.ownerId === userId);
  if (owned.length === 0) return null;
  const best = owned.reduce((a, b) => (b.messages > a.messages ? b : a));
  return {
    clubId: best.clubId,
    name: best.name,
    members: best.members,
    messages: best.messages,
    messagesRank: rankOf(stats.map((s) => s.messages), best.messages),
    membersRank: rankOf(stats.map((s) => s.members), best.members),
    voiceRank: best.voiceSeconds === null ? null : rankOf(stats.map((s) => s.voiceSeconds ?? 0), best.voiceSeconds),
    clubs: stats.length,
  };
}

/** One presidency term clipped to a year. */
export interface TermInYear {
  /** The president. */
  userId: string;
  /** The election they won. */
  electionId: number;
  /** Start of the term inside the year. */
  from: number;
  /** End of the term inside the year (now, for an ongoing term in the current year). */
  to: number;
}

/**
 * The presidency terms that overlap a year, clipped to it. Reads the
 * elections history (`getPresidencyHistory`): a term runs from its
 * election's close to the next election's start, or to now while ongoing.
 *
 * @param year - The UTC calendar year.
 * @param now - The current time, unix seconds.
 * @returns Terms in order, each with a positive length.
 */
export function presidencyTermsIn(year: number, now: number = nowSec()): TermInYear[] {
  const { from, to } = elapsedYear(year, now);
  return getPresidencyHistory()
    .map((t) => ({
      userId: t.userId,
      electionId: t.electionId,
      from: Math.max(from, t.termStart),
      to: Math.min(to, t.termEnd ?? now),
    }))
    .filter((t) => t.to > t.from);
}

/** Server messages in `spans`, outside excluded channels. */
function serverMessagesIn(spans: Period[]): number {
  const m = schema.activityMessages;
  return (
    db
      .select({ n: count() })
      .from(m)
      .where(and(inSpans(m.ts, spans), notExcluded(m.channelId, m.parentChannelId)))
      .get()?.n ?? 0
  );
}

/**
 * How much busier the server was per day during `spans` than over the year so
 * far, as a whole-number percentage (negative when quieter; 0 without data).
 *
 * @param spans - The terms, clipped to the year.
 * @param year - The UTC calendar year.
 * @param now - The current time, unix seconds.
 */
export function serverActivityPercent(spans: Period[], year: number, now: number = nowSec()): number {
  const seconds = spans.reduce((sum, s) => sum + (s.to - s.from), 0);
  const elapsed = elapsedYear(year, now);
  const yearSeconds = elapsed.to - elapsed.from;
  if (seconds <= 0 || yearSeconds <= 0) return 0;
  const yearRate = serverMessagesIn([elapsed]) / (yearSeconds / DAY);
  if (yearRate === 0) return 0;
  const termRate = serverMessagesIn(spans) / (seconds / DAY);
  return Math.round((termRate / yearRate - 1) * 100);
}

/**
 * Emoji use in `spans`, text and reactions merged, most used first, in one
 * SQL query (`union all`, then `group by`).
 *
 * @param opts.userId - Only this member's use; left out for the whole server.
 * @param opts.spans - The time spans.
 * @param opts.limit - How many to return.
 * @param opts.keys - Only these emoji keys (to check which custom emoji were used).
 */
export function emojiTotals(opts: { userId?: string; spans: Period[]; limit: number; keys?: string[] }): WrappedEmoji[] {
  const e = schema.activityEmoji;
  const r = schema.activityReactions;
  if (opts.keys && opts.keys.length === 0) return [];
  const textWhere = and(
    opts.userId === undefined ? undefined : eq(e.userId, opts.userId),
    opts.keys ? inArray(e.emoji, opts.keys) : undefined,
    inSpans(e.ts, opts.spans),
    notExcluded(e.channelId, e.parentChannelId),
  );
  const reactionWhere = and(
    opts.userId === undefined ? undefined : eq(r.userId, opts.userId),
    opts.keys ? inArray(r.emoji, opts.keys) : undefined,
    inSpans(r.addedAt, opts.spans),
    isNull(r.removedAt),
    notExcluded(r.channelId, r.parentChannelId),
  );
  const rows = db.all<{ emoji: string; name: string | null; n: number }>(sql`
    select emoji, max(name) as name, sum(n) as n from (
      select ${e.emoji} as emoji, ${e.name} as name, ${e.count} as n from ${e} where ${textWhere}
      union all
      select ${r.emoji} as emoji, ${r.name} as name, 1 as n from ${r} where ${reactionWhere}
    )
    group by emoji
    order by n desc, emoji asc
    limit ${opts.limit}
  `);
  return rows.map((row) => ({ emoji: row.emoji, name: row.name ?? null, count: Number(row.n) }));
}

/**
 * A member's presidency in one year.
 *
 * - `terms`: their terms overlapping the year; `daysInOffice`: whole days of
 *   those terms inside the year (an ongoing term counts to now).
 * - `votes` / `votePercent`: from the election of their latest term in the
 *   year (null when they have no candidate row or nobody voted).
 * - `messagesInOffice` / `perDay`: their own messages during those terms, and
 *   per day in office (at least one day), one decimal.
 * - `serverActivityPercent`: see {@link serverActivityPercent}.
 * - `topEmojiInOffice`: their most used emoji key during those terms.
 *
 * @param userId - The member.
 * @param year - The UTC calendar year.
 * @param terms - {@link presidencyTermsIn} for the year, when the caller already has it.
 * @param now - The current time, unix seconds.
 * @returns The presidency, or null when they did not hold the chair that year.
 */
export function presidencyFor(
  userId: string,
  year: number,
  terms: TermInYear[] = presidencyTermsIn(year),
  now: number = nowSec(),
): WrappedPresidency | null {
  const mine = terms.filter((t) => t.userId === userId);
  if (mine.length === 0) return null;
  const spans = mine.map((t) => ({ from: t.from, to: t.to }));
  const seconds = spans.reduce((sum, s) => sum + (s.to - s.from), 0);
  const daysInOffice = Math.floor(seconds / DAY);

  const latest = mine[mine.length - 1]!;
  const ca = schema.candidates;
  const votesRow = db
    .select({
      mine: sql<number | null>`max(case when ${ca.userId} = ${userId} then ${ca.voteCount} end)`,
      total: sql<number>`coalesce(sum(${ca.voteCount}), 0)`,
    })
    .from(ca)
    .where(eq(ca.electionId, latest.electionId))
    .get();
  const votes = votesRow?.mine ?? null;
  const total = Number(votesRow?.total ?? 0);
  const votePercent = votes === null || total === 0 ? null : Math.round((votes / total) * 100);

  const m = schema.activityMessages;
  const messagesInOffice =
    db
      .select({ n: count() })
      .from(m)
      .where(and(eq(m.userId, userId), inSpans(m.ts, spans), notExcluded(m.channelId, m.parentChannelId)))
      .get()?.n ?? 0;

  return {
    terms: mine.length,
    daysInOffice,
    votes,
    votePercent,
    messagesInOffice,
    perDay: Math.round((messagesInOffice / Math.max(1, daysInOffice)) * 10) / 10,
    serverActivityPercent: serverActivityPercent(spans, year, now),
    topEmojiInOffice: emojiTotals({ userId, spans, limit: 1 })[0]?.emoji ?? null,
  };
}

/** Members who held the chair in a year, longest first (ties: lowest id). */
export function presidentsOf(terms: TermInYear[]): { userId: string; seconds: number }[] {
  const seconds = new Map<string, number>();
  for (const t of terms) seconds.set(t.userId, (seconds.get(t.userId) ?? 0) + (t.to - t.from));
  return [...seconds]
    .map(([userId, s]) => ({ userId, seconds: s }))
    .sort((a, b) => b.seconds - a.seconds || (a.userId < b.userId ? -1 : 1));
}

/** Elections that started in a year and the distinct members who stood in them. */
export function electionsIn(year: number): { elections: number; candidates: number } {
  const { from, to } = yearPeriod(year);
  const el = schema.elections;
  const ca = schema.candidates;
  const elections = db.select({ n: count() }).from(el).where(and(gte(el.startsAt, from), lt(el.startsAt, to))).get()?.n ?? 0;
  const candidates =
    db
      .select({ n: sql<number>`count(distinct ${ca.userId})` })
      .from(ca)
      .innerJoin(el, eq(el.id, ca.electionId))
      .where(and(gte(el.startsAt, from), lt(el.startsAt, to)))
      .get()?.n ?? 0;
  return { elections, candidates: Number(candidates) };
}
