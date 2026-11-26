/**
 * The server-wide Wrapped: the whole server's year as one public story at
 * `/wrapped/s/<token>`.
 *
 * Only three kinds of people are named in it: the best pair (only when both
 * members opted in to Wrapped), the best club's founder and the president,
 * whose roles are public. Names are resolved when the snapshot is built and
 * stored in it, so opening the public story never calls Discord.
 *
 * Every number is aggregated in SQL. See docs/activity/wrapped.md.
 *
 * @packageDocumentation
 */
import { and, count, desc, eq, gte, isNotNull, lt, ne, sql } from "drizzle-orm";
import { env } from "../../../config/env.ts";
import type { BotContext } from "../../../core/plugin.ts";
import { nowSec } from "../../../core/util.ts";
import { db, schema } from "../../../db/index.ts";
import { notExcluded } from "../exclusion.ts";
import { voicePairs, voiceSpansIn } from "../queries/voice-overlap.ts";
import { voiceReadinessForYear } from "../voice-ready.ts";
import type { ServerWrapped } from "../types/wrapped.ts";
import {
  clubYearStats,
  electionsIn,
  emojiTotals,
  presidencyFor,
  presidencyTermsIn,
  presidentsOf,
  yearPeriod,
} from "./extras.ts";
import type { ClubYearStats, TermInYear } from "./extras.ts";
import { VOICE_OVERLAP_SECONDS_PER_POINT } from "./data.ts";
import { newToken } from "./links.ts";
import { isOptedIn } from "./optin.ts";
import { getPreviewServerByToken } from "./preview.ts";

/** Weekday names by SQLite `strftime('%w')` (0 = Sunday). */
const WEEKDAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];

/** Looks up display names while a snapshot is built. Returns null for unknown ids. */
export interface ServerNameLookup {
  /** A member's display name. */
  member(userId: string): string | null;
  /** A channel's plain name and, for a thread, its parent channel's name. */
  channel(channelId: string): { name: string | null; parentName: string | null } | null;
}

/** What {@link buildServerWrapped} reads besides the database. All optional. */
export interface ServerWrappedDeps {
  /** Ids of the guild's custom emoji, for `unusedCustomEmoji` (default none). */
  guildEmojiIds?: string[];
  /** Name lookup (default: every name null). */
  names?: ServerNameLookup;
  /** Opt-in check for the best pair (default: the opt-in table). */
  isOptedIn?: (userId: string) => boolean;
  /** Whether voice figures may be shown (default: `voiceReadinessForYear(year)`, checked once). */
  voiceReady?: boolean;
  /** Year aggregates already computed by a run. */
  clubs?: ClubYearStats[];
  terms?: TermInYear[];
}

/** A lookup that knows no names. */
const NO_NAMES: ServerNameLookup = { member: () => null, channel: () => null };

/**
 * Build the server's Wrapped for a UTC calendar year.
 *
 * - `messages`, `speakers`, `busiestHour`, `busiestWeekday`: all messages that year.
 * - `voiceHours`: all voice segments, clipped to the year; null while voice is
 *   not ready (`voice-ready.ts`), when voice is also left out of the best pair
 *   (`bestPair.voiceHours` null) and of the "nobody did anything" check.
 * - `topEmoji` (3) and `unusedCustomEmoji`: text and reactions merged.
 * - `topChannels` (5): grouped by the message's own channel, so a thread is a
 *   channel of its own and carries its parent's name.
 * - `bestPair`: the two members with the highest weight of replies between
 *   them (1 each) and voice time together (1 per 10 minutes); null unless both
 *   opted in. It is the top pair or nobody: no runner-up is named instead.
 * - `bestClub`: the approved club with the most messages, with its founder's name.
 * - `president`: whoever held the chair longest that year, with the number of
 *   elections that started that year and the members who stood in them.
 *
 * Excluded channels are left out everywhere.
 *
 * @param year - The UTC calendar year.
 * @param deps - Names, the guild's emoji and the opt-in check.
 * @returns The snapshot, or null when nobody wrote or spoke that year.
 */
