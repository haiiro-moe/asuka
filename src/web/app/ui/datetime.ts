/**
 * Typed dates for {@link DateTimeField}: `YYYY-MM-DD HH:mm` (or `YYYY-MM-DD`) in the visitor's time
 * zone, and the dates shown in copy (`4 Nov 2026`). Native pickers cannot be themed, so dates are typed.
 *
 * @module
 */

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

const pad = (n: number) => String(n).padStart(2, "0");

/**
 * Writes a date the way the field expects it typed.
 *
 * @param d - The date, read in local time.
 * @param dateOnly - Leave out the time.
 * @returns `2026-11-28 20:00`, or `2026-11-28` with `dateOnly`; empty for null.
 */
export function formatDateTimeInput(d: Date | null | undefined, dateOnly = false): string {
  if (!d || Number.isNaN(d.getTime())) return "";
  const day = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  return dateOnly ? day : `${day} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** The outcome of {@link parseDateTimeInput}: a date (null for an empty field) or the reason it is not one. */
export type ParsedDate = { ok: true; date: Date | null } | { ok: false; error: string };

/**
 * Reads a typed date in local time and checks that it exists.
 *
 * @param text - What was typed, for example `2026-11-28 20:00`. Surrounding spaces are ignored and a `T`
 *   between date and time is accepted.
 * @param dateOnly - Expect `YYYY-MM-DD` only.
 * @returns The date (midnight local time with `dateOnly`), `null` for an empty field, or an error
 *   sentence such as `There is no 31 November.`
 */
export function parseDateTimeInput(text: string, dateOnly = false): ParsedDate {
  const t = text.trim();
  if (!t) return { ok: true, date: null };
  const re = dateOnly ? /^(\d{4})-(\d{1,2})-(\d{1,2})$/ : /^(\d{4})-(\d{1,2})-(\d{1,2})[ T](\d{1,2}):(\d{2})$/;
  const m = re.exec(t);
  const shape = dateOnly ? "Type it as year-month-day, like 2026-11-28." : "Type it as year-month-day hour:minute, like 2026-11-28 20:00.";
  if (!m) return { ok: false, error: shape };
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const da = Number(m[3]);
  const h = dateOnly ? 0 : Number(m[4]);
  const mi = dateOnly ? 0 : Number(m[5]);
  if (mo < 1 || mo > 12) return { ok: false, error: "Months run from 01 to 12." };
  const last = new Date(y, mo, 0).getDate();
  if (da < 1 || da > last) return { ok: false, error: `There is no ${da} ${MONTHS[mo - 1]}.` };
  if (h > 23 || mi > 59) return { ok: false, error: "Hours run from 00 to 23, minutes from 00 to 59." };
  return { ok: true, date: new Date(y, mo - 1, da, h, mi) };
}

/** The visitor's time zone as a short place name, for example `Budapest`. */
export function timeZoneName(): string {
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone ?? "";
  return tz.split("/").pop()?.replace(/_/g, " ") || "local time";
}

/**
 * A date as copy writes it: `4 Nov 2026`.
 *
 * @param d - The date, read in local time.
 */
export function formatDay(d: Date): string {
  return `${d.getDate()} ${MONTHS[d.getMonth()]!.slice(0, 3)} ${d.getFullYear()}`;
}

/** The lowercase month name and year, for example `november 2026`. */
export function formatMonth(d: Date): string {
  return `${MONTHS[d.getMonth()]!.toLowerCase()} ${d.getFullYear()}`;
}

/** The local calendar day of `d` as a key, `2026-11-28`. */
export function dayKey(d: Date): string {
  return formatDateTimeInput(d, true);
}
