/**
 * Admin-tier activity queries: every view, with names (user ids).
 *
 * Each function takes a {@link Period} (`from` inclusive, `to` exclusive, unix
 * seconds) and reads the event log plus the older moderation, economy, club and
 * event tables. Every query on a table with a channel hides excluded channels
 * with `notExcluded`, built at call time, and passes the parent-channel column
 * where the table has one, so a thread under an excluded channel is hidden too.
 * Buckets are UTC. See docs/activity/queries-admin.md.
 */
import { and, count, desc, eq, gt, gte, inArray, isNotNull, lt, max, min, ne, or, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/sqlite-core";
import { db, schema } from "../../../db/index.ts";
import { notExcluded } from "../exclusion.ts";
import { QUIET_DAYS } from "../time.ts";
import { voiceReady } from "../voice-ready.ts";
import { voicePairs, voiceSpansIn } from "./voice-overlap.ts";
import type { Period } from "../time.ts";
import type {
  ActionCount,
  ChannelHealthRow,
  ClubRow,
  ClubsAndEvents,
  CloseRow,
  CommandUsageRow,
  DriftRow,
  EarnerRow,
  Economy,
  EconomyWeek,
  EventRow,
  MemberInspect,
  ModerationSeries,
  NewcomerRow,
  OffenderRow,
  RelationKind,
  RelationPair,
} from "../types/admin.ts";

const {
  activityCommands,
  activityCredits,
  activityMembership,
  activityMentions,
  activityMessages,
  activityVoice,
  clubs,
  eventParticipants,
  events,
  modLog,
  storePurchases,
  warnings,
} = schema;

/** Seconds in a day. */
const DAY = 86400;
/** Seconds in a week, the width of every weekly bucket. */
const WEEK = 7 * DAY;

/** The `mod_log` actions that are moderation (the log also holds economy and event entries). */
export const MOD_ACTIONS = ["timeout", "untimeout", "kick", "ban", "unban", "warn", "censor"] as const;

/**
 * The `mod_log` actions that count as an offence besides warnings. Warnings are
 * counted from the `warnings` table, which `/warn` writes next to its `warn`
 * log entry, so the log's `warn` rows are not counted a second time.
 */
export const OFFENCE_ACTIONS = ["timeout", "kick", "ban"] as const;

/** A member is a repeat offender from this many offences in the period. */
export const REPEAT_MIN = 2;

/** The relationship kinds {@link relations} accepts. */
export const RELATION_KINDS: readonly RelationKind[] = ["replies", "mentions", "voice"];

/** At most this many pairs come back from {@link relations}. */
export const RELATIONS_LIMIT = 50;

/** At most this many members come back in {@link MemberInspect.closest}. */
export const CLOSEST_LIMIT = 5;

/** At most this many members come back in {@link Economy.topEarners}. */
export const TOP_EARNERS_LIMIT = 10;

/** `ts` inside the period. */
function inPeriod(column: Parameters<typeof gte>[0], p: Period) {
  return and(gte(column, p.from), lt(column, p.to))!;
}

/**
 * Where every weekly series of a period starts, shared by
 * {@link moderationSeries} and {@link economy} so their buckets line up.
 *
 * - A bounded period starts at `p.from`.
 * - The `all` period (`p.from` is 0) starts at the week of the earliest row any
 *   series covers (`activity_messages.ts`, `mod_log.created_at`,
 *   `activity_credits.ts`), rounded down to a multiple of 7 days since the
 *   epoch, the same grid as `all`'s buckets. Without any data it is the week
 *   before the one containing `p.to`, so the arrays stay short but not empty.
 *
 * @param p - The period.
 * @returns The start of the first bucket, in unix seconds.
 */
export function seriesStart(p: Period): number {
  if (p.from !== 0) return p.from;
  const firsts = [
    db.select({ ts: min(activityMessages.ts) }).from(activityMessages).get()?.ts,
    db.select({ ts: min(modLog.createdAt) }).from(modLog).get()?.ts,
    db.select({ ts: min(activityCredits.ts) }).from(activityCredits).get()?.ts,
  ].filter((ts): ts is number => ts != null);
  if (firsts.length === 0) return Math.floor(p.to / WEEK) * WEEK - WEEK;
  return Math.floor(Math.min(...firsts) / WEEK) * WEEK;
}

/** Number of 7-day buckets from `start` to the end of the period; the last one may be partial. */
function weekCount(p: Period, start: number): number {
  return Math.max(0, Math.ceil((p.to - start) / WEEK));
}

/**
 * SQL for the weekly bucket index of a timestamp column, counted from
 * `start`. The cast keeps the division whole even if a bound value arrives as
 * a real.
 */
function weekIndex(column: Parameters<typeof gte>[0], start: number) {
  return sql<number>`cast((${column} - ${start}) / ${WEEK} as integer)`;
}

/** Round to one decimal. */
function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

/** Median of a non-empty list of numbers, rounded to whole seconds. */
function median(values: number[]): number {
  const sorted = [...values].sort((x, y) => x - y);
  const mid = Math.floor(sorted.length / 2);
  const m = sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
  return Math.round(m);
}

/**
 * Moderation over time.
 *
 * Counts the {@link MOD_ACTIONS} rows of `mod_log` in the period, grouped in
 * SQL. Weekly buckets start at {@link seriesStart} (returned as `start`), and
 * weeks without actions are 0.
 *
 * @param p - The period.
 * @returns Actions per week and per kind (most frequent first, ties by name).
 */
export function moderationSeries(p: Period): ModerationSeries {
  const where = and(inArray(modLog.action, [...MOD_ACTIONS]), inPeriod(modLog.createdAt, p));

  const start = seriesStart(p);
  const weekly = new Array<number>(weekCount(p, start)).fill(0);
  const week = weekIndex(modLog.createdAt, start);
  for (const r of db.select({ week, n: count() }).from(modLog).where(where).groupBy(week).all()) {
    if (r.week >= 0 && r.week < weekly.length) weekly[r.week] = r.n;
  }

  const byAction: ActionCount[] = db
    .select({ action: modLog.action, count: count() })
    .from(modLog)
    .where(where)
    .groupBy(modLog.action)
    .all()
    .sort((x, y) => y.count - x.count || x.action.localeCompare(y.action));
  return { start, weekly, byAction };
}

/**
 * Members with {@link REPEAT_MIN} or more offences in the period.
 *
 * An offence is a row in `warnings` or a {@link OFFENCE_ACTIONS} entry in
 * `mod_log` (timeout, kick, ban) against the member.
 *
 * @param p - The period.
 * @returns Members by offence count, highest first, ties by id.
 */
export function repeatOffenders(p: Period): OffenderRow[] {
  const warned = db
    .select({ userId: warnings.userId, n: count() })
    .from(warnings)
    .where(inPeriod(warnings.createdAt, p))
    .groupBy(warnings.userId)
    .all();
  const punished = db
    .select({ userId: modLog.userId, n: count() })
    .from(modLog)
    .where(and(inArray(modLog.action, [...OFFENCE_ACTIONS]), inPeriod(modLog.createdAt, p)))
    .groupBy(modLog.userId)
    .all();

  const total = new Map<string, number>();
  for (const r of [...warned, ...punished]) total.set(r.userId, (total.get(r.userId) ?? 0) + r.n);
  return [...total]
    .filter(([, n]) => n >= REPEAT_MIN)
    .map(([userId, n]) => ({ userId, count: n }))
    .sort((x, y) => y.count - x.count || x.userId.localeCompare(y.userId));
}

/**
 * Members who joined in the period and their first week.
 *
 * A member's join is their first `join` row in `activity_membership` inside the
 * period. Their first week is the seven days from that join. A reply counts
 * when someone else answered one of their first-week messages within that week.
 * Messages in excluded channels count for neither.
 *
 * @param p - The period.
 * @returns One row per newcomer, latest join first.
 */
export function newcomers(p: Period): NewcomerRow[] {
  const joins = db
    .select({ userId: activityMembership.userId, joinedAt: min(activityMembership.ts) })
    .from(activityMembership)
    .where(and(eq(activityMembership.kind, "join"), inPeriod(activityMembership.ts, p)))
    .groupBy(activityMembership.userId)
    .all();

  const rows: NewcomerRow[] = [];
  for (const j of joins) {
    const joinedAt = j.joinedAt!;
    const weekEnd = joinedAt + WEEK;
    const own = db
      .select({ messageId: activityMessages.messageId })
      .from(activityMessages)
      .where(
        and(
          eq(activityMessages.userId, j.userId),
          gte(activityMessages.ts, joinedAt),
          lt(activityMessages.ts, weekEnd),
          notExcluded(activityMessages.channelId, activityMessages.parentChannelId),
        ),
      )
      .all()
      .map((r) => r.messageId);

    let gotReplyInWeek = false;
    if (own.length > 0) {
      const reply = db
        .select({ id: activityMessages.id })
        .from(activityMessages)
        .where(
          and(
            inArray(activityMessages.replyToMessageId, own),
            ne(activityMessages.userId, j.userId),
            // A reply never precedes its target, so the ts index bounds this to the week.
            gte(activityMessages.ts, joinedAt),
            lt(activityMessages.ts, weekEnd),
            notExcluded(activityMessages.channelId, activityMessages.parentChannelId),
          ),
        )
        .limit(1)
        .get();
      gotReplyInWeek = reply !== undefined;
    }
    rows.push({ userId: j.userId, joinedAt, gotReplyInWeek, messagesInWeek: own.length });
  }
  return rows.sort((x, y) => y.joinedAt - x.joinedAt || x.userId.localeCompare(y.userId));
}

/**
 * Members who were active and have gone quiet.
 *
 * The quiet window is the last {@link QUIET_DAYS} days before `p.to`, and the
 * previous period is the stretch of the same length as `p` that ends where the
 * quiet window starts. A member drifts when their last message or voice
 * activity (outside excluded channels) falls in the previous period, so they
 * were active then and silent since. Members whose latest membership change is
 * a leave are left out: they are gone, not drifting.
 *
 * Voice counts only once the voice log is ready (`voiceReady`, two whole
 * months of data). Until then drift is judged on messages alone, so nobody
 * looks quiet or active because of voice that was not reliably recorded.
 *
 * @param p - The period; its length sets how far back "previously active" reaches.
 * @param voice - Whether voice is ready. Compute it once per request and pass
 *   it in; left out, it is `voiceReady(p.to)`.
 * @returns Drifting members, most recently active first.
 */
export function drift(p: Period, voice: boolean = voiceReady(p.to)): DriftRow[] {
  const quietStart = p.to - QUIET_DAYS * DAY;
  const prevFrom = quietStart - (p.to - p.from);

  const last = new Map<string, number>();
  const keep = (userId: string, ts: number | null) => {
    if (ts == null) return;
    if (ts > (last.get(userId) ?? -Infinity)) last.set(userId, ts);
  };

  for (const r of db
    .select({ userId: activityMessages.userId, ts: max(activityMessages.ts) })
    .from(activityMessages)
    .where(and(lt(activityMessages.ts, p.to), notExcluded(activityMessages.channelId, activityMessages.parentChannelId)))
    .groupBy(activityMessages.userId)
    .all())
    keep(r.userId, r.ts);

  if (voice) {
    const voiceEnd = sql<number>`coalesce(${activityVoice.endedAt}, ${activityVoice.lastSeenAt})`;
    for (const r of db
      .select({ userId: activityVoice.userId, ts: sql<number | null>`max(min(${voiceEnd}, ${p.to}))` })
      .from(activityVoice)
      .where(and(lt(activityVoice.startedAt, p.to), notExcluded(activityVoice.channelId)))
      .groupBy(activityVoice.userId)
      .all())
      keep(r.userId, r.ts);
  }

  const latestMembership = new Map<string, string>();
  for (const r of db
    .select({ userId: activityMembership.userId, kind: activityMembership.kind })
    .from(activityMembership)
    .where(lt(activityMembership.ts, p.to))
    .orderBy(activityMembership.ts, activityMembership.id)
    .all())
    latestMembership.set(r.userId, r.kind);

  return [...last]
    .filter(([userId, ts]) => ts >= prevFrom && ts < quietStart && latestMembership.get(userId) !== "leave")
    .map(([userId, lastActiveAt]) => ({ userId, lastActiveAt }))
    .sort((x, y) => y.lastActiveAt - x.lastActiveAt || x.userId.localeCompare(y.userId));
}

/**
 * Health of each text channel and thread: how many messages go unanswered and
 * how fast the others get a reply.
 *
 * A message is answered when someone other than its author replied to it in
 * the period; its reply time is the time to the first such reply. A thread is
 * a channel of its own: its messages make their own row (keyed by the
 * message's own `channelId`, with `parentChannelId` set), never folded into
 * the parent. A thread under an excluded channel is hidden like the channel.
 * Channels without messages in the period are not listed.
 *
 * Both parts run in SQL: message counts are grouped per channel, and the
 * first-reply delays come from a self-join of replies onto their targets (the
 * join drives from the reply side onto the unique `message_id` index), keyed by
 * the target's channel. Only the answered messages' delays reach JavaScript,
 * for the median.
 *
 * @param p - The period.
 * @returns Channels and threads by message count, busiest first, ties by id.
 */
export function channelHealth(p: Period): ChannelHealthRow[] {
  const totals = db
    .select({
      channelId: activityMessages.channelId,
      // Every row of a thread carries the same parent; max() skips nulls.
      parentChannelId: max(activityMessages.parentChannelId),
      messages: count(),
    })
    .from(activityMessages)
    .where(and(inPeriod(activityMessages.ts, p), notExcluded(activityMessages.channelId, activityMessages.parentChannelId)))
    .groupBy(activityMessages.channelId)
    .all();

  const t = alias(activityMessages, "t");
  const r = alias(activityMessages, "r");
  const answered = db
    .select({ channelId: t.channelId, delay: sql<number>`min(${r.ts} - ${t.ts})` })
    .from(r)
    .innerJoin(t, and(eq(r.replyToMessageId, t.messageId), ne(r.userId, t.userId), gte(r.ts, t.ts)))
    .where(
      and(
        inPeriod(r.ts, p),
        inPeriod(t.ts, p),
        notExcluded(r.channelId, r.parentChannelId),
        notExcluded(t.channelId, t.parentChannelId),
      ),
    )
    .groupBy(t.messageId)
    .all();

  const delays = new Map<string, number[]>();
  for (const a of answered) {
    const list = delays.get(a.channelId) ?? [];
    list.push(a.delay);
    delays.set(a.channelId, list);
  }

  return totals
    .map((c) => {
      const d = delays.get(c.channelId) ?? [];
      return {
        channelId: c.channelId,
        parentChannelId: c.parentChannelId ?? null,
        messages: c.messages,
        unansweredPct: round1((100 * (c.messages - d.length)) / c.messages),
        medianReplySec: d.length > 0 ? median(d) : null,
      };
    })
    .sort((x, y) => y.messages - x.messages || x.channelId.localeCompare(y.channelId));
}

/**
 * The Social Credits economy, from the `activity_credits` ledger and
 * `store_purchases`.
 *
 * Positive deltas are credits in, negative deltas credits out (returned as a
 * positive amount); a zero delta counts as neither. Everything is summed in
 * SQL. Weekly buckets start at {@link seriesStart} (returned as `start`), and
 * weeks without changes are zeros.
 *
 * @param p - The period.
 * @returns Totals, the weekly series, the top earners by positive net and the number of store purchases.
 */
export function economy(p: Period): Economy {
  const where = inPeriod(activityCredits.ts, p);
  const sums = {
    in: sql<number>`coalesce(sum(case when ${activityCredits.delta} > 0 then ${activityCredits.delta} end), 0)`,
    out: sql<number>`coalesce(-sum(case when ${activityCredits.delta} < 0 then ${activityCredits.delta} end), 0)`,
  };

  const totals = db.select(sums).from(activityCredits).where(where).get();

  const start = seriesStart(p);
  const weekly: EconomyWeek[] = Array.from({ length: weekCount(p, start) }, () => ({ in: 0, out: 0 }));
  const week = weekIndex(activityCredits.ts, start);
  for (const r of db.select({ week, ...sums }).from(activityCredits).where(where).groupBy(week).all()) {
    if (r.week >= 0 && r.week < weekly.length) weekly[r.week] = { in: r.in, out: r.out };
  }

  const net = sql<number>`sum(${activityCredits.delta})`;
  const topEarners: EarnerRow[] = db
    .select({ userId: activityCredits.userId, net })
    .from(activityCredits)
    .where(where)
    .groupBy(activityCredits.userId)
    .having(gt(net, 0))
    .orderBy(desc(net), activityCredits.userId)
    .limit(TOP_EARNERS_LIMIT)
    .all();

  const sales = db.select({ n: count() }).from(storePurchases).where(inPeriod(storePurchases.createdAt, p)).get();
  return {
    creditsIn: totals?.in ?? 0,
    creditsOut: totals?.out ?? 0,
    start,
    weekly,
    topEarners,
    storeSales: sales?.n ?? 0,
  };
}

/**
 * Club activity and event attendance.
 *
 * Clubs: every approved club, with the messages in its thread, channel and
 * voice-channel chat (and threads under them) in the period. A club is dead
 * when it is older than {@link QUIET_DAYS} days and nobody wrote in it during
 * the last {@link QUIET_DAYS} days before `p.to`.
 *
 * Events: those that ran in the period, which is a one-off whose start (or end)
 * falls in it, or a recurring event that started before its end and had not
 * stopped repeating before its start. `attendees` is the participant list.
 *
 * @param p - The period.
 * @returns Clubs busiest first and events best attended first, ties by id.
 */
export function clubsAndEvents(p: Period): ClubsAndEvents {
  const quietStart = p.to - QUIET_DAYS * DAY;
  const approved = db
    .select({
      id: clubs.id,
      name: clubs.name,
      threadId: clubs.threadId,
      channelId: clubs.channelId,
      voiceChannelId: clubs.voiceChannelId,
      createdAt: clubs.createdAt,
    })
    .from(clubs)
    .where(eq(clubs.status, "approved"))
    .all();

  // Which club each channel belongs to, so one grouped query serves every club.
  const clubOf = new Map<string, number>();
  for (const c of approved) {
    for (const id of [c.threadId, c.channelId, c.voiceChannelId]) if (id != null) clubOf.set(id, c.id);
  }
  const channels = [...clubOf.keys()];

  /** Messages per club in `[from, to)`, grouped in SQL by channel and parent. */
  const perClub = (from: number, to: number): Map<number, number> => {
    const out = new Map<number, number>();
    if (channels.length === 0) return out;
    const rows = db
      .select({ channelId: activityMessages.channelId, parentChannelId: activityMessages.parentChannelId, n: count() })
      .from(activityMessages)
      .where(
        and(
          gte(activityMessages.ts, from),
          lt(activityMessages.ts, to),
          or(inArray(activityMessages.channelId, channels), inArray(activityMessages.parentChannelId, channels)),
          notExcluded(activityMessages.channelId, activityMessages.parentChannelId),
        ),
      )
      .groupBy(activityMessages.channelId, activityMessages.parentChannelId)
      .all();
    for (const r of rows) {
      const club = clubOf.get(r.channelId) ?? (r.parentChannelId == null ? undefined : clubOf.get(r.parentChannelId));
      if (club !== undefined) out.set(club, (out.get(club) ?? 0) + r.n);
    }
    return out;
  };

  const inPeriodCounts = perClub(p.from, p.to);
  // Dead-club check: only whether anything was written in the quiet window, a bounded range.
  const recent = perClub(quietStart, p.to);

  const clubRows: ClubRow[] = approved
    .map((c) => ({
      id: c.id,
      name: c.name,
      messages: inPeriodCounts.get(c.id) ?? 0,
      dead: c.createdAt <= quietStart && !recent.has(c.id),
    }))
    .sort((x, y) => y.messages - x.messages || x.id - y.id);

  const ran = and(
    lt(events.startAt, p.to),
    or(
      gte(sql`coalesce(${events.endAt}, ${events.startAt})`, p.from),
      and(ne(events.recurrence, "none"), or(sql`${events.recurrenceUntil} is null`, gte(events.recurrenceUntil, p.from))),
    ),
  );
  const eventRows: EventRow[] = db
    .select({ id: events.id, title: events.title, attendees: count(eventParticipants.id) })
    .from(events)
    .leftJoin(eventParticipants, eq(eventParticipants.eventId, events.id))
    .where(ran)
    .groupBy(events.id)
    .all()
    .sort((x, y) => y.attendees - x.attendees || x.id - y.id);

  return { clubs: clubRows, events: eventRows };
}

/**
 * Slash command usage in the period, from `activity_commands`.
 *
 * @param p - The period.
 * @returns One row per command, most used first, ties by name. A failure is a run with `ok = 0`.
 */
export function botUsage(p: Period): CommandUsageRow[] {
  return db
    .select({
      name: activityCommands.name,
      uses: count(),
      failures: sql<number>`sum(case when ${activityCommands.ok} = 0 then 1 else 0 end)`,
    })
    .from(activityCommands)
    .where(inPeriod(activityCommands.ts, p))
    .groupBy(activityCommands.name)
    .all()
    .map((r) => ({ name: r.name, uses: r.uses, failures: Number(r.failures) }))
    .sort((x, y) => y.uses - x.uses || x.name.localeCompare(y.name));
}

/** Directed edges with a weight, before they are merged into pairs. */
type Edge = { from: string; to: string; weight: number };

/** Reply edges in the period: author to `replyToUserId`, self replies left out. */
function replyEdges(p: Period, userId?: string): Edge[] {
  return db
    .select({ from: activityMessages.userId, to: sql<string>`${activityMessages.replyToUserId}`, weight: count() })
    .from(activityMessages)
    .where(
      and(
        isNotNull(activityMessages.replyToUserId),
        ne(activityMessages.userId, activityMessages.replyToUserId),
        inPeriod(activityMessages.ts, p),
        notExcluded(activityMessages.channelId, activityMessages.parentChannelId),
        userId === undefined ? undefined : or(eq(activityMessages.userId, userId), eq(activityMessages.replyToUserId, userId)),
      ),
    )
    .groupBy(activityMessages.userId, activityMessages.replyToUserId)
    .all();
}

/** Mention edges in the period, from `activity_mentions`. */
function mentionEdges(p: Period, userId?: string): Edge[] {
  return db
    .select({ from: activityMentions.fromUserId, to: activityMentions.toUserId, weight: count() })
    .from(activityMentions)
    .where(
      and(
        ne(activityMentions.fromUserId, activityMentions.toUserId),
        inPeriod(activityMentions.ts, p),
        notExcluded(activityMentions.channelId, activityMentions.parentChannelId),
        userId === undefined ? undefined : or(eq(activityMentions.fromUserId, userId), eq(activityMentions.toUserId, userId)),
      ),
    )
    .groupBy(activityMentions.fromUserId, activityMentions.toUserId)
    .all();
}

/**
 * Voice co-presence in the period: for each pair, the seconds their segments
 * in the same channel overlapped, clipped to the period. An open segment runs
 * to its `lastSeenAt`. Each pair comes back once, with `from` the smaller id.
 * One sweep over the period's segments (`voice-overlap.ts`), not a self-join.
 */
function voiceEdges(p: Period): Edge[] {
  return voicePairs(voiceSpansIn(p)).map((pair) => ({ from: pair.a, to: pair.b, weight: pair.seconds }));
}

/**
 * The relationship web: who replies to, mentions, or sits in voice with whom.
 *
 * - `replies`: messages with a `replyToUserId` (a reply's ping is not a mention).
 * - `mentions`: rows of `activity_mentions`.
 * - `voice`: seconds of overlapping voice segments in the same channel.
 *
 * Pairs are symmetric: A to B and B to A are summed into one pair, with `a`
 * the smaller id. Self replies and self mentions are left out, and so are
 * excluded channels. Bots are never targets, since they are never recorded.
 *
 * `voice` is withheld until the voice log is ready (`voiceReady`, two whole
 * months of data): before that it is an empty list, never zero weights.
 * `replies` and `mentions` do not wait.
 *
 * @param p - The period.
 * @param kind - Which interactions to count.
 * @param voice - Whether voice is ready; only read for `kind = "voice"`.
 *   Compute it once per request and pass it in; left out, it is `voiceReady(p.to)`.
 * @returns At most {@link RELATIONS_LIMIT} pairs, heaviest first, ties by ids.
 */
export function relations(p: Period, kind: RelationKind, voice?: boolean): RelationPair[] {
  if (kind === "voice" && !(voice ?? voiceReady(p.to))) return [];
  const edges = kind === "replies" ? replyEdges(p) : kind === "mentions" ? mentionEdges(p) : voiceEdges(p);
  const pairs = new Map<string, RelationPair>();
  for (const e of edges) {
    const [a, b] = e.from < e.to ? [e.from, e.to] : [e.to, e.from];
    const key = `${a}\u0000${b}`;
    const pair = pairs.get(key) ?? { a, b, weight: 0 };
    pair.weight += e.weight;
    pairs.set(key, pair);
  }
  return [...pairs.values()]
    .sort((x, y) => y.weight - x.weight || x.a.localeCompare(y.a) || x.b.localeCompare(y.b))
    .slice(0, RELATIONS_LIMIT);
}

/**
 * One member's profile: what they sent and got, how many people they are tied
 * to, when they are most active, and their closest ties.
 *
 * Ties and closeness count replies and mentions in both directions (voice is in
 * {@link relations}, in seconds, and is not mixed in). It never reads voice, so
 * it needs no voice-readiness check. Excluded channels are left out. An
 * unknown member gets zeros, a null hour and no ties.
 *
 * @param userId - The member.
 * @param p - The period.
 */
export function memberInspect(userId: string, p: Period): MemberInspect {
  const visible = notExcluded(activityMessages.channelId, activityMessages.parentChannelId);
  const sent =
    db
      .select({ n: count() })
      .from(activityMessages)
      .where(and(eq(activityMessages.userId, userId), inPeriod(activityMessages.ts, p), visible))
      .get()?.n ?? 0;

  const hourExpr = sql<number>`cast(strftime('%H', ${activityMessages.ts}, 'unixepoch') as integer)`;
  const hour = db
    .select({ hour: hourExpr, n: count() })
    .from(activityMessages)
    .where(and(eq(activityMessages.userId, userId), inPeriod(activityMessages.ts, p), visible))
    .groupBy(hourExpr)
    .orderBy(sql`count(*) desc`, hourExpr)
    .limit(1)
    .get();

  let received = 0;
  const partners = new Map<string, number>();
  for (const e of [...replyEdges(p, userId), ...mentionEdges(p, userId)]) {
    const other = e.from === userId ? e.to : e.from;
    if (e.to === userId) received += e.weight;
    partners.set(other, (partners.get(other) ?? 0) + e.weight);
  }

  const closest: CloseRow[] = [...partners]
    .map(([id, weight]) => ({ userId: id, weight }))
    .sort((x, y) => y.weight - x.weight || x.userId.localeCompare(y.userId))
    .slice(0, CLOSEST_LIMIT);

  return { sent, received, ties: partners.size, busiestHour: hour?.hour ?? null, closest };
}
