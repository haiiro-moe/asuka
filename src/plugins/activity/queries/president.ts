/**
 * President-tier activity queries: numbers only.
 *
 * A president sees how the server is doing, never who is doing what. Three
 * rules hold for everything exported here (docs/activity/queries-president.md
 * has the reasoning):
 *
 * 1. **No identity leaves this module.** Member and channel ids are read to
 *    count and to group, and only sizes and counts are returned. No result
 *    type has a field that could hold an id or a name.
 * 2. **No count of one or two members.** Such a count is returned as `null`
 *    (`hideSmall`), and a hidden count never enters another number: the totals
 *    that would give it away by subtraction are hidden with it.
 * 3. **Fixed periods.** The routes only pass the two periods of
 *    {@link presidentPeriod}, which both end at today 00:00 UTC, so asking
 *    again a few minutes later returns the same numbers.
 *
 * Excluded channels are filtered out of every query with `notExcluded`.
 */
import { and, count, eq, gt, gte, isNotNull, isNull, lt, ne, or, sql } from "drizzle-orm";
import { nowSec } from "../../../core/util.ts";
import { db, schema } from "../../../db/index.ts";
import { occurrencesBetween } from "../../events/recurrence.ts";
import { excludedChannelIds, notExcluded } from "../exclusion.ts";
import { countBridges, detectGroups } from "../groups.ts";
import type { Edge } from "../groups.ts";
import { MIN_GROUP, hideSmall, mergeSmallGroups } from "../privacy.ts";
import { QUIET_DAYS, lastDays, termPeriod } from "../time.ts";
import type { Period } from "../time.ts";
import type {
  PresidentClubEventHealth,
  PresidentConnection,
  PresidentEngagement,
  PresidentGroupSizes,
  PresidentWeeklySeries,
} from "../types/president.ts";

/** Seconds in an hour. */
const HOUR = 3600;
/** Seconds in a day. */
const DAY = 86400;
/** Seconds in a week. */
const WEEK = 7 * DAY;
/** Monday 5 Jan 1970, 00:00 UTC: every weekly bucket starts a whole number of weeks after it. */
const FIRST_MONDAY = 4 * DAY;

/**
 * Seconds of shared voice time that tie two members as strongly as one reply
 * does: ten minutes in the same voice channel count like one reply.
 */
export const VOICE_TIE_SECONDS = 600;

/**
 * The weakest tie that links two members: one reply, ten minutes of shared
 * voice, or any mix that adds up to as much. Anything weaker is not a tie.
 */
export const MIN_TIE_WEIGHT = 1;

/**
 * How far back "gone quiet" looks. A member counts as gone quiet when they
 * were active in the 90 days before their last 30 silent ones. Someone silent
 * for longer than that is gone, not quiet, which also keeps members who left
 * before recording began (the backfill knows their old messages, but not that
 * they left) from being counted forever.
 */
export const QUIET_LOOKBACK_DAYS = 90;

/** Upper bound on the occurrences counted for one event in one period. */
const MAX_OCCURRENCES = 10000;

/**
 * Turn a president route's `?period=` value into its fixed {@link Period}.
 *
 * | Value | Period |
 * |---|---|
 * | `week`, or absent (null) | the seven full UTC days before today |
 * | `term` | from `president.termStart` up to today 00:00 UTC; the 90 days before today when no term is on record |
 *
 * Both end at today 00:00 UTC, not at `now`. A window that ends "now" moves
 * with every request, and two requests a few minutes apart could be subtracted
 * to see what one member did in between. These periods move once a day, at
 * 00:00 UTC, at the cost of numbers that are up to a day old.
 *
 * A term that began today has not seen a full UTC day yet and is empty
 * (`from` equals `to`).
 *
 * @param value - The query value. Null means the parameter is absent.
 * @param now - The current time in unix seconds. Defaults to the clock.
 * @returns The period. It is the same for every `now` within one UTC day.
 * @throws RangeError for any other value, the empty string and the other
 *   activity periods (`7d`, `30d`, `year`, `all`) included. The message does
 *   not repeat the value.
 */
export function presidentPeriod(value: string | null, now: number = nowSec()): Period {
  const today = now - (((now % DAY) + DAY) % DAY);
  switch (value) {
    case null:
    case "week":
      return lastDays(7, today);
    case "term": {
      const term = termPeriod(today);
      return { from: Math.min(term.from, today), to: today };
    }
    default:
      throw new RangeError("period must be week or term");
  }
}