export function buildServerWrapped(year: number, deps: ServerWrappedDeps = {}): ServerWrapped | null {
  const { from, to } = yearPeriod(year);
  const names = deps.names ?? NO_NAMES;
  const optedIn = deps.isOptedIn ?? isOptedIn;
  const voiceReady = deps.voiceReady ?? voiceReadinessForYear(year).ready;
  const m = schema.activityMessages;
  const v = schema.activityVoice;
  const msgYear = and(gte(m.ts, from), lt(m.ts, to), notExcluded(m.channelId, m.parentChannelId));

  const totals = db
    .select({ messages: count(), speakers: sql<number>`count(distinct ${m.userId})` })
    .from(m)
    .where(msgYear)
    .get();
  const messages = totals?.messages ?? 0;
  const vEnd = sql`coalesce(${v.endedAt}, ${v.lastSeenAt})`;
  const voiceSeconds = !voiceReady
    ? null
    : Number(
    db
      .select({ s: sql<number | null>`sum(max(0, min(${vEnd}, ${to}) - max(${v.startedAt}, ${from})))` })
      .from(v)
      .where(and(lt(v.startedAt, to), sql`${vEnd} > ${from}`, notExcluded(v.channelId)))
      .get()?.s ?? 0,
  );
  if (messages === 0 && !voiceSeconds) return null;

  const spans = [{ from, to }];
  const emojiKeys = (deps.guildEmojiIds ?? []).map((id) => `custom:${id}`);
  const usedCustom = emojiTotals({ spans, keys: emojiKeys, limit: emojiKeys.length || 1 }).length;

  const topChannels = db
    .select({ channelId: m.channelId, parentId: sql<string | null>`max(${m.parentChannelId})`, n: count() })
    .from(m)
    .where(msgYear)
    .groupBy(m.channelId)
    .orderBy(desc(count()), m.channelId)
    .limit(5)
    .all()
    .map((row) => {
      const own = names.channel(row.channelId);
      const parentName = row.parentId ? (own?.parentName ?? names.channel(row.parentId)?.name ?? null) : null;
      return { channelId: row.channelId, name: own?.name ?? null, parentName, count: row.n };
    });

  const hourExpr = sql<number>`cast(strftime('%H', ${m.ts}, 'unixepoch') as integer)`;
  const busiestHour =
    db.select({ h: hourExpr }).from(m).where(msgYear).groupBy(hourExpr).orderBy(desc(count()), hourExpr).limit(1).get()?.h ?? null;
  const dayExpr = sql<number>`cast(strftime('%w', ${m.ts}, 'unixepoch') as integer)`;
  const day = db
    .select({ d: dayExpr })
    .from(m)
    .where(msgYear)
    .groupBy(dayExpr)
    .orderBy(desc(count()), sql`(${dayExpr} + 6) % 7`)
    .limit(1)
    .get();

  const pair = bestPairOf(from, to, voiceReady);
  const bestPair =
    pair && optedIn(pair.aId) && optedIn(pair.bId)
      ? {
          aId: pair.aId,
          aName: names.member(pair.aId),
          bId: pair.bId,
          bName: names.member(pair.bId),
          replies: pair.replies,
          voiceHours: voiceReady ? Math.round(pair.seconds / 360) / 10 : null,
        }
      : null;

  const clubs = deps.clubs ?? clubYearStats(year, voiceReady);
  const top = clubs.filter((c) => c.messages > 0).sort((a, b) => b.messages - a.messages || a.clubId - b.clubId)[0];
  const bestClub = top ? { name: top.name, founderName: names.member(top.ownerId), members: top.members, messages: top.messages } : null;

  const terms = deps.terms ?? presidencyTermsIn(year);
  const longest = presidentsOf(terms)[0];
  let president: ServerWrapped["president"] = null;
  if (longest) {
    const p = presidencyFor(longest.userId, year, terms)!;
    president = {
      name: names.member(longest.userId),
      terms: p.terms,
      daysInOffice: p.daysInOffice,
      serverActivityPercent: p.serverActivityPercent,
      ...electionsIn(year),
    };
  }

  return {
    year,
    voiceReady,
    messages,
    speakers: Number(totals?.speakers ?? 0),
    voiceHours: voiceSeconds === null ? null : Math.round(voiceSeconds / 360) / 10,
    topEmoji: emojiTotals({ spans, limit: 3 }),
    unusedCustomEmoji: emojiKeys.length - usedCustom,
    topChannels,
    busiestHour,
    busiestWeekday: day ? WEEKDAYS[day.d]! : null,
    bestPair,
    bestClub,
    president,
  };
}

/**
 * The pair with the highest weight that year: replies between them (either
 * way, one point each) plus, once voice is ready, voice overlap in the same
 * channel (one point per {@link VOICE_OVERLAP_SECONDS_PER_POINT} seconds). The
 * replies are one grouped SQL query; the voice overlap is the shared sweep
 * (`queries/voice-overlap.ts`). Ties go to the smaller ids.
 *
 * @internal Exported for the voice-overlap characterisation tests.
 * @param from - Start of the year, inclusive.
 * @param to - End of the year, exclusive.
 * @param voiceReady - Whether voice counts.
 * @returns The pair (`aId` the smaller id) with its replies and shared seconds,
 *   or null when no pair has any weight.
 */
