/**
 * Pure helpers that decide what the president connection page draws for each value. No DOM and no
 * server imports, so they are unit-tested with `bun test`.
 *
 * The one rule they keep: a `null` from the server means **hidden** (or, for voice, not yet), and is
 * never drawn as `0`. A real `0` is drawn as `0`.
 *
 * @module
 */
import type { ActivityTile } from "../charts.tsx";

/** The two periods a president view can be asked for. */
export type Period = "week" | "term";

/** The text of an `off` tile's value: a hidden figure is named, never given a number. */
export const OFF_VALUE = "off";

/**
 * The note under a hidden figure.
 *
 * @param period - The period on screen. The term can also hide a number for being too close to the
 *   week's, so its note says so.
 * @returns A short lowercase note starting with `hidden:`.
 */
export function hiddenNote(period: Period): string {
  return period === "week"
    ? "hidden: too few to show"
    : "hidden: too few to show, or too close to the week's";
}

/** Options of {@link countTile}. */
export interface CountTileOptions {
  /** The period on screen, for the wording of the hidden note. */
  period: Period;
  /** The small mono text after a shown value (for example `of 14`). Never drawn on an `off` tile. */
  unit?: string;
  /** The line under a shown value. */
  note?: string;
}

/**
 * Builds a stat tile for a count that can be hidden.
 *
 * @param label - The tile's lowercase label.
 * @param value - The count, or `null` when the server hid it.
 * @param options - See {@link CountTileOptions}.
 * @returns A dashed `off` tile with {@link OFF_VALUE} and the hidden note for `null`; otherwise a tile
 *   whose value is the number as text, so `0` stays `"0"`.
 */
export function countTile(label: string, value: number | null, options: CountTileOptions): ActivityTile {
  if (value === null || !Number.isFinite(value)) {
    return { label, value: OFF_VALUE, note: hiddenNote(options.period), off: true };
  }
  return { label, value: value.toLocaleString("en-GB"), unit: options.unit, note: options.note };
}

/**
 * The unit after the "in groups" count: `of N` when the total is shown, nothing when it is hidden.
 *
 * @param total - Active members, or `null` when hidden.
 * @returns `"of 14"` or `undefined`.
 */
export function totalUnit(total: number | null): string | undefined {
  return total === null || !Number.isFinite(total) ? undefined : `of ${total.toLocaleString("en-GB")}`;
}

/** What the column chart for one weekly series shows. */
export type SeriesView =
  | { kind: "hidden" }
  | { kind: "empty" }
  | { kind: "columns"; values: number[]; latest: number };

/**
 * Decides how a weekly series is drawn.
 *
 * @param values - The series, or `null` when the server withholds it.
 * @returns `hidden` for `null` (the caller says why, never a chart of zeros), `empty` for a series
 *   with no weeks, otherwise the columns and the last week's value.
 */
export function seriesView(values: number[] | null): SeriesView {
  if (values === null) return { kind: "hidden" };
  const clean = values.map((v) => (Number.isFinite(v) ? v : 0));
  if (clean.length === 0) return { kind: "empty" };
  return { kind: "columns", values: clean, latest: clean[clean.length - 1]! };
}

/** One bar of the group-size list. */
export interface GroupBar {
  label: string;
  value: number;
  sub?: string;
}

/**
 * Builds the group-size bars: one per listed group, largest first as given, and an `other` row only
 * when `other` is a number.
 *
 * @param sizes - Member counts of the listed groups.
 * @param other - Members outside the groups, or `null` when hidden (then there is no row at all).
 * @returns The bars, in the order given.
 */
export function groupBars(sizes: number[], other: number | null): GroupBar[] {
  const bars: GroupBar[] = sizes.map((size) => ({ label: `group of ${size}`, value: size }));
  if (other !== null && Number.isFinite(other)) bars.push({ label: "other", value: other, sub: "outside groups" });
  return bars;
}

/**
 * Whether the group count is larger than the list: a group was left out on purpose. The page only says
 * so; it never works out what is missing.
 *
 * @param groups - The count of groups, or `null`.
 * @param listed - How many groups the list holds.
 * @returns `true` when `groups` is a number above `listed`.
 */
export function groupsLeftOut(groups: number | null, listed: number): boolean {
  return groups !== null && groups > listed;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/**
 * Formats a Unix-seconds time as a UTC date, like `1 Feb 2027`.
 *
 * @param seconds - Unix seconds.
 * @returns The date, or `null` when `seconds` is not a finite number.
 */
export function formatUtcDate(seconds: number | null | undefined): string | null {
  if (seconds == null || !Number.isFinite(seconds)) return null;
  const d = new Date(seconds * 1000);
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

/**
 * The narrator line that stands in for the voice chart while voice is withheld.
 *
 * @param readyAt - Unix seconds when voice unlocks, or `null`/`undefined` when unknown (no voice has
 *   been recorded yet, or the status has not arrived).
 * @returns `voice stats unlock on 1 Feb 2027`, or a dateless line when the date is unknown.
 */
export function voiceLockedLine(readyAt: number | null | undefined): string {
  const date = formatUtcDate(readyAt);
  return date ? `voice stats unlock on ${date}.` : "voice stats unlock once two whole months of voice are recorded.";
}