/** Seconds as hours with one decimal. */
function toHours(seconds: number): number {
  return Math.round(seconds / (HOUR / 10)) / 10;
}

/** The Monday 00:00 UTC that starts the week `ts` falls in. */
function weekStart(ts: number): number {
  return ts - ((((ts - FIRST_MONDAY) % WEEK) + WEEK) % WEEK);
}

/** How many messages one member wrote in reply to one other member, or to nobody. */
interface MessageCount {
  /** The author. */
  userId: string;
  /** Whose message was answered; null when the messages are not replies to a member. */
  replyTo: string | null;
  /** How many such messages. */
  n: number;
}

/**
 * The messages of a period, counted in SQL per author and reply target.
 *
 * @param p - The period.
 * @returns One row per (author, reply target) pair. The rows are bounded by
 *   the number of member pairs, not by the number of messages.
 */
function messageCounts(p: Period): MessageCount[] {
  const m = schema.activityMessages;
  return db
    .select({ userId: m.userId, replyTo: m.replyToUserId, n: count() })
    .from(m)
    .where(and(gte(m.ts, p.from), lt(m.ts, p.to), notExcluded(m.channelId, m.parentChannelId)))
    .groupBy(m.userId, m.replyToUserId)
    .all();
}

/** The part of a voice segment that lies inside a period. */
interface VoiceSpan {
  /** The member. */
  userId: string;
  /** The voice channel. */
  channelId: string;
  /** First second inside the period. */
  start: number;
  /** End, exclusive, and never after the period's end. */
  end: number;
}

/**
 * The voice segments of a period, each cut down to the part inside it.
 *
 * A segment that is still open counts as running to the end of the period. The
 * period ended at or before 00:00 UTC today, so a member who is still connected
 * now was connected then, and the result does not move with the heartbeat that
 * keeps `lastSeenAt` fresh.
 *
 * @param p - The period.
 * @returns The spans, each at least a second long. A segment with no time
 *   inside the period, or with an end before its start, is left out.
 */
function voiceSpans(p: Period): VoiceSpan[] {
  const v = schema.activityVoice;
  const rows = db
    .select({ userId: v.userId, channelId: v.channelId, startedAt: v.startedAt, endedAt: v.endedAt })
    .from(v)
    .where(and(lt(v.startedAt, p.to), or(isNull(v.endedAt), gt(v.endedAt, p.from)), notExcluded(v.channelId)))
    .all();

  const spans: VoiceSpan[] = [];
  for (const row of rows) {
    const start = Math.max(row.startedAt, p.from);
    const end = Math.min(row.endedAt ?? p.to, p.to);
    if (end > start) spans.push({ userId: row.userId, channelId: row.channelId, start, end });
  }
  return spans;
}

/**
 * The members active in a period: everyone who wrote a message or spent time
 * in voice in it, outside the excluded channels.
 *
 * The ids are for counting and comparing inside this module only.
 *
 * @param p - The period.
 * @returns The member ids; empty for an empty period.
 */
function activeMemberIds(p: Period): Set<string> {
  const ids = new Set<string>();
  if (p.to <= p.from) return ids;

  const m = schema.activityMessages;
  const authors = db
    .selectDistinct({ userId: m.userId })
    .from(m)
    .where(and(gte(m.ts, p.from), lt(m.ts, p.to), notExcluded(m.channelId, m.parentChannelId)))
    .all();
  for (const row of authors) ids.add(row.userId);

  const v = schema.activityVoice;
  const speakers = db
    .selectDistinct({ userId: v.userId })
    .from(v)
    .where(
      and(
        lt(v.startedAt, p.to),
        or(isNull(v.endedAt), and(gt(v.endedAt, p.from), gt(v.endedAt, v.startedAt))),
        notExcluded(v.channelId),
      ),
    )
    .all();
  for (const row of speakers) ids.add(row.userId);
  return ids;
}

/**
 * The members who had left the guild by a given time: their last recorded
 * membership change before it is a leave.
 *
 * @param before - Unix seconds. Changes at or after it are not looked at.
 * @returns The member ids. A member with no recorded change is not in it.
 */
