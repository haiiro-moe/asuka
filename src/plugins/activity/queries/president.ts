/**
 * President-tier activity queries: numbers only.
 *
 * A president sees how the server is doing, never who is doing what. Five
 * rules hold for everything exported here (docs/activity/queries-president.md
 * has the reasoning):
 *
 * 1. **No identity leaves this module.** Member and channel ids are read to
 *    count and to group, and only sizes and counts are returned. No result
 *    type has a field that could hold an id or a name.
 * 2. **No count of one or two members.** Such a count is returned as `null`
 *    (`hideSmall`), and a hidden count never enters another number: the totals
 *    that would give it away by subtraction are hidden with it.
 * 3. **Fixed periods.** The routes only ask for the two periods of
 *    {@link presidentPeriod}, which both end at today 00:00 UTC, so asking
 *    again a few minutes later returns the same numbers.
 * 4. **The two periods cannot be subtracted from each other.** One of them
 *    lies inside the other. The shorter is shown as it is; a number of the
 *    longer one that is 1 or 2 away from the shorter one's is hidden
 *    ({@link presidentScope}, {@link showBeside}).
 * 5. **No voice until the voice log is old enough.** While `voiceReadiness`
 *    says the log does not hold two whole months yet, nothing here reads
 *    `activity_voice`: the voice figures are `null`, and active members, ties,
 *    "gone quiet" and club activity come from messages alone.
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
import { voiceReadiness } from "../voice-ready.ts";
import { sharedVoiceSeconds } from "./voice-overlap.ts";
import type { VoiceSpan } from "./voice-overlap.ts";
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

/**
 * What one president request asks for: the period, and the other fixed period
 * when that one lies inside it.
 *
 * Build it with {@link presidentScope}. A president route must not make one by
 * hand: leaving `shorter` out for the longer period would switch off the rule
 * that keeps the two periods from being subtracted from each other.
 */
export interface PresidentScope {
  /** The period to report on. */
  period: Period;
  /**
   * The other fixed period, when it is the shorter of the two: it ends at the
   * same moment as `period` and starts later. Null when `period` is itself the
   * shorter one, or when the two are the same.
   */
  shorter: Period | null;
  /**
   * Whether the voice log is old enough to be used (`voiceReadiness`). While
   * it is false no query reads `activity_voice`: the voice figures are null,
   * and everything else is worked out from messages alone.
   */
  voiceReady: boolean;
}

/**
 * Turn a president route's `?period=` value into the scope of the request.
 *
 * Both fixed periods end at today 00:00 UTC, so one of them always lies inside
 * the other. The shorter one is shown as it is. The longer one is shown beside
 * it: a number of the longer period that is one or two away from the same
 * number of the shorter period is hidden (see {@link showBeside}). Usually the
 * week is the shorter one; in the first days of a term, the term is.
 *
 * Voice readiness is read here, once per request, and judged at the end of the
 * period (today 00:00 UTC). The log becomes ready at the start of a UTC month,
 * so this switches at a midnight, when the periods move anyway.
 *
 * @param value - The query value. Null means the parameter is absent (`week`).
 * @param now - The current time in unix seconds. Defaults to the clock.
 * @returns The scope. It is the same for every `now` within one UTC day.
 * @throws RangeError for any value {@link presidentPeriod} does not accept.
 */
