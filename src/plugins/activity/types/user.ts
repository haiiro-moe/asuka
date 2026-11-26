/**
 * Shapes returned by the everyone-tier activity views (`queries/user.ts`).
 * User ids appear only in the member rankings (the most-reacted leaderboard and
 * the awards); every other view is
 * aggregate.
 */

/** A 7 by 24 grid of counts: rows are UTC weekdays (Monday first), columns UTC hours. */
export interface Heatmap {
  /** `cells[weekday][hour]`, weekday 0 = Monday. */
  cells: number[][];
  /** The largest cell; 0 for an empty grid. */
  max: number;
}

/** One emoji and how often it was used (in text plus net reactions). */
export interface EmojiRow {
  /** The stored key: a unicode emoji, or `custom:<id>`. */
  emoji: string;
  /** Custom emoji name; null for unicode emoji. */
  name: string | null;
  /** Uses in the period. */
  count: number;
}

/** One emoji's uses per week, oldest week first. */
export interface EmojiSeries {
  /** The stored key: a unicode emoji, or `custom:<id>`. */
  emoji: string;
  /** Custom emoji name; null for unicode emoji. */
  name: string | null;
  /** Uses per 7-day bucket, counted from the start of the series. */
  weekly: number[];
}

/** A message ranked by its net reaction count. */
export interface ReactedRow {
  /** The reacted-to message. */
  messageId: string;
  /** The channel, or thread, it is in. */
  channelId: string;
  /** Its author; null when unknown. */
  authorId: string | null;
  /** Reactions added minus reactions removed. */
  net: number;
}

/** A channel and a count (messages for text channels and threads, seconds for voice). */
export interface ChannelRow {
  /** The channel, or the thread itself. */
  channelId: string;
  /** The thread's parent channel; null for a normal channel. */
  parentChannelId: string | null;
  /** Messages, or connected seconds for voice. */
  count: number;
}

/** A {@link ChannelRow} with display names, as the routes return it. */
export interface NamedChannelRow extends ChannelRow {
  /** The channel's name; null when unknown or gone. */
  name: string | null;
  /** The parent channel's name; null for a normal channel or when unknown. */
  parentName: string | null;
}

/** What members share, by kind. */
export interface SharingRow {
  /** The kind of thing shared. */
  kind: "image" | "video" | "audio" | "link" | "gif" | "sticker";
  /** A short label: the kind itself, or the domain for links. */
  label: string;
  /** How many were shared. */
  count: number;
}

/** A named title and the member who holds it. */
export interface Award {
  /** Which award. */
  key: "night-owl" | "earliest-bird" | "longest-voice" | "fastest-replier" | "most-replied-to";
  /** The winner. */
  userId: string;
  /** Messages, seconds or reply count, depending on the award. */
  value: number;
}

/** The `rhythm` view: when members talk and when they are in voice. */
export interface Rhythm {
  /** Messages per UTC weekday and hour. */
  messages: Heatmap;
  /** Connected voice hours per cell; null until voice has two whole months of data. */
  voice: Heatmap | null;
}

/** The `voice-status` route: whether the voice views are unlocked yet. */
export interface VoiceStatus {
  /** True once the voice log holds two whole months. */
  ready: boolean;
  /** Unix seconds when voice unlocks; null when no voice has been recorded. */
  readyAt: number | null;
}
