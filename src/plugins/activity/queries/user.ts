/**
 * Queries behind the everyone-tier activity views.
 *
 * Every function takes a {@link Period} (unix seconds, `from` inclusive, `to`
 * exclusive), buckets in UTC with weekday 0 = Monday, and hides excluded
 * channels and the threads under them (`notExcluded`). They read the config on
 * each call, so call them only after `initDb()`. An empty log gives empty
 * arrays and a zero heatmap. See docs/activity/queries-user.md.
 */
import { and, desc, eq, gte, isNotNull, isNull, lt, sql } from "drizzle-orm";
import { db, schema } from "../../../db/index.ts";
import { notExcluded } from "../exclusion.ts";
import { weekdayHour } from "../time.ts";
import type { Period } from "../time.ts";
import type {
  Award,
  ChannelRow,
  EmojiRow,
  EmojiSeries,
  Heatmap,
  ReactedRow,
  SharingRow,
} from "../types/user.ts";

const WEEK = 7 * 86400;
const HOUR = 3600;

/** Domains whose links count as gifs rather than links. */
const GIF_DOMAINS = ["tenor.com", "giphy.com"];

/** A zeroed 7 by 24 grid. */
function emptyGrid(): number[][] {
  return Array.from({ length: 7 }, () => new Array<number>(24).fill(0));
}

/** Wrap a grid with its maximum. */
function heatmap(cells: number[][]): Heatmap {
  return { cells, max: Math.max(0, ...cells.flat()) };
}

/** Condition: message rows of the period outside excluded channels. */
function messagesIn(p: Period) {
  const m = schema.activityMessages;
  return and(gte(m.ts, p.from), lt(m.ts, p.to), notExcluded(m.channelId, m.parentChannelId));
}

/** Voice segments that overlap the period, as [channel, user, start, end] clipped to it. */
function voiceSegments(p: Period) {
  const v = schema.activityVoice;
  const end = sql<number>`coalesce(${v.endedAt}, ${v.lastSeenAt})`;
  const rows = db
    .select({ userId: v.userId, channelId: v.channelId, start: v.startedAt, end, closed: isNotNull(v.endedAt) })
    .from(v)
    .where(and(lt(v.startedAt, p.to), sql`${end} > ${p.from}`, notExcluded(v.channelId)))
    .all();
  return rows.map((r) => ({
    userId: r.userId,
    channelId: r.channelId,
    start: Math.max(r.start, p.from),
    end: Math.min(r.end, p.to),
    closed: Boolean(r.closed),
    full: r.end - r.start,
  }));
}

/**
 * When members talk and are in voice, by UTC weekday and hour.
 *
 * @param p - The period.
 * @returns `messages`: messages per cell. `voice`: connected hours per cell
 *   (a segment is spread over the hours it covers).
 */
export function rhythm(p: Period): { messages: Heatmap; voice: Heatmap } {
  const msgGrid = emptyGrid();
  const rows = db.select({ ts: schema.activityMessages.ts }).from(schema.activityMessages).where(messagesIn(p)).all();
  for (const { ts } of rows) {
    const { weekday, hour } = weekdayHour(ts);
    msgGrid[weekday]![hour]! += 1;
  }

  const voiceGrid = emptyGrid();
  for (const s of voiceSegments(p)) {
    for (let t = s.start - (s.start % HOUR); t < s.end; t += HOUR) {
      const overlap = Math.min(s.end, t + HOUR) - Math.max(s.start, t);
      if (overlap <= 0) continue;
      const { weekday, hour } = weekdayHour(t);
      voiceGrid[weekday]![hour]! += overlap / HOUR;
    }
  }
  return { messages: heatmap(msgGrid), voice: heatmap(voiceGrid) };
}

/** Emoji uses in the period: text rows and net reaction rows, one entry per use batch. */
function emojiUses(p: Period): { emoji: string; name: string | null; ts: number; n: number }[] {
  const e = schema.activityEmoji;
  const r = schema.activityReactions;
  const text = db
    .select({ emoji: e.emoji, name: e.name, ts: e.ts, n: e.count })
    .from(e)
    .where(and(gte(e.ts, p.from), lt(e.ts, p.to), notExcluded(e.channelId, e.parentChannelId)))
    .all();
  const reacts = db
    .select({ emoji: r.emoji, name: r.name, ts: r.addedAt })
    .from(r)
    .where(and(gte(r.addedAt, p.from), lt(r.addedAt, p.to), isNull(r.removedAt), notExcluded(r.channelId, r.parentChannelId)))
    .all();
  return [...text, ...reacts.map((x) => ({ ...x, n: 1 }))];
}