export function presidentScope(value: string | null, now: number = nowSec()): PresidentScope {
  const period = presidentPeriod(value, now);
  const other = presidentPeriod(value === "term" ? "week" : "term", now);
  return {
    period,
    shorter: other.from > period.from ? other : null,
    voiceReady: voiceReadiness(period.to).ready,
  };
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

/**
 * The voice segments of a period, each cut down to the part inside it.
 *
 * A segment that is still open counts as running to the end of the period. The
 * period ended at or before 00:00 UTC today, so a member who is still connected
 * now was connected then, and the result does not move with the heartbeat that
 * keeps `lastSeenAt` fresh.
 *
 * @param p - The period.
 * @param voice - Whether the voice log may be used. When it may not, the table
 *   is not read and there are no spans.
 * @returns The spans, each at least a second long. A segment with no time
 *   inside the period, or with an end before its start, is left out.
 */
function voiceSpans(p: Period, voice: boolean): VoiceSpan[] {
  if (!voice) return [];
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
 * @param voice - Whether the voice log may be used. When it may not, only
 *   writing a message makes a member active.
 * @returns The member ids; empty for an empty period.
 */
function activeMemberIds(p: Period, voice: boolean): Set<string> {
  const ids = new Set<string>();
  if (p.to <= p.from) return ids;

  const m = schema.activityMessages;
  const authors = db
    .selectDistinct({ userId: m.userId })
    .from(m)
    .where(and(gte(m.ts, p.from), lt(m.ts, p.to), notExcluded(m.channelId, m.parentChannelId)))
    .all();
  for (const row of authors) ids.add(row.userId);
  if (!voice) return ids;

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
 * @param voice - Whether the voice log may be used. When it may not, only
 *   messages count, before and since.
 * @returns The raw count. Pass it through `hideSmall` before returning it.
 */
function quietCount(to: number, voice: boolean): number {
  const cutoff = to - QUIET_DAYS * DAY;
  const before = activeMemberIds({ from: cutoff - QUIET_LOOKBACK_DAYS * DAY, to: cutoff }, voice);
  if (before.size === 0) return 0;
  const since = activeMemberIds({ from: cutoff, to }, voice);
  const left = leftMemberIds(to);

  let quiet = 0;
  for (const id of before) {
    if (!since.has(id) && !left.has(id)) quiet += 1;
  }
  return quiet;
}

/**
 * The gone-quiet count that may be shown for a scope.
 *
 * Hidden at 1 and 2, and hidden for the longer period when it is 1 or 2 away
 * from the shorter period's. Both periods end at the same moment and the count
 * is judged at that moment, so today the two are always the same number; the
 * check is there so that this stays a rule and not a coincidence.
 *
 * @param scope - The scope of the request.
 * @returns The count, or null when hidden.
 */
function quietShown(scope: PresidentScope): number | null {
  const quiet = hideSmall(quietCount(scope.period.to, scope.voiceReady));
  if (quiet === null || scope.shorter === null) return quiet;
  const shorter = hideSmall(quietCount(scope.shorter.to, scope.voiceReady));
  return shorter !== null && givesAway(quiet, shorter) ? null : quiet;
}

/**
 * The members of a period as anonymous sizes: no id survives into this.
 *
 * @internal Exported for the tests of {@link showAlone} and {@link showBeside}.
 */
export interface MemberWeb {
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

/**
 * What may be said about the members of a period.
 *
 * @internal Exported for the tests of {@link showAlone} and {@link showBeside}.
 */
export interface MemberView {
  /** Member count of every group that is listed, largest first. */
  sizes: number[];
  /** How many groups of `MIN_GROUP` or more there are, listed or not. */
  groups: number;
  /** Members in a group of `MIN_GROUP` or more; null when a group is not listed. */
  connected: number | null;
  /** The active members outside those groups; null when hidden. */
  other: number | null;
  /** `connected + other`; null exactly when `other` is. */
  total: number | null;
  /** Pairs of members tied across two groups of `MIN_GROUP` or more; null when hidden. */
  bridges: number | null;
}

/**
 * Reduce a member web to the numbers that may be shown for a period on its
 * own, with nothing left to subtract.
 *
 * The active members fall into the groups of `MIN_GROUP` or more and one
 * remainder: everyone in a smaller group and everyone tied to nobody. When the
 * remainder is 1 or 2 it is hidden, and then no returned number contains it:
 * `total` is hidden too, since `total - connected` would be exactly that
 * remainder. Every number that is returned is made of whole parts that are each
 * 0 or at least `MIN_GROUP`. The hidden remainder is in none of them, so no
 * arithmetic on them can bring it back.
 *
 * {@link connection}, {@link groupSizes} and {@link engagement} all take their
 * member counts from here, which is what keeps them consistent with each other.
 *
 * @param web - The member web of the period.
 * @returns The view. Every group is listed.
 */
export function showAlone(web: MemberWeb): MemberView {
  const { shown, other } = mergeSmallGroups(web.sizes);
  const connected = shown.reduce((a, b) => a + b, 0);
  return {
    sizes: shown,
    groups: shown.length,
    connected,
    other,
    total: other === null ? null : connected + other,
    bridges: hideSmall(web.bridges),
  };
}

/**
 * Whether two numbers of the same kind, one from each period, are close enough
 * to give a small count away: apart, but by less than `MIN_GROUP`. "15 active
 * this week, 16 this term" says that one member was active only earlier in the
 * term, as plainly as a count of 1 would.
 */
function givesAway(a: number, b: number): boolean {
  const apart = Math.abs(a - b);
  return apart > 0 && apart < MIN_GROUP;
}

/**
 * Reduce the longer period's member web to what may be shown beside the
 * shorter period's numbers.
 *
 * The two fixed periods end at the same moment and one lies inside the other,
 * so a president can hold their numbers against each other. The shorter period
 * is shown as it is. Of the longer period, a number is shown only when it is
 * not 1 or 2 away from the same number of the shorter period, and, as in
 * {@link showAlone}, nothing that is hidden enters a number that is shown:
 *
 * 1. **Groups.** A group is listed when the shorter period lists a group of
 *    the same size (each of its groups is the twin of one group at most), or
 *    when its size is not 1 or 2 away from the size of any group listed for
 *    the shorter period. If every group can be listed but their sum is 1 or 2
 *    away from the shorter period's `connected`, none is listed.
 * 2. **`connected`** is shown only when every group is listed: with one left
 *    out, the true number would give that group's size away.
 * 3. **`other` and `total`** are shown, together, only when `connected` is,
 *    the remainder is not 1 or 2, the shorter period shows its own `other` and
 *    `total`, and neither is 1 or 2 away from the shorter period's. A total
 *    next to a hidden total could pin the hidden one down, because the shorter
 *    period's members are all members of the longer one.
 * 4. **`bridges`** are hidden at 1 and 2, and when 1 or 2 away from the
 *    bridges shown for the shorter period.
 *
 * `groups` stays the true count of groups: it is not a count of people. So a
 * president can see that a group is left out, but not how large it is.
 *
 * Only what the shorter period shows is looked at, never what it hides. A rule
 * that read a hidden number would give it away through what it lets through.
 *
 * @param web - The member web of the longer period.
 * @param shorter - What is shown for the shorter period, from {@link showAlone}.
 * @returns The view of the longer period.
 */
export function showBeside(web: MemberWeb, shorter: MemberView): MemberView {
  const { shown: groups, other: rest } = mergeSmallGroups(web.sizes);

  // A group with a twin of the same size in the shorter period shows nothing
  // new next to it. Any other group must keep its distance from all of them.
  const twins = [...shorter.sizes];
  let sizes = groups.filter((size) => {
    const twin = twins.indexOf(size);
    if (twin >= 0) {
      twins.splice(twin, 1);
      return true;
    }
    return !shorter.sizes.some((other) => givesAway(size, other));
  });
  let connected: number | null = null;
  if (sizes.length === groups.length) {
    const all = groups.reduce((a, b) => a + b, 0);
    if (shorter.connected !== null && givesAway(all, shorter.connected)) sizes = [];
    else connected = all;
  }

  let other: number | null = null;
  let total: number | null = null;
  if (
    connected !== null &&
    rest !== null &&
    shorter.other !== null &&
    shorter.total !== null &&
    !givesAway(rest, shorter.other) &&
    !givesAway(connected + rest, shorter.total)
  ) {
    other = rest;
    total = connected + rest;
  }

  let bridges = hideSmall(web.bridges);
  if (bridges !== null && shorter.bridges !== null && givesAway(bridges, shorter.bridges)) bridges = null;

  return { sizes, groups: groups.length, connected, other, total, bridges };
}

/**
 * The member web of a period, read from the database.
 *
 * @param p - The period.
 * @param voice - Whether the voice log may be used. When it may not, members
 *   are active and tied through messages alone.
 */
function memberWebOf(p: Period, voice: boolean): MemberWeb {
  if (p.to <= p.from) return { sizes: [], bridges: 0 };
  return memberWeb(messageCounts(p), voiceSpans(p, voice));
}

/**
 * What may be shown about the members of a scope's period.
 *
 * @param scope - The scope of the request.
 * @param web - The member web of `scope.period`, when the caller already has it.
 */
function memberView(
  scope: PresidentScope,
  web: MemberWeb = memberWebOf(scope.period, scope.voiceReady),
): MemberView {
  if (scope.shorter === null) return showAlone(web);
  return showBeside(web, showAlone(memberWebOf(scope.shorter, scope.voiceReady)));
}

/**
 * How connected the members are: the four tiles of the president's connection
 * view.
 *
 * `connected` is the members in a group of three or more. A pair, or a member
 * tied to nobody, is never shown as such: they only ever count into `other`
 * and `total`, and only when those can be shown.
 *
 * `quiet` is judged at the end of the period (see {@link QUIET_LOOKBACK_DAYS})
 * and does not depend on where the period starts, so it is the same for the
 * week and for the term.
 *
 * @param scope - The scope of the request, from {@link presidentScope}.
 * @returns Counts only. See `PresidentConnection` for each field and for when
 *   one is `null`. An empty period gives zeros.
 */
export function connection(scope: PresidentScope): PresidentConnection {
  const members = memberView(scope);
  return {
    connected: members.connected,
    total: members.total,
    // A count of groups, each of them MIN_GROUP members or more: it is not a
    // count of people, so it is shown at 1 and 2 as well.
    groups: members.groups,
    bridges: members.bridges,
    quiet: quietShown(scope),
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
 * @param scope - The scope of the request, from {@link presidentScope}.
 * @returns Two lists of the same length, oldest week first; both empty for an
 *   empty period. `voiceHours` is `null`, not a list of zeros, while the voice
 *   log is too young to be used.
 */
export function weeklySeries(scope: PresidentScope): PresidentWeeklySeries {
  const p = scope.period;
  if (p.to <= p.from) return { replies: [], voiceHours: scope.voiceReady ? [] : null };
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

  if (!scope.voiceReady) return { replies, voiceHours: null };
  const seconds = new Array<number>(weeks).fill(0);
  for (const span of voiceSpans(p, true)) {
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
 * @param scope - The scope of the request, from {@link presidentScope}.
 * @returns `sizes`: the groups of `MIN_GROUP` members or more. `other`: the
 *   active members outside those groups, pairs and members tied to nobody
 *   alike, added up; `null` when hidden.
 *
 * @example
 * ```ts
 * // Groups of 14, 9 and 5, one pair and one member nobody answered.
 * groupSizes(scope); // { sizes: [14, 9, 5], other: 3 }
 * ```
 */
export function groupSizes(scope: PresidentScope): PresidentGroupSizes {
  const members = memberView(scope);
  return { sizes: members.sizes, other: members.other };
}

/**
 * How much is going on: messages, active members and voice hours.
 *
 * `activeMembers` is the same number as `connection(scope).total` and is
 * hidden under the same conditions, so the two cannot be played against each
 * other.
 *
 * @param scope - The scope of the request, from {@link presidentScope}.
 * @returns The three numbers; zeros for an empty period. `voiceHours` is
 *   `null`, not 0, while the voice log is too young to be used, and
 *   `activeMembers` then counts only who wrote.
 */
export function engagement(scope: PresidentScope): PresidentEngagement {
  const p = scope.period;
  const voice = scope.voiceReady;
  if (p.to <= p.from) return { messages: 0, activeMembers: 0, voiceHours: voice ? 0 : null };
  const messages = messageCounts(p);
  const spans = voiceSpans(p, voice);
  return {
    messages: messages.reduce((sum, row) => sum + row.n, 0),
    activeMembers: memberView(scope, memberWeb(messages, spans)).total,
    voiceHours: voice ? toHours(spans.reduce((sum, span) => sum + span.end - span.start, 0)) : null,
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
 * @param voice - Whether the voice log may be used. When it may not, only a
 *   message makes a club active.
 * @returns The raw counts, not yet through `hideSmall`.
 */
function clubCounts(p: Period, voice: boolean): { active: number; quiet: number } {
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
  const voiced = new Set(voiceSpans(p, voice).map((span) => span.channelId));
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
 * The club counts that may be shown for a period on its own: both, or neither
 * when one of them is 1 or 2.
 */
function clubsShown(counts: { active: number; quiet: number }): { active: number | null; quiet: number | null } {
  const show = hideSmall(counts.active) !== null && hideSmall(counts.quiet) !== null;
  return { active: show ? counts.active : null, quiet: show ? counts.quiet : null };
}

/**
 * The average attendance that may be shown for a set of occurrences.
 *
 * @param held - How many occurrences.
 * @param signUps - Sign-ups added up over them.
 * @returns The average with one decimal; 0 when nothing was held or nobody
 *   signed up; null when it is above 0 and under `MIN_GROUP`, which comes from
 *   occurrences with one or two sign-ups.
 */
function attendanceShown(held: number, signUps: number): number | null {
  const average = held <= 0 ? 0 : signUps / held;
  return average > 0 && average < MIN_GROUP ? null : Math.round(average * 10) / 10;
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
 * For the longer of the two periods the same rule as for the members holds
 * (see {@link showBeside}): its club counts are hidden when either is 1 or 2
 * away from the shorter period's, and its average attendance is hidden when
 * the occurrences outside the shorter period, taken alone, would have an
 * average that is hidden. Otherwise `average x held` of the two periods could
 * be subtracted to get the one or two sign-ups of a single event.
 *
 * @param scope - The scope of the request, from {@link presidentScope}.
 * @returns See `PresidentClubEventHealth` for each field. An empty period
 *   gives zeros.
 */
export function clubEventHealth(scope: PresidentScope): PresidentClubEventHealth {
  const clubs = clubsShown(clubCounts(scope.period, scope.voiceReady));
  const events = eventCounts(scope.period);
  let avgAttendance = attendanceShown(events.held, events.signUps);

  if (scope.shorter !== null) {
    const shorterClubs = clubsShown(clubCounts(scope.shorter, scope.voiceReady));
    if (
      clubs.active !== null &&
      clubs.quiet !== null &&
      shorterClubs.active !== null &&
      shorterClubs.quiet !== null &&
      (givesAway(clubs.active, shorterClubs.active) || givesAway(clubs.quiet, shorterClubs.quiet))
    ) {
      clubs.active = null;
      clubs.quiet = null;
    }
    // The occurrences of the longer period that the shorter one does not have.
    const shorterEvents = eventCounts(scope.shorter);
    const outside = attendanceShown(events.held - shorterEvents.held, events.signUps - shorterEvents.signUps);
    if (outside === null) avgAttendance = null;
  }

  return { clubsActive: clubs.active, clubsQuiet: clubs.quiet, eventsHeld: events.held, avgAttendance };
}
