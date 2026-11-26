/**
 * Wrapped titles: first place at something that year.
 *
 * Rank 1 only; a tie shares the title. A quiet year awards nothing: message
 * titles need the winner to have sent at least {@link MIN_MESSAGES} messages
 * that year, voice titles at least {@link MIN_VOICE_HOURS} hours in voice.
 * The definitions match the user-tier awards (night owl 00:00-04:59 UTC,
 * earliest bird 05:00-07:59 UTC, longest closed voice segment, fastest
 * replier by median reply time with at least 10 replies, most replied-to).
 * Club titles go to the club's owner, `president` to everyone who held the
 * chair that year.
 *
 * Every metric is aggregated in SQL, one row per member or club; the median
 * is computed in SQL with window functions. See docs/activity/wrapped.md.
 *
 * @packageDocumentation
 */
import { and, count, gte, inArray, isNotNull, isNull, lt, ne, sql } from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import { alias } from "drizzle-orm/sqlite-core";
import { db, schema } from "../../../db/index.ts";
import { notExcluded } from "../exclusion.ts";
import type { WrappedTitle } from "../types/wrapped.ts";
import { clubYearStats, presidencyTermsIn, yearPeriod } from "./extras.ts";
import type { ClubYearStats, TermInYear } from "./extras.ts";

/** Messages a member needs that year to win a message title. */
export const MIN_MESSAGES = 100;
/** Hours in voice a member needs that year to win a voice title. */
export const MIN_VOICE_HOURS = 10;
/** Replies a member needs for the fastest-replier title. */
const MIN_REPLIES = 10;

/** A title and who won it. */
export interface TitleAward {
  /** The title key. */
  key: string;
  /** The lowercase label. */
  label: string;
  /** The detail phrase every winner gets. */
  detail: string;
  /** Winning member ids (several on a tie). */
  winners: string[];
}

/** Per-member (or per-club) values; `lowest` picks the smallest instead of the largest. */
interface Metric {
  key: string;
  label: string;
  /** What first place means, e.g. `most after midnight`. */
  what: string;
  /** How many took part, for `1st of N`. */
  of: number;
  /** `clubs` writes `1st of N clubs`. */
  unit?: "clubs";
  values: Map<string, number>;
  lowest?: boolean;
}

/** The winners of a metric: everyone at the best value (above 0 for highest-wins metrics). */
function award(metric: Metric): TitleAward | null {
  const entries = [...metric.values].filter(([, v]) => (metric.lowest ? v >= 0 : v > 0));
  if (entries.length === 0) return null;
  const best = metric.lowest ? Math.min(...entries.map(([, v]) => v)) : Math.max(...entries.map(([, v]) => v));
  const winners = entries.filter(([, v]) => v === best).map(([id]) => id).sort();
  const place = winners.length > 1 ? "joint 1st" : "1st";
  const of = `${metric.of}${metric.unit === "clubs" ? " clubs" : ""}`;
  return { key: metric.key, label: metric.label, detail: `${place} of ${of}, ${metric.what}`, winners };
}

/** Rows of `{ id, n }` as a map. */
function toMap(rows: { id: string | null; n: number | string | null }[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const r of rows) if (r.id !== null) out.set(r.id, Number(r.n ?? 0));
  return out;
}

/**
 * Every title of a year and its winners.
 *
 * @param year - The UTC calendar year.
 * @param shared - Year aggregates the caller already has (a run computes them once).
 * @returns The awarded titles; a title nobody qualifies for is left out.
 */
