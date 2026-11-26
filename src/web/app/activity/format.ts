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