function leftMemberIds(before: number): Set<string> {
  const s = schema.activityMembership;
  const lastLeave = sql<number | null>`max(case when ${s.kind} = 'leave' then ${s.ts} end)`;
  const lastJoin = sql<number | null>`max(case when ${s.kind} = 'join' then ${s.ts} end)`;
  const rows = db
    .select({ userId: s.userId })
    .from(s)
    .where(lt(s.ts, before))
    .groupBy(s.userId)
    .having(sql`${lastLeave} is not null and (${lastJoin} is null or ${lastLeave} >= ${lastJoin})`)
    .all();
  return new Set(rows.map((row) => row.userId));
}

/**
 * How many members have gone quiet by a given time.
 *
 * A member has gone quiet when they wrote or were in voice during the
 * {@link QUIET_LOOKBACK_DAYS} days before the last `QUIET_DAYS` days, did
 * neither in those last `QUIET_DAYS` days, and have not left the guild.
 *
 * @param to - The time to judge at, in unix seconds: the end of the period.
 * @returns The raw count. Pass it through `hideSmall` before returning it.
 */
function quietCount(to: number): number {
  const cutoff = to - QUIET_DAYS * DAY;
  const before = activeMemberIds({ from: cutoff - QUIET_LOOKBACK_DAYS * DAY, to: cutoff });
  if (before.size === 0) return 0;
  const since = activeMemberIds({ from: cutoff, to });
  const left = leftMemberIds(to);

  let quiet = 0;
  for (const id of before) {
    if (!since.has(id) && !left.has(id)) quiet += 1;
  }
  return quiet;
}

/**
 * How long each pair of members shared a voice channel.
 *
 * @param spans - Voice spans of one period, from {@link voiceSpans}.
 * @returns For each member, the members with a larger id they shared a channel
 *   with, and for how many seconds in total.
 */
function sharedVoiceSeconds(spans: VoiceSpan[]): Map<string, Map<string, number>> {
  const byChannel = new Map<string, VoiceSpan[]>();
  for (const span of spans) {
    const list = byChannel.get(span.channelId);
    if (list) list.push(span);
    else byChannel.set(span.channelId, [span]);
  }

  const shared = new Map<string, Map<string, number>>();
  for (const list of byChannel.values()) {
    list.sort((x, y) => x.start - y.start || x.end - y.end);
    // The spans that are still running when the next one starts.
    let open: VoiceSpan[] = [];
    for (const span of list) {
      open = open.filter((other) => other.end > span.start);
      for (const other of open) {
        if (other.userId === span.userId) continue;
        const seconds = Math.min(other.end, span.end) - span.start;
        const [lo, hi] = other.userId < span.userId ? [other.userId, span.userId] : [span.userId, other.userId];
        let row = shared.get(lo);
        if (!row) {
          row = new Map();
          shared.set(lo, row);
        }
        row.set(hi, (row.get(hi) ?? 0) + seconds);
      }
      open.push(span);
    }
  }
  return shared;
}

/** The members of a period as anonymous sizes: no id survives into this. */
interface MemberWeb {
  /**
   * Member count of every group, largest first, followed by a 1 for every
   * active member who is tied to nobody.
   */
  sizes: number[];
  /** Pairs of members tied across two groups of `MIN_GROUP` or more. */
  bridges: number;
}

/**
 * Group the active members of a period by who they talk to.
 *
 * Two active members are tied when they replied to each other or shared a
 * voice channel in the period. A tie weighs one per reply plus one per
 * {@link VOICE_TIE_SECONDS} of shared voice, and needs {@link MIN_TIE_WEIGHT}
 * to count. Mentions are not ties. A reply to a member who was not active in
 * the period, to a bot or to oneself ties nobody.
 *
 * @param messages - The period's messages, from {@link messageCounts}.
 * @param spans - The period's voice spans, from {@link voiceSpans}.
 * @returns Group sizes and the bridge count. Every active member is counted in
 *   exactly one entry of `sizes`.
 */