export function titleAwards(year: number, shared: { clubs?: ClubYearStats[]; terms?: TermInYear[] } = {}): TitleAward[] {
  const { from, to } = yearPeriod(year);
  const m = schema.activityMessages;
  const v = schema.activityVoice;
  const msgYear = and(gte(m.ts, from), lt(m.ts, to), notExcluded(m.channelId, m.parentChannelId));
  const hour = sql`cast(strftime('%H', ${m.ts}, 'unixepoch') as integer)`;

  // Members with enough messages, and their counts (most-messages).
  const messageCounts = toMap(
    db
      .select({ id: m.userId, n: count() })
      .from(m)
      .where(msgYear)
      .groupBy(m.userId)
      .having(gte(count(), MIN_MESSAGES))
      .all(),
  );
  const talkers = [...messageCounts.keys()];

  // Members with enough voice time, and their seconds (most-voice-hours).
  const vEnd = sql`coalesce(${v.endedAt}, ${v.lastSeenAt})`;
  const clipped = sql<number>`max(0, min(${vEnd}, ${to}) - max(${v.startedAt}, ${from}))`;
  const voiceYear = and(lt(v.startedAt, to), sql`${vEnd} > ${from}`, notExcluded(v.channelId));
  const voiceSeconds = toMap(
    db
      .select({ id: v.userId, n: sql<number>`sum(${clipped})` })
      .from(v)
      .where(voiceYear)
      .groupBy(v.userId)
      .having(sql`sum(${clipped}) >= ${MIN_VOICE_HOURS * 3600}`)
      .all(),
  );
  const voicers = [...voiceSeconds.keys()];

  /** Messages per eligible member matching `extra`. */
  const countWhere = (extra: SQL): Map<string, number> =>
    talkers.length === 0
      ? new Map()
      : toMap(
          db
            .select({ id: m.userId, n: count() })
            .from(m)
            .where(and(msgYear, inArray(m.userId, talkers), extra))
            .groupBy(m.userId)
            .all(),
        );

  const metrics: Metric[] = [
    { key: "night-owl", label: "night owl", what: "most after midnight", of: talkers.length, values: countWhere(sql`${hour} between 0 and 4`) },
    { key: "earliest-bird", label: "earliest bird", what: "most before 8:00 utc", of: talkers.length, values: countWhere(sql`${hour} between 5 and 7`) },
    { key: "longest-voice", label: "longest voice", what: "longest single call", of: voicers.length, values: longestVoice(voicers, from, to) },
    { key: "fastest-replier", label: "fastest replier", what: "quickest replies", of: talkers.length, values: fastestReplies(talkers, from, to), lowest: true },
    {
      key: "most-replied-to",
      label: "most replied to",
      what: "most replied to",
      of: talkers.length,
      values:
        talkers.length === 0
          ? new Map()
          : toMap(
              db
                .select({ id: m.replyToUserId, n: count() })
                .from(m)
                .where(and(msgYear, isNotNull(m.replyToUserId), ne(m.replyToUserId, m.userId), inArray(m.replyToUserId, talkers)))
                .groupBy(m.replyToUserId)
                .all(),
            ),
    },
    { key: "most-messages", label: "most messages", what: "most messages", of: talkers.length, values: messageCounts },
    { key: "most-voice-hours", label: "most voice hours", what: "most hours in voice", of: voicers.length, values: voiceSeconds },
    { key: "emoji-lord", label: "emoji lord", what: "most emoji", of: talkers.length, values: emojiUse(talkers, from, to) },
  ];

  // Club titles: per club, then handed to the owner.
  const clubs = shared.clubs ?? clubYearStats(year);
  const clubMetric = (key: string, label: string, what: string, value: (c: ClubYearStats) => number, ok: (c: ClubYearStats) => boolean) => {
    const values = new Map<string, number>();
    for (const c of clubs) if (ok(c)) values.set(String(c.clubId), value(c));
    const won = award({ key, label, what, of: clubs.length, unit: "clubs", values });
    if (!won) return null;
    const owners = [...new Set(won.winners.map((id) => clubs.find((c) => String(c.clubId) === id)!.ownerId))].sort();
    return { ...won, winners: owners };
  };
  const clubAwards = [
    clubMetric("club-most-members", "biggest club", "most members", (c) => c.members, (c) => c.messages >= MIN_MESSAGES),
    clubMetric("club-most-messages", "loudest club", "most messages", (c) => c.messages, (c) => c.messages >= MIN_MESSAGES),
    clubMetric("club-most-voice", "club in voice", "most voice", (c) => c.voiceSeconds, (c) => c.voiceSeconds >= MIN_VOICE_HOURS * 3600),
  ];

  const presidents = [...new Set((shared.terms ?? presidencyTermsIn(year)).map((t) => t.userId))].sort();
  const presidentAward: TitleAward | null =
    presidents.length === 0 ? null : { key: "president", label: "president", detail: `held the chair in ${year}`, winners: presidents };

  return [...metrics.map(award), ...clubAwards, presidentAward].filter((a): a is TitleAward => a !== null);
}

