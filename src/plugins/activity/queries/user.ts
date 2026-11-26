/**
 * Queries behind the everyone-tier activity views.
 *
 * Every function takes a {@link Period} (unix seconds, `from` inclusive, `to`
 * exclusive), buckets in UTC with weekday 0 = Monday, and hides excluded
 * channels and the threads under them (`notExcluded`). They read the config on
 * each call, so call them only after `initDb()`. An empty log gives empty
 * arrays and a zero heatmap. See docs/activity/queries-user.md.
 */
import { and, desc, eq, gte, inArray, isNotNull, isNull, lt, sql } from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import { alias } from "drizzle-orm/sqlite-core";
import { db, schema } from "../../../db/index.ts";
import { notExcluded } from "../exclusion.ts";
import { weekdayHour } from "../time.ts";
import { voiceReady } from "../voice-ready.ts";
import type { Period } from "../time.ts";
import type {
  Award,
  ChannelRow,
  EmojiRow,
  EmojiSeries,
  Heatmap,
  Rhythm,
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
 * Messages are counted in SQL (`GROUP BY` weekday and hour). Voice segments
 * are few, so they are read and spread over their hours in code.
 *
 * @param p - The period.
 * @param voiceOk - Whether voice data is old enough to show (`voiceReady()`); pass
 *   the result in when serving several views at once. Defaults to a fresh check.
 * @returns `messages`: messages per cell. `voice`: connected hours per cell
 *   (a segment is spread over the hours it covers), or null until voice is ready.
 */
export function rhythm(p: Period, voiceOk: boolean = voiceReady()): Rhythm {
  const m = schema.activityMessages;
  // Unix day 0 was a Thursday, so +3 makes Monday 0.
  const weekday = sql<number>`((${m.ts} / 86400) + 3) % 7`;
  const hour = sql<number>`(${m.ts} % 86400) / 3600`;
  const rows = db
    .select({ weekday, hour, n: sql<number>`count(*)` })
    .from(m)
    .where(messagesIn(p))
    .groupBy(weekday, hour)
    .all();
  const msgGrid = emptyGrid();
  for (const r of rows) msgGrid[r.weekday]![r.hour]! += r.n;

  const voiceGrid = emptyGrid();
  for (const s of voiceOk ? voiceSegments(p) : []) {
    for (let t = s.start - (s.start % HOUR); t < s.end; t += HOUR) {
      const overlap = Math.min(s.end, t + HOUR) - Math.max(s.start, t);
      if (overlap <= 0) continue;
      const { weekday: wd, hour: h } = weekdayHour(t);
      voiceGrid[wd]![h]! += overlap / HOUR;
    }
  }
  return { messages: heatmap(msgGrid), voice: voiceOk ? heatmap(voiceGrid) : null };
}

/** Condition: text-emoji rows of the period outside excluded channels. */
function textEmojiIn(p: Period) {
  const e = schema.activityEmoji;
  return and(gte(e.ts, p.from), lt(e.ts, p.to), notExcluded(e.channelId, e.parentChannelId));
}

/** Condition: reactions of the period that were not removed, outside excluded channels. */
function liveReactionsIn(p: Period) {
  const r = schema.activityReactions;
  return and(gte(r.addedAt, p.from), lt(r.addedAt, p.to), isNull(r.removedAt), notExcluded(r.channelId, r.parentChannelId));
}

/** Total uses per emoji, most used first, ties by key. One grouped scan per table. */
function emojiTotals(p: Period): EmojiRow[] {
  const e = schema.activityEmoji;
  const r = schema.activityReactions;
  const text = db
    .select({ emoji: e.emoji, name: sql<string | null>`max(${e.name})`, n: sql<number>`sum(${e.count})` })
    .from(e)
    .where(textEmojiIn(p))
    .groupBy(e.emoji)
    .all();
  const reacts = db
    .select({ emoji: r.emoji, name: sql<string | null>`max(${r.name})`, n: sql<number>`count(*)` })
    .from(r)
    .where(liveReactionsIn(p))
    .groupBy(r.emoji)
    .all();
  const totals = new Map<string, EmojiRow>();
  for (const u of [...text, ...reacts]) {
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
 * The totals are computed once, then one grouped query per table buckets only
 * the chosen emoji.
 *
 * @param p - The period.
 * @param top - How many emoji to follow. Defaults to 5.
 */
export function emojiTrend(p: Period, top = 5): EmojiSeries[] {
  const rows = emojiTotals(p).slice(0, top);
  if (rows.length === 0) return [];
  const e = schema.activityEmoji;
  const r = schema.activityReactions;
  const keys = rows.map((x) => x.emoji);

  let start = p.from;
  if (p.from === 0) {
    const t = db.select({ v: sql<number | null>`min(${e.ts})` }).from(e).where(and(textEmojiIn(p), inArray(e.emoji, keys))).get();
    const a = db.select({ v: sql<number | null>`min(${r.addedAt})` }).from(r).where(and(liveReactionsIn(p), inArray(r.emoji, keys))).get();
    start = Math.min(t?.v ?? Infinity, a?.v ?? Infinity);
  }
  const weeks = Math.max(1, Math.ceil((p.to - start) / WEEK));
  const textWeek = sql<number>`(${e.ts} - ${start}) / ${WEEK}`;
  const reactWeek = sql<number>`(${r.addedAt} - ${start}) / ${WEEK}`;
  const text = db
    .select({ emoji: e.emoji, w: textWeek, n: sql<number>`sum(${e.count})` })
    .from(e)
    .where(and(textEmojiIn(p), inArray(e.emoji, keys)))
    .groupBy(e.emoji, textWeek)
    .all();
  const reacts = db
    .select({ emoji: r.emoji, w: reactWeek, n: sql<number>`count(*)` })
    .from(r)
    .where(and(liveReactionsIn(p), inArray(r.emoji, keys)))
    .groupBy(r.emoji, reactWeek)
    .all();
  const series = new Map(rows.map((x) => [x.emoji, new Array<number>(weeks).fill(0)]));
  for (const u of [...text, ...reacts]) series.get(u.emoji)![Math.min(weeks - 1, Math.max(0, u.w))]! += u.n;
  return rows.map((x) => ({ emoji: x.emoji, name: x.name, weekly: series.get(x.emoji)! }));
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
 * Channels by message count. A thread is a channel of its own: it gets its own
 * row, with `parentChannelId` set, and is not folded into its parent.
 *
 * @param p - The period.
 */
export function channelFavourites(p: Period): ChannelRow[] {
  const m = schema.activityMessages;
  const count = sql<number>`count(*)`;
  return db
    .select({ channelId: m.channelId, parentChannelId: m.parentChannelId, count })
    .from(m)
    .where(messagesIn(p))
    .groupBy(m.channelId, m.parentChannelId)
    .orderBy(desc(count), m.channelId)
    .all();
}

/**
 * Voice channels by connected seconds inside the period.
 *
 * @param p - The period.
 * @param voiceOk - Whether voice data is old enough to show; the list is empty
 *   until it is. Defaults to a fresh `voiceReady()` check.
 */
export function voiceFavourites(p: Period, voiceOk: boolean = voiceReady()): ChannelRow[] {
  const totals = new Map<string, number>();
  for (const s of voiceOk ? voiceSegments(p) : []) totals.set(s.channelId, (totals.get(s.channelId) ?? 0) + (s.end - s.start));
  return [...totals]
    .map(([channelId, count]) => ({ channelId, parentChannelId: null, count }))
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
  /** Occurrences of a kind in the comma list; the kinds never contain one another. */
  const occurrences = (kind: string) =>
    sql<number>`coalesce(sum((length(${m.attachmentKinds}) - length(replace(${m.attachmentKinds}, ${kind}, ''))) / ${kind.length}), 0)`;
  const media = db
    .select({
      image: occurrences("image"),
      video: occurrences("video"),
      audio: occurrences("audio"),
      stickers: sql<number>`coalesce(sum(${m.stickerCount}), 0)`,
    })
    .from(m)
    .where(messagesIn(p))
    .get();
  // Identical domain lists are grouped in SQL; only the distinct lists are split here.
  const lists = db
    .select({ domains: m.linkDomains, n: sql<number>`count(*)` })
    .from(m)
    .where(and(messagesIn(p), sql`${m.linkDomains} != ''`))
    .groupBy(m.linkDomains)
    .all();

  const counts = new Map<string, SharingRow>();
  const add = (kind: SharingRow["kind"], label: string, n: number) => {
    if (n <= 0) return;
    const key = `${kind}\0${label}`;
    const row = counts.get(key) ?? { kind, label, count: 0 };
    row.count += n;
    counts.set(key, row);
  };
  add("image", "image", media?.image ?? 0);
  add("video", "video", media?.video ?? 0);
  add("audio", "audio", media?.audio ?? 0);
  add("sticker", "sticker", media?.stickers ?? 0);
  for (const l of lists) {
    for (const d of l.domains.split(",")) {
      if (d === "") continue;
      const gif = GIF_DOMAINS.some((g) => d === g || d.endsWith(`.${g}`));
      add(gif ? "gif" : "link", d, l.n);
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
 * @param voiceOk - Whether voice data is old enough to show; `longest-voice` is
 *   omitted until it is. Defaults to a fresh `voiceReady()` check.
 */
export function awards(p: Period, voiceOk: boolean = voiceReady()): Award[] {
  const m = schema.activityMessages;
  const hour = sql<number>`(${m.ts} % 86400) / 3600`;
  const tally = (key: Award["key"], range: SQL) => {
    const rows = db
      .select({ userId: m.userId, n: sql<number>`count(*)` })
      .from(m)
      .where(and(messagesIn(p), range))
      .groupBy(m.userId)
      .all();
    return top(key, new Map(rows.map((r) => [r.userId, r.n])));
  };
  const owl = tally("night-owl", sql`${hour} < 5`);
  const bird = tally("earliest-bird", sql`${hour} >= 5 and ${hour} < 8`);

  const replyRows = db
    .select({ userId: m.replyToUserId, n: sql<number>`count(*)` })
    .from(m)
    .where(and(messagesIn(p), isNotNull(m.replyToUserId), sql`${m.replyToUserId} != ${m.userId}`))
    .groupBy(m.replyToUserId)
    .all();
  const replied = top("most-replied-to", new Map(replyRows.map((r) => [r.userId!, r.n])));

  const voice = new Map<string, number>();
  for (const s of voiceOk ? voiceSegments(p) : []) {
    if (s.closed) voice.set(s.userId, Math.max(voice.get(s.userId) ?? 0, s.full));
  }

  // Replies whose parent was recorded and is not in an excluded channel.
  const parent = alias(schema.activityMessages, "parent");
  const joined = and(
    messagesIn(p),
    isNotNull(m.replyToMessageId),
    notExcluded(parent.channelId, parent.parentChannelId),
  );
  const qualifying = db
    .select({ userId: m.userId })
    .from(m)
    .innerJoin(parent, eq(parent.messageId, m.replyToMessageId))
    .where(joined)
    .groupBy(m.userId)
    .having(sql`count(*) >= ${MIN_REPLIES}`)
    .all()
    .map((r) => r.userId);
  const fastest = new Map<string, number>();
  if (qualifying.length > 0) {
    const delays = new Map<string, number[]>();
    const rows = db
      .select({ userId: m.userId, delay: sql<number>`max(0, ${m.ts} - ${parent.ts})` })
      .from(m)
      .innerJoin(parent, eq(parent.messageId, m.replyToMessageId))
      .where(and(joined, inArray(m.userId, qualifying)))
      .all();
    for (const r of rows) {
      const list = delays.get(r.userId) ?? [];
      list.push(r.delay);
      delays.set(r.userId, list);
    }
    for (const [userId, list] of delays) fastest.set(userId, median(list));
  }

  return [owl, bird, top("longest-voice", voice), top("fastest-replier", fastest, true), replied].filter(
    (a): a is Award => a !== null,
  );
}