function memberWeb(messages: MessageCount[], spans: VoiceSpan[]): MemberWeb {
  const active = new Set<string>();
  for (const row of messages) active.add(row.userId);
  for (const span of spans) active.add(span.userId);

  // Replies and shared seconds per pair, kept as whole numbers until the end.
  const ties = new Map<string, Map<string, { replies: number; seconds: number }>>();
  const tie = (a: string, b: string) => {
    const [lo, hi] = a < b ? [a, b] : [b, a];
    let row = ties.get(lo);
    if (!row) {
      row = new Map();
      ties.set(lo, row);
    }
    let entry = row.get(hi);
    if (!entry) {
      entry = { replies: 0, seconds: 0 };
      row.set(hi, entry);
    }
    return entry;
  };
  for (const row of messages) {
    if (row.replyTo === null || row.replyTo === row.userId || !active.has(row.replyTo)) continue;
    tie(row.userId, row.replyTo).replies += row.n;
  }
  for (const [lo, row] of sharedVoiceSeconds(spans)) {
    for (const [hi, seconds] of row) tie(lo, hi).seconds += seconds;
  }

  const edges: Edge[] = [];
  for (const [a, row] of ties) {
    for (const [b, { replies, seconds }] of row) {
      const weight = replies + seconds / VOICE_TIE_SECONDS;
      if (weight >= MIN_TIE_WEIGHT) edges.push({ a, b, weight });
    }
  }

  const groups = detectGroups(edges);
  const sizes = groups.map((group) => group.length);
  const tied = new Set(groups.flat());
  for (const id of active) {
    if (!tied.has(id)) sizes.push(1);
  }
  const bridges = countBridges(
    edges,
    groups.filter((group) => group.length >= MIN_GROUP),
  );
  return { sizes, bridges };
}

/** What may be said about the members of a period. */
interface MemberSummary {
  /** Member count of every group of `MIN_GROUP` or more, largest first. */
  sizes: number[];
  /** The active members outside those groups; null when that is 1 or 2. */
  other: number | null;
  /** The members of the shown groups, added up. */
  connected: number;
  /** `connected + other`; null when `other` is hidden. */
  total: number | null;
  /** Raw count of bridges between the shown groups. Not yet through `hideSmall`. */
  bridges: number;
}

/**
 * Reduce a member web to the numbers that may be shown, with nothing left to
 * subtract.
 *
 * The active members fall into the shown groups and one remainder: everyone in
 * a group under `MIN_GROUP` and everyone tied to nobody. When the remainder is
 * 1 or 2 it is hidden, and then no returned number contains it: `total` is
 * hidden too, since `total - connected` would be exactly that remainder. Every
 * number that is returned is made of whole parts that are each 0 or at least
 * `MIN_GROUP`. The hidden remainder is in none of them, so no arithmetic on
 * them can bring it back.
 *
 * {@link connection}, {@link groupSizes} and {@link engagement} all take their
 * member counts from here, which is what keeps them consistent with each other.
 *
 * @param web - The member web of the period.
 * @returns The summary.
 */
function summarize(web: MemberWeb): MemberSummary {
  const { shown, other } = mergeSmallGroups(web.sizes);
  const connected = shown.reduce((a, b) => a + b, 0);
  return {
    sizes: shown,
    other,
    connected,
    total: other === null ? null : connected + other,
    bridges: web.bridges,
  };
}

/** The member summary of a period, read from the database. */
function memberSummary(p: Period): MemberSummary {
  if (p.to <= p.from) return summarize({ sizes: [], bridges: 0 });
  return summarize(memberWeb(messageCounts(p), voiceSpans(p)));
}

/**
 * How connected the members are: the four tiles of the president's connection
 * view.
 *
 * `quiet` is judged at the end of the period (see {@link QUIET_LOOKBACK_DAYS})
 * and does not depend on where the period starts, so it is the same for the
 * week and for the term.
 *
 * @param p - The period, from {@link presidentPeriod}.
 * @returns Counts only. See `PresidentConnection` for each field and for when
 *   one is `null`. An empty period gives zeros.
 */
export function connection(p: Period): PresidentConnection {
  const members = memberSummary(p);
  return {
    connected: hideSmall(members.connected),
    total: members.total === null ? null : hideSmall(members.total),
    // A count of groups, each of them MIN_GROUP members or more: it points at
    // nobody at 1 or 2, and groupSizes shows the same groups one by one.
    groups: members.sizes.length,
    bridges: hideSmall(members.bridges),
    quiet: hideSmall(quietCount(p.to)),
  };
}

/**
 * Replies and voice hours per UTC week.
 *
 * The buckets are calendar weeks, Monday 00:00 UTC to the next: fixed, so a
 * week that is over never changes. There is one bucket for every week the
 * period touches, and the first and the last hold only the part of their week
 * that lies inside the period. A reply counts when it answers another member
 * (not a bot, not oneself). Voice time that runs across a Monday is split
 * between the two weeks.
 *
 * @param p - The period, from {@link presidentPeriod}.
 * @returns Two lists of the same length, oldest week first; both empty for an
 *   empty period.
 */