/**
 * The titles a member won in a year.
 *
 * @param userId - The member.
 * @param year - The UTC calendar year.
 * @param awards - {@link titleAwards} for the year, when the caller already has it.
 * @returns Their titles, in the fixed title order; empty for none.
 */
export function titlesFor(userId: string, year: number, awards: TitleAward[] = titleAwards(year)): WrappedTitle[] {
  return awards.filter((a) => a.winners.includes(userId)).map((a) => ({ key: a.key, label: a.label, detail: a.detail }));
}

/** Longest closed voice segment per member, clipped to the year, in seconds. */
function longestVoice(userIds: string[], from: number, to: number): Map<string, number> {
  if (userIds.length === 0) return new Map();
  const v = schema.activityVoice;
  return toMap(
    db
      .select({ id: v.userId, n: sql<number>`max(min(${v.endedAt}, ${to}) - max(${v.startedAt}, ${from}))` })
      .from(v)
      .where(and(inArray(v.userId, userIds), isNotNull(v.endedAt), lt(v.startedAt, to), sql`${v.endedAt} > ${from}`, notExcluded(v.channelId)))
      .groupBy(v.userId)
      .all(),
  );
}

/**
 * Median seconds between a reply and the message it answers, per member with
 * at least 10 replies that year. The median is taken in SQL (row_number over
 * each member's sorted reply times), so only one row per member comes back.
 */
function fastestReplies(userIds: string[], from: number, to: number): Map<string, number> {
  if (userIds.length === 0) return new Map();
  const r = alias(schema.activityMessages, "reply");
  const p = alias(schema.activityMessages, "parent");
  const rows = db.all<{ id: string; n: number }>(sql`
    with d as (
      select ${r.userId} as u, ${r.ts} - ${p.ts} as dt
      from ${schema.activityMessages} as "reply" join ${schema.activityMessages} as "parent" on ${p.messageId} = ${r.replyToMessageId}
      where ${r.ts} >= ${from} and ${r.ts} < ${to}
        and ${r.replyToUserId} is not null and ${r.replyToUserId} != ${r.userId}
        and ${r.ts} >= ${p.ts}
        and ${notExcluded(r.channelId, r.parentChannelId)}
        and ${inArray(r.userId, userIds)}
    ),
    ranked as (
      select u, dt, row_number() over (partition by u order by dt) as rn, count(*) over (partition by u) as c from d
    )
    select u as id, avg(dt) as n from ranked
    where c >= ${MIN_REPLIES} and rn in ((c + 1) / 2, (c + 2) / 2)
    group by u
  `);
  return toMap(rows);
}

/** Emoji uses per member (text count plus live reactions), one SQL query. */
function emojiUse(userIds: string[], from: number, to: number): Map<string, number> {
  if (userIds.length === 0) return new Map();
  const e = schema.activityEmoji;
  const r = schema.activityReactions;
  const rows = db.all<{ id: string; n: number }>(sql`
    select u as id, sum(n) as n from (
      select ${e.userId} as u, ${e.count} as n from ${e}
      where ${e.ts} >= ${from} and ${e.ts} < ${to} and ${notExcluded(e.channelId, e.parentChannelId)} and ${inArray(e.userId, userIds)}
      union all
      select ${r.userId} as u, 1 as n from ${r}
      where ${r.addedAt} >= ${from} and ${r.addedAt} < ${to} and ${isNull(r.removedAt)}
        and ${notExcluded(r.channelId, r.parentChannelId)} and ${inArray(r.userId, userIds)}
    )
    group by u
  `);
  return toMap(rows);
}
