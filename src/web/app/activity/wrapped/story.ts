/**
 * The pure logic of the Wrapped story pages (`/wrapped/:token` and `/wrapped/s/:token`): which slides a
 * snapshot gets, how autoplay steps through them, the dither veil's frames and the small labels the
 * slides print. No React and no DOM here, so all of it is tested with `bun test`.
 *
 * @module
 */
import type { ServerWrapped, WrappedData, WrappedEmoji } from "../../../../plugins/activity/types/wrapped.ts";

/** Autoplay steps on one slide; one step is one second, so a slide stays six seconds. */
export const STEPS_PER_SLIDE = 6;

/** How long one autoplay step lasts, in milliseconds. */
export const STEP_MS = 1000;

/** How long the dither veil runs on a slide change, in milliseconds (three frames of 100 ms). */
export const VEIL_MS = 300;

/** Where a story is: the slide shown, the autoplay step on it, and whether autoplay is paused. */
export interface StoryState {
  /** Index of the current slide, `0..count-1`. */
  slide: number;
  /** Autoplay steps spent on the current slide, `0..STEPS_PER_SLIDE-1`. */
  step: number;
  /** While true, {@link tick} does nothing. */
  paused: boolean;
}

/**
 * One second of autoplay: adds a step, and after {@link STEPS_PER_SLIDE} steps moves to the next slide
 * with the step back at 0. Paused, or on the last slide, it returns `s` unchanged.
 *
 * @param s - The current state.
 * @param count - How many slides the story has.
 */
export function tick(s: StoryState, count: number): StoryState {
  if (s.paused || s.slide >= count - 1) return s;
  const step = s.step + 1;
  if (step >= STEPS_PER_SLIDE) return { ...s, slide: s.slide + 1, step: 0 };
  return { ...s, step };
}

/**
 * Jumps to a slide, clamped to `0..count-1`, with the step reset to 0. The pause is kept.
 *
 * @param s - The current state.
 * @param slide - The wanted slide index (may be out of range).
 * @param count - How many slides the story has.
 */
export function go(s: StoryState, slide: number, count: number): StoryState {
  const last = Math.max(0, count - 1);
  return { ...s, slide: Math.min(last, Math.max(0, Math.trunc(slide))), step: 0 };
}

/**
 * The dither veil's frame for the time since a slide change: 1 (sparse) from 0 to under 100 ms, 2 (dense,
 * the slide swaps here) from 100 to under 200 ms, 3 (sparse) from 200 to under 300 ms, and 0 (no veil)
 * otherwise. Stepped, never eased.
 *
 * @param msSinceChange - Milliseconds since the slide change started.
 */
export function veilFrame(msSinceChange: number): 0 | 1 | 2 | 3 {
  if (msSinceChange < 0 || msSinceChange >= VEIL_MS) return 0;
  if (msSinceChange < 100) return 1;
  if (msSinceChange < 200) return 2;
  return 3;
}

/**
 * How full one segment of the progress bar is, in percent: slides already seen are full, later ones
 * empty, the current one filled in sixths by its step. The last slide's segment is full once reached,
 * since autoplay stops there.
 *
 * @param s - The current state.
 * @param index - The segment's slide index.
 * @param count - How many slides the story has.
 */
export function segmentFill(s: StoryState, index: number, count: number): number {
  if (index < s.slide) return 100;
  if (index > s.slide) return 0;
  if (index >= count - 1) return 100;
  return Math.round((s.step / STEPS_PER_SLIDE) * 100);
}

/** What a key does on a story page. */
export type KeyAction = "prev" | "next" | "toggle";

/**
 * Maps a `KeyboardEvent.key` to a story action: left arrow goes back, right arrow goes on, Space plays or
 * pauses. Anything else is null.
 *
 * @param key - The event's `key`.
 */
export function keyAction(key: string): KeyAction | null {
  if (key === "ArrowLeft") return "prev";
  if (key === "ArrowRight") return "next";
  if (key === " " || key === "Spacebar") return "toggle";
  return null;
}

/** A pointer that moved further than this, in CSS pixels, was a scroll or a drag, not a tap. */
export const TAP_MOVE_PX = 10;

/** A pointer held longer than this, in milliseconds, was a press, not a tap. */
export const TAP_MAX_MS = 300;

/** The share of the slide's width, from the left, that goes back; the rest goes on. */
export const PREV_ZONE = 0.35;

/**
 * Decides what a pointer gesture on the slide area does, so tapping never blocks scrolling. A tap is a
 * press that moved at most {@link TAP_MOVE_PX} and lasted at most {@link TAP_MAX_MS}; in the left
 * {@link PREV_ZONE} of the width it goes back, anywhere else (the 35% line included) it goes on.
 * Anything else, and a width that is not a positive number, is `none`.
 *
 * @param dx - Horizontal movement between pointer down and up, in CSS pixels.
 * @param dy - Vertical movement, in CSS pixels.
 * @param ms - Time between pointer down and up.
 * @param x - Where the pointer went down, from the slide area's left edge.
 * @param width - The slide area's width.
 */
export function classifyTap(dx: number, dy: number, ms: number, x: number, width: number): "prev" | "next" | "none" {
  if (!(width > 0)) return "none";
  if (Math.hypot(dx, dy) > TAP_MOVE_PX || ms > TAP_MAX_MS) return "none";
  return x < width * PREV_ZONE ? "prev" : "next";
}

