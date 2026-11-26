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
import { and, count, desc, eq, gte, lt, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/sqlite-core";
import { env } from "../../../config/env.ts";
import type { BotContext } from "../../../core/plugin.ts";
import { nowSec } from "../../../core/util.ts";
import { db, schema } from "../../../db/index.ts";
import { notExcluded } from "../exclusion.ts";
import { voiceReadiness } from "../voice-ready.ts";
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
  /** Whether voice figures may be shown (default: `voiceReadiness()`, checked once). */
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
  const voiceReady = deps.voiceReady ?? voiceReadiness().ready;
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
 * The pair with the highest weight that year, in one SQL query: replies
 * between them (either way) plus, once voice is ready, voice overlap in the
 * same channel.
 */
function bestPairOf(from: number, to: number, voiceReady: boolean): { aId: string; bId: string; replies: number; seconds: number } | null {
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
 * Resolve a server Wrapped token, ready to serve.
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
): { year: number; data: ServerWrapped } | null {
  if (typeof token !== "string" || token.length !== 43) return null;
  const row = db.select().from(schema.activityWrappedServer).where(eq(schema.activityWrappedServer.token, token)).get();
  if (!row?.data) return null;
  const data = JSON.parse(row.data) as ServerWrapped;
  if (data.bestPair && !(optedIn(data.bestPair.aId) && optedIn(data.bestPair.bId))) data.bestPair = null;
  return { year: row.year, data };
}