/** Total uses per emoji, most used first, ties by key. */
function emojiTotals(p: Period): EmojiRow[] {
  const totals = new Map<string, EmojiRow>();
  for (const u of emojiUses(p)) {
    const row = totals.get(u.emoji) ?? { emoji: u.emoji, name: null, count: 0 };
    row.count += u.n;
    row.name ??= u.name;
    totals.set(u.emoji, row);
  }
  return [...totals.values()].sort((a, b) => b.count - a.count || a.emoji.localeCompare(b.emoji));
}

/**
 * The most used emoji, text uses plus net reactions (removed ones excluded).
 *
 * @param p - The period.
 * @param limit - How many to return. Defaults to 20.
 */
export function emojiLeaderboard(p: Period, limit = 20): EmojiRow[] {
  return emojiTotals(p).slice(0, limit);
}

/**
 * Weekly use of the top emoji. Buckets are 7 days long, counted from the start
 * of the period (or, for an open-ended period, from the first recorded use).
 *
 * @param p - The period.
 * @param top - How many emoji to follow. Defaults to 5.
 */
export function emojiTrend(p: Period, top = 5): EmojiSeries[] {
  const uses = emojiUses(p);
  if (uses.length === 0) return [];
  const names = emojiTotals(p).slice(0, top);
  const start = p.from === 0 ? Math.min(...uses.map((u) => u.ts)) : p.from;
  const weeks = Math.max(1, Math.ceil((p.to - start) / WEEK));
  return names.map((row) => {
    const weekly = new Array<number>(weeks).fill(0);
    for (const u of uses) {
      if (u.emoji !== row.emoji) continue;
      const i = Math.min(weeks - 1, Math.floor((u.ts - start) / WEEK));
      weekly[i]! += u.n;
    }
    return { emoji: row.emoji, name: row.name, weekly };
  });
}

/**
 * Custom emoji of the guild that were never used, in text or as a reaction
 * (all time; removed reactions still count as use).
 *
 * @param guildEmojiIds - The guild's custom emoji ids.
 */
export function emojiGraveyard(guildEmojiIds: string[]): { id: string }[] {
  const e = schema.activityEmoji;
  const r = schema.activityReactions;
  const used = new Set<string>();
  for (const x of db.selectDistinct({ emoji: e.emoji }).from(e).where(notExcluded(e.channelId, e.parentChannelId)).all()) used.add(x.emoji);
  for (const x of db.selectDistinct({ emoji: r.emoji }).from(r).where(notExcluded(r.channelId, r.parentChannelId)).all()) used.add(x.emoji);
  return guildEmojiIds.filter((id) => !used.has(`custom:${id}`)).map((id) => ({ id }));
}

/**
 * Messages with the most reactions still standing.
 *
 * @param p - The period, matched on when the reaction was added.
 * @param limit - How many to return. Defaults to 10.
 */
export function mostReacted(p: Period, limit = 10): ReactedRow[] {
  const r = schema.activityReactions;
  const net = sql<number>`count(*)`;
  return db
    .select({ messageId: r.messageId, channelId: r.channelId, authorId: sql<string | null>`max(${r.messageAuthorId})`, net })
    .from(r)
    .where(and(gte(r.addedAt, p.from), lt(r.addedAt, p.to), isNull(r.removedAt), notExcluded(r.channelId, r.parentChannelId)))
    .groupBy(r.messageId, r.channelId)
    .orderBy(desc(net), r.messageId)
    .limit(limit)
    .all();
}

/**
 * Channels by message count; a thread counts toward its parent channel.
 *
 * @param p - The period.
 */
export function channelFavourites(p: Period): ChannelRow[] {
  const m = schema.activityMessages;
  const channel = sql<string>`coalesce(${m.parentChannelId}, ${m.channelId})`;
  const count = sql<number>`count(*)`;
  return db
    .select({ channelId: channel, count })
    .from(m)
    .where(messagesIn(p))
    .groupBy(channel)
    .orderBy(desc(count), channel)
    .all();
}

/**
 * Voice channels by connected seconds inside the period.
 *
 * @param p - The period.
 */
export function voiceFavourites(p: Period): ChannelRow[] {
  const totals = new Map<string, number>();
  for (const s of voiceSegments(p)) totals.set(s.channelId, (totals.get(s.channelId) ?? 0) + (s.end - s.start));
  return [...totals]
    .map(([channelId, count]) => ({ channelId, count }))
    .sort((a, b) => b.count - a.count || a.channelId.localeCompare(b.channelId));
}

/**
 * What members share: attachments by kind, stickers, gifs and links.
 * Links are listed per domain; a tenor or giphy domain is a gif. Attachments
 * of kind `other` are not listed.
 *
 * @param p - The period.
 */