export function bestPairOf(from: number, to: number, voiceReady: boolean): { aId: string; bId: string; replies: number; seconds: number } | null {
  const m = schema.activityMessages;
  const a = sql<string>`min(${m.userId}, ${m.replyToUserId})`;
  const b = sql<string>`max(${m.userId}, ${m.replyToUserId})`;
  const replies = db
    .select({ a, b, n: count() })
    .from(m)
    .where(
      and(
        gte(m.ts, from),
        lt(m.ts, to),
        isNotNull(m.replyToUserId),
        ne(m.replyToUserId, m.userId),
        notExcluded(m.channelId, m.parentChannelId),
      ),
    )
    .groupBy(a, b)
    .all();

  const pairs = new Map<string, { aId: string; bId: string; replies: number; seconds: number }>();
  const entry = (aId: string, bId: string) => {
    const key = `${aId}\u0000${bId}`;
    let e = pairs.get(key);
    if (!e) {
      e = { aId, bId, replies: 0, seconds: 0 };
      pairs.set(key, e);
    }
    return e;
  };
  for (const row of replies) entry(row.a, row.b).replies += row.n;
  if (voiceReady) {
    for (const pair of voicePairs(voiceSpansIn({ from, to }))) entry(pair.a, pair.b).seconds += pair.seconds;
  }

  let best: { aId: string; bId: string; replies: number; seconds: number } | null = null;
  let bestScore = 0;
  for (const e of pairs.values()) {
    if (e.replies + e.seconds <= 0) continue;
    const score = e.replies + (e.seconds * 1.0) / VOICE_OVERLAP_SECONDS_PER_POINT;
    const wins =
      best === null ||
      score > bestScore ||
      (score === bestScore && (e.aId < best.aId || (e.aId === best.aId && e.bId < best.bId)));
    if (wins) {
      best = e;
      bestScore = score;
    }
  }
  return best;
}

/**
 * Build the default dependencies from the bot's guild cache: the custom emoji
 * ids and a name lookup. Members are fetched once first when the member cache
 * is incomplete, so names resolve from the cache.
 *
 * @param ctx - Bot context.
 */
export async function serverWrappedDeps(ctx: BotContext): Promise<ServerWrappedDeps> {
  const guild = ctx.client.guilds?.cache?.get(ctx.guildId);
  if (!guild) return {};
  if (guild.members.cache.size < guild.memberCount) await guild.members.fetch().catch(() => null);
  return {
    guildEmojiIds: [...guild.emojis.cache.keys()],
    names: {
      member: (id) => guild.members.cache.get(id)?.displayName ?? ctx.client.users.cache.get(id)?.displayName ?? null,
      channel: (id) => {
        const channel = guild.channels.cache.get(id);
        if (!channel) return null;
        return { name: channel.name, parentName: channel.isThread() ? (channel.parent?.name ?? null) : null };
      },
    },
  };
}

/**
 * The public URL of the server Wrapped.
 *
 * @param token - The year's server token.
 * @returns `${PUBLIC_URL}/wrapped/s/<token>`.
 */
export function serverWrappedUrl(token: string): string {
  return `${env.PUBLIC_URL}/wrapped/s/${token}`;
}

/** The stored server row of a year. */
export function getServerRow(year: number) {
  return db.select().from(schema.activityWrappedServer).where(eq(schema.activityWrappedServer.year, year)).get();
}

/**
 * The server Wrapped token of a year, making one (32 random bytes,
 * base64url) when the year has none. The token is kept for good.
 *
 * @param year - The UTC calendar year.
 */
export function getOrCreateServerToken(year: number): string {
  db.insert(schema.activityWrappedServer).values({ year, token: newToken(), createdAt: nowSec() }).onConflictDoNothing().run();
  return getServerRow(year)!.token;
}

/**
 * Store a year's server snapshot, keeping its token.
 *
 * @param year - The UTC calendar year.
 * @param data - The snapshot from {@link buildServerWrapped}.
 * @returns The token.
 */
export function storeServerWrapped(year: number, data: ServerWrapped): string {
  const token = getOrCreateServerToken(year);
  db.update(schema.activityWrappedServer)
    .set({ data: JSON.stringify(data) })
    .where(eq(schema.activityWrappedServer.year, year))
    .run();
  return token;
}

/**
 * Resolve a server Wrapped token, ready to serve: the year's real server story,
 * or an admin's private preview story (`preview: true`) while that preview
 * exists and is younger than 14 days.
 *
 * The stored best pair is checked against the opt-ins again on every read: a
 * member who opted out after the snapshot was built must not stay named, so
 * when either member is no longer opted in `bestPair` is replaced by null and
 * neither id nor name leaves this function.
 *
 * @param token - The token from the URL.
 * @param optedIn - Opt-in check (default: the opt-in table).
 * @returns The year and snapshot, or null for an unknown or truncated token, or
 *   a year with no snapshot yet.
 */
export function getServerWrappedByToken(
  token: string,
  optedIn: (userId: string) => boolean = isOptedIn,
): { year: number; data: ServerWrapped; preview: boolean } | null {
  if (typeof token !== "string" || token.length !== 43) return null;
  const row = db.select().from(schema.activityWrappedServer).where(eq(schema.activityWrappedServer.token, token)).get();
  let found: { year: number; data: ServerWrapped; preview: boolean } | null = null;
  if (row?.data) found = { year: row.year, data: JSON.parse(row.data) as ServerWrapped, preview: false };
  else {
    const priv = getPreviewServerByToken(token);
    if (priv) found = { ...priv, data: structuredClone(priv.data), preview: true };
  }
  if (!found) return null;
  const pair = found.data.bestPair;
  if (pair && !(optedIn(pair.aId) && optedIn(pair.bId))) found.data.bestPair = null;
  return found;
}

