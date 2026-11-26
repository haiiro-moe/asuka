/**
 * Formatting helpers shared by every activity page (user, president, admin): the one UTC date in the
 * house style (`1 Feb 2027`) and the narrator line that stands in for voice while it is withheld. No
 * DOM and no server imports, so they are unit-tested with `bun test`.
 *
 * @module
 */

/** Month abbreviations of the house style, January first. Fixed, never from `Intl`. */
export const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;

/**
 * Formats unix seconds as a UTC date, `1 Feb 2027`. Written by hand rather than with
 * `toLocaleDateString`, because some ICU builds spell September `Sept` in `en-GB`.
 *
 * @param seconds - Unix seconds; `null`, `undefined` and non-finite values give an empty string.
 * @param withYear - Leave the year out with `false` (`1 Feb`), for axis labels.
 * @returns The date, or `""` when there is none.
 */
export function formatUtcDate(seconds: number | null | undefined, withYear = true): string {
  if (seconds == null || !Number.isFinite(seconds)) return "";
  const d = new Date(seconds * 1000);
  const day = `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
  return withYear ? `${day} ${d.getUTCFullYear()}` : day;
}

/**
 * The narrator line shown in place of the voice parts while voice is withheld, on the user and
 * president pages.
 *
 * @param readyAt - Unix seconds when voice unlocks, or `null`/`undefined` when unknown (no voice has
 *   been recorded yet, or the status has not arrived).
 * @returns `voice stats unlock on 1 Feb 2027.`, or a dateless line when the date is unknown.
 */
export function voiceLockedLine(readyAt: number | null | undefined): string {
  const date = formatUtcDate(readyAt);
  return date ? `voice stats unlock on ${date}.` : "voice stats unlock once two whole months of voice are recorded.";
}

/** Formats a chart value for a label: whole numbers with separators, others to one decimal. */
function chartNumber(v: number): string {
  return v.toLocaleString("en-GB", { maximumFractionDigits: 1 });
}

/** The index of the largest value above zero, or null; ties go to the first. */
function peakOf(values: number[]): number | null {
  let best: number | null = null;
  values.forEach((v, i) => {
    if (v > 0 && (best === null || v > values[best]!)) best = i;
  });
  return best;
}

/**
 * The accessible name of a heatmap: what it counts and its busiest cell, like
 * `messages by weekday and hour, utc; busiest tue 21:00`. It names no member and no id.
 *
 * @param subject - What the heatmap counts, lowercase, with `utc` when it is bucketed so.
 * @param rowLabels - The row labels (weekday names).
 * @param cells - `cells[row][hour]`.
 * @returns The label, or the subject with `; nothing counted` when every cell is zero.
 */
export function heatmapAriaLabel(subject: string, rowLabels: string[], cells: number[][]): string {
  let best: { r: number; c: number; v: number } | null = null;
  cells.forEach((row, r) =>
    row.forEach((v, c) => {
      if (v > 0 && (best === null || v > best.v)) best = { r, c, v };
    }),
  );
  if (!best) return `${subject}; nothing counted`;
  const { r, c } = best as { r: number; c: number };
  return `${subject}; busiest ${rowLabels[r] ?? `row ${r + 1}`} ${String(c).padStart(2, "0")}:00`;
}

/**
 * The accessible name of a column chart: what it counts, the highest column and the latest one, like
 * `replies per week; highest week of 2 Nov at 40, latest 12`. It names no member and no id.
 *
 * @param subject - What the columns count, lowercase.
 * @param values - One value per column.
 * @param name - Names a column by index (`21:00`, `week of 2 Nov`).
 * @param latest - Also give the last column's value (for a time series).
 * @returns The label, or the subject with `; nothing counted` when every value is zero.
 */
export function columnsAriaLabel(subject: string, values: number[], name: (i: number) => string, latest = false): string {
  const peak = peakOf(values);
  if (peak === null) return `${subject}; nothing counted`;
  const tail = latest && values.length > 0 ? `, latest ${chartNumber(values[values.length - 1] ?? 0)}` : "";
  return `${subject}; highest ${name(peak)} at ${chartNumber(values[peak]!)}${tail}`;
}

/**
 * Names an hour of the day for a chart label: `21:00`.
 *
 * @param hour - 0 to 23.
 */
export function hourName(hour: number): string {
  return `${String(hour).padStart(2, "0")}:00`;
}

/**
 * Names a column of a weekly series by its place, for a chart label: `the latest week` for the last,
 * `week 3 of 12` otherwise.
 *
 * @param i - The column's index, oldest first.
 * @param count - How many columns the series has.
 */
export function weekName(i: number, count: number): string {
  return i === count - 1 ? "the latest week" : `week ${i + 1} of ${count}`;
}
