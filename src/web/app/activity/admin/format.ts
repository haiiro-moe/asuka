/**
 * Pure formatting helpers of the admin diagnostics page: UTC dates in the house style (`4 Nov 2026`),
 * week labels for the weekly series, durations, reply times, channel labels and the stepped progress
 * width. No DOM and no server imports, so they are unit-tested with `bun test`.
 *
 * @module
 */

/** Seconds in one 7-day bucket of a weekly series. */
export const WEEK_SEC = 7 * 24 * 60 * 60;

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/**
 * Formats unix seconds as a UTC day, `1 Feb 2027`. Written by hand rather than with
 * `toLocaleDateString`, because some ICU builds spell September `Sept` in `en-GB`.
 *
 * @param sec - Unix seconds.
 * @param withYear - Leave the year out with `false` (`1 Feb`), for axis labels.
 * @returns The day, or an empty string for a value that is not a finite number.
 */
export function formatUtcDay(sec: number, withYear = true): string {
  if (!Number.isFinite(sec)) return "";
  const d = new Date(sec * 1000);
  const day = `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
  return withYear ? `${day} ${d.getUTCFullYear()}` : day;
}

/**
 * Labels the buckets of a weekly series from its explicit UTC `start`: bucket `i` starts at
 * `start + i * 7 days`.
 *
 * @param start - The series' `start`, unix seconds (UTC).
 * @param count - How many buckets the series has.
 * @returns One label per bucket, oldest first, like `4 Nov`.
 */
export function weekLabels(start: number, count: number): string[] {
  const out: string[] = [];
  for (let i = 0; i < count; i++) out.push(formatUtcDay(start + i * WEEK_SEC, false));
  return out;
}

/**
 * Picks a few labels to spread along a chart's base, so a long series does not crowd its axis: the
 * first and the last, and evenly spaced ones between them.
 *
 * @param labels - One label per column.
 * @param max - How many to keep at most (at least 2). Defaults to 4.
 * @returns The kept labels, in order; all of them when there are no more than `max`.
 */
export function axisLabels(labels: string[], max = 4): string[] {
  const keep = Math.max(2, Math.floor(max));
  if (labels.length <= keep) return [...labels];
  const out: string[] = [];
  for (let k = 0; k < keep; k++) {
    const i = Math.round((k * (labels.length - 1)) / (keep - 1));
    out.push(labels[i]!);
  }
  return out;
}

/**
 * Formats a length of time as the largest two units: `45s`, `3m 12s`, `1h 02m`, `2d 4h`.
 *
 * @param sec - Seconds; negative and non-finite values count as 0.
 * @returns The duration.
 */
export function formatDuration(sec: number): string {
  const s = Number.isFinite(sec) && sec > 0 ? Math.floor(sec) : 0;
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${String(m).padStart(2, "0")}m`;
  if (m > 0) return `${m}m ${String(r).padStart(2, "0")}s`;
  return `${r}s`;
}

/**
 * Formats a channel's median reply time.
 *
 * @param sec - Seconds, or null when no message was answered.
 * @returns The duration, or `none answered` for null.
 */
export function formatReplyTime(sec: number | null): string {
  return sec == null ? "none answered" : formatDuration(sec);
}

/**
 * Formats hours spent together in voice from seconds, one decimal: `3.5h`.
 *
 * @param sec - Seconds.
 * @returns The hours with an `h`.
 */
export function formatVoiceHours(sec: number): string {
  const h = Number.isFinite(sec) && sec > 0 ? sec / 3600 : 0;
  return `${(Math.round(h * 10) / 10).toLocaleString("en-GB")}h`;
}

/** A whole number in the house style, `12,345`. */
export function formatCount(n: number): string {
  return (Number.isFinite(n) ? n : 0).toLocaleString("en-GB");
}

/** The name and the second line of a channel-health row. */
export interface ChannelLabel {
  /** `#name`, or the id when the name is unknown. */
  name: string;
  /** `thread in #parent` for a thread (the parent's id when its name is unknown); null for a channel. */
  note: string | null;
}

/**
 * Labels a row of the channel-health table. A thread is a channel of its own, shown with its own name
 * and a `thread in #parent` note. A name that is null (deleted, or not in the bot's cache) falls back to
 * the id.
 *
 * @param row - The row's ids and names, as `GET /api/activity/admin/channels` returns them.
 * @returns The label.
 */
export function channelLabel(row: {
  channelId: string;
  parentChannelId: string | null;
  name: string | null;
  parentName: string | null;
}): ChannelLabel {
  const name = row.name != null ? `#${row.name}` : row.channelId;
  if (row.parentChannelId == null) return { name, note: null };
  const parent = row.parentName != null ? `#${row.parentName}` : row.parentChannelId;
  return { name, note: `thread in ${parent}` };
}

/**
 * Width of a stepped progress bar: the share of `done` in `total`, rounded down to whole steps, so the
 * bar moves in visible jumps and never claims more than is done.
 *
 * @param done - Units finished.
 * @param total - Units known; 0 or less gives 0.
 * @param steps - Steps across the bar (default 20, five percent each).
 * @returns A percentage from 0 to 100, a multiple of `100 / steps`.
 */
export function steppedPercent(done: number, total: number, steps = 20): number {
  if (!(total > 0) || !(done > 0)) return 0;
  const n = Math.max(1, Math.floor(steps));
  const share = Math.min(1, done / total);
  return (Math.floor(share * n) * 100) / n;
}

/** What `GET /api/activity/user/voice-status` returns. */
export interface VoiceStatus {
  /** The voice log holds two whole UTC months, so voice figures are shown. */
  ready: boolean;
  /** When voice unlocks, unix seconds; null when no voice has been logged yet. */
  readyAt: number | null;
}

/**
 * The narrator line shown instead of a voice table while voice is withheld.
 *
 * @param status - The voice status.
 * @returns `Voice stats unlock on 1 Feb 2027.` (a sentence-case narrator line), or a line without a date when no voice is logged yet.
 */
export function voiceUnlockLine(status: VoiceStatus): string {
  return status.readyAt != null
    ? `Voice stats unlock on ${formatUtcDay(status.readyAt)}.`
    : "Voice stats unlock two whole months after the first voice session is logged.";
}

/** A dashboard period, as the admin routes take it in `?period=`. */
export type PeriodKey = "7d" | "week" | "30d" | "term" | "year" | "all";

/**
 * The periods in picker order, with lowercase labels that say what the server counts (`time.ts`
 * `parsePeriodParam`): `year` is the last 365 days, not the calendar year. `week` is left out because the
 * server treats it as `7d`; {@link PeriodKey} keeps it, so the route contract is unchanged. `30d` is the
 * routes' default.
 */
export const PERIODS: { value: PeriodKey; label: string }[] = [
  { value: "7d", label: "last 7 days" },
  { value: "30d", label: "last 30 days" },
  { value: "term", label: "this term" },
  { value: "year", label: "last 365 days" },
  { value: "all", label: "all time" },
];
