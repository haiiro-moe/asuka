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
import { and, count, eq, gt, gte, inArray, isNotNull, lt, max, min, ne, or, sql, sum } from "drizzle-orm";
import { alias } from "drizzle-orm/sqlite-core";
import { db, schema } from "../../../db/index.ts";
import { notExcluded } from "../exclusion.ts";
import { QUIET_DAYS } from "../time.ts";
import type { Period } from "../time.ts";
import type {
  ActionCount,
  ChannelHealthRow,
  ClubRow,
  ClubsAndEvents,
  CloseRow,
  CommandUsageRow,
  DriftRow,
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
 * Where a weekly series starts: at the period's start, or at the table's first
 * row when that is later (so `all` does not start at 1970).
 *
 * @param p - The period.
 * @param firstTs - The table's earliest timestamp; null for an empty table.
 */
function seriesStart(p: Period, firstTs: number | null): number {
  return firstTs == null ? p.from : Math.max(p.from, firstTs);
}

/** Number of 7-day buckets from `start` to the end of the period (the last one may be partial). */
function weekCount(p: Period, start: number): number {
  return Math.max(0, Math.ceil((p.to - start) / WEEK));
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
 * Counts the {@link MOD_ACTIONS} rows of `mod_log` in the period. Weekly
 * buckets start at the period's start, or at the first moderation entry when
 * that is later.
 *
 * @param p - The period.
 * @returns Actions per week and per kind (most frequent first, ties by name).
 */
export function moderationSeries(p: Period): ModerationSeries {
  const actions = [...MOD_ACTIONS];
  const rows = db
    .select({ action: modLog.action, ts: modLog.createdAt })
    .from(modLog)
    .where(and(inArray(modLog.action, actions), inPeriod(modLog.createdAt, p)))
    .all();
  const first = db
    .select({ ts: min(modLog.createdAt) })
    .from(modLog)
    .where(inArray(modLog.action, actions))
    .get();

  const start = seriesStart(p, first?.ts ?? null);
  const weekly = new Array<number>(weekCount(p, start)).fill(0);
  const byKind = new Map<string, number>();
  for (const r of rows) {
    if (r.ts >= start) weekly[Math.floor((r.ts - start) / WEEK)]!++;
    byKind.set(r.action, (byKind.get(r.action) ?? 0) + 1);
  }

  const byAction: ActionCount[] = [...byKind]
    .map(([action, n]) => ({ action, count: n }))
    .sort((x, y) => y.count - x.count || x.action.localeCompare(y.action));
  return { weekly, byAction };
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
 * @param p - The period; its length sets how far back "previously active" reaches.
 * @returns Drifting members, most recently active first.
 */
export function drift(p: Period): DriftRow[] {
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

  const voiceEnd = sql<number>`coalesce(${activityVoice.endedAt}, ${activityVoice.lastSeenAt})`;
  for (const r of db
    .select({ userId: activityVoice.userId, ts: sql<number | null>`max(min(${voiceEnd}, ${p.to}))` })
    .from(activityVoice)
    .where(and(lt(activityVoice.startedAt, p.to), notExcluded(activityVoice.channelId)))
    .groupBy(activityVoice.userId)
    .all())
    keep(r.userId, r.ts);

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
 * Health of each text channel: how many messages go unanswered and how fast
 * the others get a reply.
 *
 * A message is answered when someone other than its author replied to it in
 * the period; its reply time is the time to the first such reply. Messages in
 * a thread count under the thread's parent channel. Channels without messages
 * in the period are not listed.
 *
 * @param p - The period.
 * @returns Channels by message count, busiest first, ties by id.
 */
export function channelHealth(p: Period): ChannelHealthRow[] {
  const visible = notExcluded(activityMessages.channelId, activityMessages.parentChannelId);
  const messages = db
    .select({
      messageId: activityMessages.messageId,
      userId: activityMessages.userId,
      channelId: activityMessages.channelId,
      parentChannelId: activityMessages.parentChannelId,
      ts: activityMessages.ts,
      replyToMessageId: activityMessages.replyToMessageId,
    })
    .from(activityMessages)
    .where(and(inPeriod(activityMessages.ts, p), visible))
    .orderBy(activityMessages.ts)
    .all();

  const byId = new Map(messages.map((m) => [m.messageId, m]));
  const firstReply = new Map<string, number>();
  for (const r of messages) {
    if (r.replyToMessageId == null) continue;
    const target = byId.get(r.replyToMessageId);
    if (!target || target.userId === r.userId || r.ts < target.ts) continue;
    if (!firstReply.has(target.messageId)) firstReply.set(target.messageId, r.ts - target.ts);
  }

  const channels = new Map<string, { messages: number; delays: number[] }>();
  for (const m of messages) {
    const key = m.parentChannelId ?? m.channelId;
    const c = channels.get(key) ?? { messages: 0, delays: [] };
    c.messages++;
    const delay = firstReply.get(m.messageId);
    if (delay !== undefined) c.delays.push(delay);
    channels.set(key, c);
  }

  return [...channels]
    .map(([channelId, c]) => ({
      channelId,
      messages: c.messages,
      unansweredPct: round1((100 * (c.messages - c.delays.length)) / c.messages),
      medianReplySec: c.delays.length > 0 ? median(c.delays) : null,
    }))
    .sort((x, y) => y.messages - x.messages || x.channelId.localeCompare(y.channelId));
}

/**
 * The Social Credits economy, from the `activity_credits` ledger and
 * `store_purchases`.
 *
 * Positive deltas are credits in, negative deltas credits out (returned as a
 * positive amount). Weekly buckets start at the period's start, or at the
 * ledger's first row when that is later.
 *
 * @param p - The period.
 * @returns Totals, the weekly series, the top earners by positive net and the number of store purchases.
 */
export function economy(p: Period): Economy {
  const rows = db
    .select({ userId: activityCredits.userId, delta: activityCredits.delta, ts: activityCredits.ts })
    .from(activityCredits)
    .where(inPeriod(activityCredits.ts, p))
    .all();
  const first = db.select({ ts: min(activityCredits.ts) }).from(activityCredits).get();

  const start = seriesStart(p, first?.ts ?? null);
  const weekly: EconomyWeek[] = Array.from({ length: weekCount(p, start) }, () => ({ in: 0, out: 0 }));
  const net = new Map<string, number>();
  let creditsIn = 0;
  let creditsOut = 0;
  for (const r of rows) {
    const week = r.ts >= start ? weekly[Math.floor((r.ts - start) / WEEK)] : undefined;
    if (r.delta > 0) {
      creditsIn += r.delta;
      if (week) week.in += r.delta;
    } else {
      creditsOut -= r.delta;
      if (week) week.out -= r.delta;
    }
    net.set(r.userId, (net.get(r.userId) ?? 0) + r.delta);
  }

  const topEarners = [...net]
    .filter(([, n]) => n > 0)
    .map(([userId, n]) => ({ userId, net: n }))
    .sort((x, y) => y.net - x.net || x.userId.localeCompare(y.userId))
    .slice(0, TOP_EARNERS_LIMIT);

  const sales = db.select({ n: count() }).from(storePurchases).where(inPeriod(storePurchases.createdAt, p)).get();
  return { creditsIn, creditsOut, weekly, topEarners, storeSales: sales?.n ?? 0 };
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
  const clubRows: ClubRow[] = [];
  for (const c of db
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
    .all()) {
    const channels = [c.threadId, c.channelId, c.voiceChannelId].filter((id): id is string => id != null);
    let messages = 0;
    let lastTs: number | null = null;
    if (channels.length > 0) {
      const inClub = and(
        or(inArray(activityMessages.channelId, channels), inArray(activityMessages.parentChannelId, channels)),
        notExcluded(activityMessages.channelId, activityMessages.parentChannelId),
      );
      messages = db.select({ n: count() }).from(activityMessages).where(and(inClub, inPeriod(activityMessages.ts, p))).get()?.n ?? 0;
      lastTs = db.select({ ts: max(activityMessages.ts) }).from(activityMessages).where(and(inClub, lt(activityMessages.ts, p.to))).get()?.ts ?? null;
    }
    const dead = c.createdAt <= quietStart && (lastTs == null || lastTs < quietStart);
    clubRows.push({ id: c.id, name: c.name, messages, dead });
  }
  clubRows.sort((x, y) => y.messages - x.messages || x.id - y.id);

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
 */
function voiceEdges(p: Period): Edge[] {
  const a = alias(activityVoice, "a");
  const b = alias(activityVoice, "b");
  const aEnd = sql`coalesce(${a.endedAt}, ${a.lastSeenAt})`;
  const bEnd = sql`coalesce(${b.endedAt}, ${b.lastSeenAt})`;
  const overlap = sql<number>`sum(min(${aEnd}, ${bEnd}, ${p.to}) - max(${a.startedAt}, ${b.startedAt}, ${p.from}))`;
  return db
    .select({ from: a.userId, to: b.userId, weight: overlap })
    .from(a)
    .innerJoin(
      b,
      and(eq(a.channelId, b.channelId), lt(a.userId, b.userId), lt(a.startedAt, bEnd), lt(b.startedAt, aEnd)),
    )
    .where(
      and(
        lt(a.startedAt, p.to),
        gt(aEnd, p.from),
        lt(b.startedAt, p.to),
        gt(bEnd, p.from),
        notExcluded(a.channelId),
      ),
    )
    .groupBy(a.userId, b.userId)
    .all()
    .map((e) => ({ ...e, weight: Number(e.weight) }));
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
 * @param p - The period.
 * @param kind - Which interactions to count.
 * @returns At most {@link RELATIONS_LIMIT} pairs, heaviest first, ties by ids.
 */
export function relations(p: Period, kind: RelationKind): RelationPair[] {
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
 * {@link relations}, in seconds, and is not mixed in). Excluded channels are
 * left out. An unknown member gets zeros, a null hour and no ties.
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