/* ------------------------------------------------------------------------------------------------ */

/** How many titles the titles slide lists before it says `and n more`. */
export const TITLES_SHOWN = 4;

/**
 * How many of a member's titles the titles slide lists, and how many it only counts.
 *
 * @param count - The member's titles.
 * @param max - The most to list; defaults to {@link TITLES_SHOWN}.
 */
export function titlesShown(count: number, max: number = TITLES_SHOWN): { shown: number; more: number } {
  const shown = Math.min(Math.max(0, count), max);
  return { shown, more: Math.max(0, count - shown) };
}

/* ------------------------------------------------------------------------------------------------ */

/** The slides a personal story can have, in the order they play. */
export type PersonalSlide =
  | "intro"
  | "messages"
  | "hour"
  | "emoji"
  | "voice"
  | "soulmate"
  | "club"
  | "president"
  | "titles"
  | "outro";

/**
 * The slides of a member's story, in order. Intro and outro are always there. A slide is left out when
 * its part of the snapshot is empty, so the story never shows a made-up zero:
 *
 * - `messages` needs at least one message, `hour` a busiest hour, `emoji` a top emoji;
 * - `voice` is skipped while `voiceHours` is null (voice withheld until two whole months of data);
 * - `soulmate` needs a soulmate or a most-replied-to member;
 * - `club` only when `data.club`, `president` only when `data.presidency`, `titles` only with titles.
 *
 * @param data - The link holder's snapshot.
 */
export function personalSlides(data: WrappedData): PersonalSlide[] {
  const out: PersonalSlide[] = ["intro"];
  if (data.messages > 0) out.push("messages");
  if (data.busiestHour !== null) out.push("hour");
  if (data.topEmoji.length > 0) out.push("emoji");
  if (data.voiceHours !== null) out.push("voice");
  if (data.soulmateId !== null || data.mostRepliedToId !== null) out.push("soulmate");
  if (data.club) out.push("club");
  if (data.presidency) out.push("president");
  if (data.titles.length > 0) out.push("titles");
  out.push("outro");
  return out;
}

/** The slides of the server story, in the order they play. */
export type ServerSlide = "intro" | "totals" | "emoji" | "channels" | "rhythm" | "pair" | "club" | "president" | "outro";

/**
 * The server story's slides: the fixed nine, with `pair`, `club` and `president` left out when that part
 * of the snapshot is null (the best pair is null unless both members opted in).
 *
 * @param data - The server snapshot.
 */
export function serverSlides(data: ServerWrapped): ServerSlide[] {
  const out: ServerSlide[] = ["intro", "totals", "emoji", "channels", "rhythm"];
  if (data.bestPair) out.push("pair");
  if (data.bestClub) out.push("club");
  if (data.president) out.push("president");
  out.push("outro");
  return out;
}

/* ------------------------------------------------------------------------------------------------ */

/**
 * A UTC hour as a clock reading, `07:00`.
 *
 * @param hour - 0 to 23.
 */
export function hourLabel(hour: number): string {
  return `${String(hour).padStart(2, "0")}:00`;
}

/**
 * An English ordinal: `1st`, `2nd`, `3rd`, `4th`, `11th`, `21st`.
 *
 * @param n - A whole number.
 */
export function ordinal(n: number): string {
  const tens = n % 100;
  if (tens >= 11 && tens <= 13) return `${n}th`;
  const unit = n % 10;
  return `${n}${unit === 1 ? "st" : unit === 2 ? "nd" : unit === 3 ? "rd" : "th"}`;
}

/** A number with thousands separators, `12,345`. */
export function formatNumber(n: number): string {
  return n.toLocaleString("en-GB");
}

/** The first letter in upper case, for a weekday at the start of a sentence: `Tuesday`. */
export function capitalise(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/**
 * How an emoji is written on a slide: a unicode emoji as itself (it is data), a custom one as `:name:`
 * (`:custom:` when its name is unknown). Custom emoji images are not fetched, so the page talks to no
 * other host.
 *
 * @param e - An emoji from a snapshot.
 */
export function emojiLabel(e: Pick<WrappedEmoji, "emoji" | "name">): string {
  if (e.emoji.startsWith("custom:")) return `:${e.name ?? "custom"}:`;
  return e.emoji;
}

/**
 * {@link emojiLabel} for a bare emoji key (such as `presidency.topEmojiInOffice`), taking a custom
 * emoji's name from a list of known emoji when one matches.
 *
 * @param key - The unicode emoji or `custom:<id>`.
 * @param known - Emoji with names, for example the snapshot's `topEmoji`.
 */
export function emojiKeyLabel(key: string, known: readonly Pick<WrappedEmoji, "emoji" | "name">[]): string {
  const hit = known.find((e) => e.emoji === key);
  return emojiLabel({ emoji: key, name: hit?.name ?? null });
}

/**
 * The Jacquard 24 size of a big readout: 86px (a crisp multiple of 43) for up to seven characters,
 * 64px for longer ones so they fit the phone column. Never smaller than 64px.
 *
 * @param text - The readout as printed.
 */
export function readoutSize(text: string): 86 | 64 {
  return [...text].length <= 7 ? 86 : 64;
}