export function weeklySeries(p: Period): PresidentWeeklySeries {
  if (p.to <= p.from) return { replies: [], voiceHours: [] };
  const first = weekStart(p.from);
  const weeks = (weekStart(p.to - 1) - first) / WEEK + 1;

  const m = schema.activityMessages;
  const week = sql<number>`cast((${m.ts} - ${first}) / ${WEEK} as integer)`;
  const rows = db
    .select({ week, n: count() })
    .from(m)
    .where(
      and(
        gte(m.ts, p.from),
        lt(m.ts, p.to),
        isNotNull(m.replyToUserId),
        ne(m.replyToUserId, m.userId),
        notExcluded(m.channelId, m.parentChannelId),
      ),
    )
    .groupBy(week)
    .all();
  const replies = new Array<number>(weeks).fill(0);
  for (const row of rows) replies[row.week] = row.n;

  const seconds = new Array<number>(weeks).fill(0);
  for (const span of voiceSpans(p)) {
    const last = Math.floor((span.end - 1 - first) / WEEK);
    for (let w = Math.floor((span.start - first) / WEEK); w <= last; w++) {
      const from = first + w * WEEK;
      seconds[w] = (seconds[w] ?? 0) + Math.min(span.end, from + WEEK) - Math.max(span.start, from);
    }
  }
  return { replies, voiceHours: seconds.map(toHours) };
}

/**
 * How large the groups are: the bars of the president's connection view.
 *
 * The groups come from `detectGroups` over the period's ties (see
 * `memberWeb` in this file). Only sizes are returned, largest first, so the
 * order says nothing about who is in which group.
 *
 * @param p - The period, from {@link presidentPeriod}.
 * @returns `sizes`: every group of `MIN_GROUP` members or more. `other`: the
 *   active members outside those groups, pairs and members tied to nobody
 *   alike, added up; `null` when that is 1 or 2.
 *
 * @example
 * ```ts
 * // Groups of 14, 9 and 5, one pair and one member nobody answered.
 * groupSizes(p); // { sizes: [14, 9, 5], other: 3 }
 * ```
 */
export function groupSizes(p: Period): PresidentGroupSizes {
  const members = memberSummary(p);
  return { sizes: members.sizes, other: members.other };
}

/**
 * How much is going on: messages, active members and voice hours.
 *
 * `activeMembers` is the same number as `connection(p).total` and is hidden
 * under the same condition, so the two cannot be played against each other.
 *
 * @param p - The period, from {@link presidentPeriod}.
 * @returns The three numbers; zeros for an empty period.
 */
export function engagement(p: Period): PresidentEngagement {
  if (p.to <= p.from) return { messages: 0, activeMembers: 0, voiceHours: 0 };
  const messages = messageCounts(p);
  const spans = voiceSpans(p);
  const total = summarize(memberWeb(messages, spans)).total;
  return {
    messages: messages.reduce((sum, row) => sum + row.n, 0),
    activeMembers: total === null ? null : hideSmall(total),
    voiceHours: toHours(spans.reduce((sum, span) => sum + span.end - span.start, 0)),
  };
}

/**
 * Count the approved clubs with and without activity in a period.
 *
 * A club is active when a message was written in its thread or channel, or in
 * a thread under its channel, or when someone was in its voice channel. Spaces
 * archived by a downgrade count as the club's. A club whose spaces are all
 * excluded from analytics is left out: nothing about it is measured, so it is
 * neither active nor quiet.
 *
 * @param p - The period.
 * @returns The raw counts, not yet through `hideSmall`.
 */
