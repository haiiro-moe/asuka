/**
 * Voice co-presence: how long two members sat in the same voice channel at
 * the same time.
 *
 * One sweep ({@link sharedVoiceSeconds}) serves every caller: the admin
 * relationship web, the president member web, the member Wrapped soulmate and
 * the server Wrapped best pair. Each caller builds its own spans (the part of
 * each segment inside its period), so each keeps its own rule for where an open
 * segment ends; the sweep only adds up the overlaps.
 *
 * The sweep sorts each channel's spans by start and keeps the spans still
 * running, so it reads every segment once instead of joining the table with
 * itself.
 *
 * @packageDocumentation
 */
import { and, gt, inArray, lt, ne, sql } from "drizzle-orm";
import { db, schema } from "../../../db/index.ts";
import { notExcluded } from "../exclusion.ts";
import type { Period } from "../time.ts";

/** The part of a voice segment that lies inside a period. */
export interface VoiceSpan {
  /** The member. */
  userId: string;
  /** The voice channel. */
  channelId: string;
  /** First second inside the period. */
  start: number;
  /** End, exclusive, and never after the period's end. */
  end: number;
}

/** One pair of members and the seconds they shared a voice channel. */
export interface VoicePair {
  /** The smaller id of the two. */
  a: string;
  /** The larger id of the two. */
  b: string;
  /** Seconds the two were in the same channel at the same time, always above 0. */
  seconds: number;
}

/**
 * How long each pair of members shared a voice channel.
 *
 * Every pair of spans of two different members in the same channel adds the
 * seconds the two spans overlap. A member's own spans never pair with each
 * other.
 *
 * @param spans - The spans, each already cut to the period (`end > start`).
 * @param onlyUserId - When given, only pairs that include this member are kept.
 * @returns For each member, the members with a larger id they shared a channel
 *   with, and for how many seconds in total. Only positive totals appear.
 */
export function sharedVoiceSeconds(spans: VoiceSpan[], onlyUserId?: string): Map<string, Map<string, number>> {
  const byChannel = new Map<string, VoiceSpan[]>();
  for (const span of spans) {
    if (span.end <= span.start) continue;
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
        if (onlyUserId !== undefined && other.userId !== onlyUserId && span.userId !== onlyUserId) continue;
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

/**
 * {@link sharedVoiceSeconds} as a flat list.
 *
 * @param spans - The spans, each already cut to the period.
 * @returns One entry per pair, in no particular order.
 */
export function voicePairs(spans: VoiceSpan[]): VoicePair[] {
  const out: VoicePair[] = [];
  for (const [a, row] of sharedVoiceSeconds(spans)) {
    for (const [b, seconds] of row) out.push({ a, b, seconds });
  }
  return out;
}

/**
 * The voice segments of a period, each cut to the part inside it, outside the
 * excluded channels. A segment that is still open runs to its `lastSeenAt`
 * (the last heartbeat that saw it).
 *
 * @param p - The period.
 * @param filter.userIds - Only the segments of these members.
 * @param filter.channelIds - Only the segments in these channels.
 * @param filter.notUserId - Leave this member's segments out.
 * @returns The spans, each at least a second long.
 */
export function voiceSpansIn(
  p: Period,
  filter: { userIds?: string[]; channelIds?: string[]; notUserId?: string } = {},
): VoiceSpan[] {
  if (filter.userIds?.length === 0 || filter.channelIds?.length === 0) return [];
  const v = schema.activityVoice;
  const end = sql<number>`coalesce(${v.endedAt}, ${v.lastSeenAt})`;
  const rows = db
    .select({ userId: v.userId, channelId: v.channelId, startedAt: v.startedAt, end })
    .from(v)
    .where(
      and(
        lt(v.startedAt, p.to),
        gt(end, p.from),
        notExcluded(v.channelId),
        filter.userIds ? inArray(v.userId, filter.userIds) : undefined,
        filter.channelIds ? inArray(v.channelId, filter.channelIds) : undefined,
        filter.notUserId !== undefined ? ne(v.userId, filter.notUserId) : undefined,
      ),
    )
    .all();
  const spans: VoiceSpan[] = [];
  for (const row of rows) {
    const start = Math.max(row.startedAt, p.from);
    const stop = Math.min(Number(row.end), p.to);
    if (stop > start) spans.push({ userId: row.userId, channelId: row.channelId, start, end: stop });
  }
  return spans;
}

/**
 * Seconds one member shared a voice channel with each other member in a
 * period. Only the member's own channels, and only the other members' spans
 * that fall inside the member's own time range, are read.
 *
 * @param userId - The member.
 * @param p - The period.
 * @returns One entry per other member with a positive total, by id.
 */
export function memberVoiceOverlaps(userId: string, p: Period): { userId: string; seconds: number }[] {
  const own = voiceSpansIn(p, { userIds: [userId] });
  if (own.length === 0) return [];
  const channels = [...new Set(own.map((s) => s.channelId))];
  const range = {
    from: own.reduce((lo, s) => Math.min(lo, s.start), Infinity),
    to: own.reduce((hi, s) => Math.max(hi, s.end), -Infinity),
  };
  const others = voiceSpansIn(range, { channelIds: channels, notUserId: userId });
  const out: { userId: string; seconds: number }[] = [];
  for (const [a, row] of sharedVoiceSeconds([...own, ...others], userId)) {
    for (const [b, seconds] of row) out.push({ userId: a === userId ? b : a, seconds });
  }
  return out.sort((x, y) => (x.userId < y.userId ? -1 : x.userId > y.userId ? 1 : 0));
}