export function sharing(p: Period): SharingRow[] {
  const m = schema.activityMessages;
  const rows = db
    .select({ kinds: m.attachmentKinds, domains: m.linkDomains, stickers: m.stickerCount })
    .from(m)
    .where(messagesIn(p))
    .all();
  const counts = new Map<string, SharingRow>();
  const add = (kind: SharingRow["kind"], label: string, n: number) => {
    if (n <= 0) return;
    const key = `${kind}\0${label}`;
    const row = counts.get(key) ?? { kind, label, count: 0 };
    row.count += n;
    counts.set(key, row);
  };
  for (const r of rows) {
    for (const k of r.kinds.split(",")) if (k === "image" || k === "video" || k === "audio") add(k, k, 1);
    add("sticker", "sticker", r.stickers);
    for (const d of r.domains.split(",")) {
      if (d === "") continue;
      const gif = GIF_DOMAINS.some((g) => d === g || d.endsWith(`.${g}`));
      add(gif ? "gif" : "link", d, 1);
    }
  }
  return [...counts.values()].sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
}

/** The winner of a tally: highest value, ties by user id. */
function top(key: Award["key"], tally: Map<string, number>, lowest = false): Award | null {
  let best: Award | null = null;
  for (const [userId, value] of [...tally].sort((a, b) => a[0].localeCompare(b[0]))) {
    if (!best || (lowest ? value < best.value : value > best.value)) best = { key, userId, value };
  }
  return best;
}

/** Median of a non-empty list. */
function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

/** Replies needed before someone can be the fastest replier. */
const MIN_REPLIES = 10;

/**
 * The period's awards; an award nobody qualifies for is left out.
 *
 * - `night-owl`: most messages 00:00 to 04:59 UTC (value: messages).
 * - `earliest-bird`: most messages 05:00 to 07:59 UTC (value: messages).
 * - `longest-voice`: the longest closed voice segment (value: seconds).
 * - `fastest-replier`: lowest median reply time, at least 10 replies whose
 *   parent was recorded (value: seconds).
 * - `most-replied-to`: most replies received from others (value: replies).
 *
 * @param p - The period.
 */
export function awards(p: Period): Award[] {
  const m = schema.activityMessages;
  const rows = db
    .select({ userId: m.userId, ts: m.ts, parent: m.replyToMessageId, to: m.replyToUserId })
    .from(m)
    .where(messagesIn(p))
    .all();

  const owl = new Map<string, number>();
  const bird = new Map<string, number>();
  const replied = new Map<string, number>();
  const replies: { userId: string; parent: string; ts: number }[] = [];
  for (const r of rows) {
    const { hour } = weekdayHour(r.ts);
    const bucket = hour < 5 ? owl : hour < 8 ? bird : null;
    bucket?.set(r.userId, (bucket.get(r.userId) ?? 0) + 1);
    if (r.to && r.to !== r.userId) replied.set(r.to, (replied.get(r.to) ?? 0) + 1);
    if (r.parent) replies.push({ userId: r.userId, parent: r.parent, ts: r.ts });
  }

  const voice = new Map<string, number>();
  for (const s of voiceSegments(p)) {
    if (s.closed) voice.set(s.userId, Math.max(voice.get(s.userId) ?? 0, s.full));
  }

  const parents = new Map<string, number>();
  if (replies.length > 0) {
    const ids = [...new Set(replies.map((r) => r.parent))];
    for (let i = 0; i < ids.length; i += 500) {
      const chunk = ids.slice(i, i + 500);
      const found = db
        .select({ id: m.messageId, ts: m.ts })
        .from(m)
        .where(and(sql`${m.messageId} in (${sql.join(chunk.map((c) => sql`${c}`), sql`, `)})`, notExcluded(m.channelId, m.parentChannelId)))
        .all();
      for (const f of found) parents.set(f.id, f.ts);
    }
  }
  const delays = new Map<string, number[]>();
  for (const r of replies) {
    const parentTs = parents.get(r.parent);
    if (parentTs === undefined) continue;
    const list = delays.get(r.userId) ?? [];
    list.push(Math.max(0, r.ts - parentTs));
    delays.set(r.userId, list);
  }
  const fastest = new Map<string, number>();
  for (const [userId, list] of delays) if (list.length >= MIN_REPLIES) fastest.set(userId, median(list));

  return [
    top("night-owl", owl),
    top("earliest-bird", bird),
    top("longest-voice", voice),
    top("fastest-replier", fastest, true),
    top("most-replied-to", replied),
  ].filter((a): a is Award => a !== null);
}