function clubCounts(p: Period): { active: number; quiet: number } {
  if (p.to <= p.from) return { active: 0, quiet: 0 };
  const c = schema.clubs;
  const clubs = db
    .select({
      threadId: c.threadId,
      channelId: c.channelId,
      voiceChannelId: c.voiceChannelId,
      archivedThreadId: c.archivedThreadId,
      archivedChannelId: c.archivedChannelId,
      archivedVoiceChannelId: c.archivedVoiceChannelId,
    })
    .from(c)
    .where(and(eq(c.status, "approved"), lt(c.createdAt, p.to)))
    .all();
  if (clubs.length === 0) return { active: 0, quiet: 0 };

  const m = schema.activityMessages;
  const written = db
    .selectDistinct({ channelId: m.channelId, parentChannelId: m.parentChannelId })
    .from(m)
    .where(and(gte(m.ts, p.from), lt(m.ts, p.to), notExcluded(m.channelId, m.parentChannelId)))
    .all();
  const channels = new Set<string>();
  const parents = new Set<string>();
  for (const row of written) {
    channels.add(row.channelId);
    if (row.parentChannelId !== null) parents.add(row.parentChannelId);
  }
  const voiced = new Set(voiceSpans(p).map((span) => span.channelId));
  const excluded = excludedChannelIds();

  const known = (ids: (string | null)[]) => ids.filter((id): id is string => id !== null);
  let active = 0;
  let quiet = 0;
  for (const row of clubs) {
    const text = known([row.threadId, row.channelId, row.archivedThreadId, row.archivedChannelId]);
    const threadParents = known([row.channelId, row.archivedChannelId]);
    const voice = known([row.voiceChannelId, row.archivedVoiceChannelId]);
    const spaces = [...text, ...voice];
    if (spaces.length > 0 && spaces.every((id) => excluded.has(id))) continue;

    const isActive =
      text.some((id) => channels.has(id)) ||
      threadParents.some((id) => parents.has(id)) ||
      voice.some((id) => voiced.has(id));
    if (isActive) active += 1;
    else quiet += 1;
  }
  return { active, quiet };
}

/**
 * Count the event occurrences that started in a period and the sign-ups they had.
 *
 * Sign-ups are kept per event, not per occurrence, so every occurrence of an
 * event counts the members signed up for the event. Events and sign-ups made
 * after the period ended are not looked at.
 *
 * @param p - The period.
 * @returns `held`: the occurrences. `signUps`: sign-ups added up over them.
 */
function eventCounts(p: Period): { held: number; signUps: number } {
  if (p.to <= p.from) return { held: 0, signUps: 0 };
  const e = schema.events;
  const events = db
    .select({
      id: e.id,
      startAt: e.startAt,
      recurrence: e.recurrence,
      recurrenceInterval: e.recurrenceInterval,
      recurrenceUntil: e.recurrenceUntil,
    })
    .from(e)
    .where(and(lt(e.startAt, p.to), lt(e.createdAt, p.to)))
    .all();
  if (events.length === 0) return { held: 0, signUps: 0 };

  const ep = schema.eventParticipants;
  const signedUp = new Map(
    db
      .select({ eventId: ep.eventId, n: count() })
      .from(ep)
      .where(lt(ep.createdAt, p.to))
      .groupBy(ep.eventId)
      .all()
      .map((row) => [row.eventId, row.n]),
  );

  let held = 0;
  let signUps = 0;
  for (const event of events) {
    const occurrences = occurrencesBetween(event, p.from, p.to, MAX_OCCURRENCES).length;
    held += occurrences;
    signUps += occurrences * (signedUp.get(event.id) ?? 0);
  }
  return { held, signUps };
}

/**
 * Club and event health.
 *
 * The two club counts add up to the number of approved clubs, which every
 * member can see on the clubs page. If only one of them were hidden, that
 * public number would give it back, so both are hidden when either is 1 or 2.
 *
 * Clubs, events and sign-ups are read as they are now: those tables keep no
 * history. A club approved or ended today, or a sign-up withdrawn today,
 * changes these numbers during the day; the activity they are compared with is
 * still that of the fixed period.
 *
 * @param p - The period, from {@link presidentPeriod}.
 * @returns See `PresidentClubEventHealth` for each field. An empty period
 *   gives zeros.
 */
export function clubEventHealth(p: Period): PresidentClubEventHealth {
  const clubs = clubCounts(p);
  const showClubs = hideSmall(clubs.active) !== null && hideSmall(clubs.quiet) !== null;
  const events = eventCounts(p);
  const average = events.held === 0 ? 0 : events.signUps / events.held;
  return {
    clubsActive: showClubs ? clubs.active : null,
    clubsQuiet: showClubs ? clubs.quiet : null,
    eventsHeld: events.held,
    // An average between 0 and MIN_GROUP comes from occurrences with one or two sign-ups.
    avgAttendance: average > 0 && average < MIN_GROUP ? null : Math.round(average * 10) / 10,
  };
}
