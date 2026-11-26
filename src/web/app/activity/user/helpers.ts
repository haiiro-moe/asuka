/**
 * Pure helpers of the user-tier activity page: periods, labels and small formatters. No DOM and no
 * server imports (types only), so they are unit-tested with `bun test`.
 *
 * @module
 */
import type { Award, NamedChannelRow, SharingRow } from "../../../../plugins/activity/types/user.ts";

/** The periods the page offers. The server also accepts `7d`, `week` and `all`. */
export const PERIODS = ["30d", "term", "year"] as const;

/** One of {@link PERIODS}. */
export type PagePeriod = (typeof PERIODS)[number];

/** Weekday row labels of the heatmaps, Monday first (the server's weekday 0). */
export const WEEKDAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];

/**
 * Builds the URL of a user-tier activity route.
 *
 * @param route - The route name, e.g. `rhythm`.
 * @param period - The period to ask for; leave out for routes that take none.
 */
export function activityPath(route: string, period?: PagePeriod): string {
  const base = `/api/activity/user/${route}`;
  return period ? `${base}?period=${period}` : base;
}

/**
 * Formats a unix-seconds timestamp as a UTC date like `1 Feb 2027`.
 *
 * @param seconds - Unix seconds.
 */
export function formatUtcDate(seconds: number): string {
  return new Date(seconds * 1000).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}

/**
 * The narrator line shown in place of the voice parts while voice is withheld.
 *
 * @param readyAt - Unix seconds when voice unlocks, or `null` when no voice has been recorded.
 */
export function voiceLockedLine(readyAt: number | null): string {
  return readyAt == null
    ? "voice stats unlock once two whole months of voice are recorded."
    : `voice stats unlock on ${formatUtcDate(readyAt)}.`;
}

/**
 * Formats seconds as `3h 05m`, `42m` under an hour or `30s` under a minute.
 *
 * @param seconds - A duration in seconds; negative and non-finite values count as 0.
 */
export function formatDuration(seconds: number): string {
  const s = Number.isFinite(seconds) && seconds > 0 ? Math.round(seconds) : 0;
  if (s < 60) return `${s}s`;
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h > 0 ? `${h}h ${String(m).padStart(2, "0")}m` : `${m}m`;
}

/**
 * Turns seconds into hours with one decimal, for a rank bar.
 *
 * @param seconds - A duration in seconds.
 */
export function toHours(seconds: number): number {
  return Math.round(seconds / 360) / 10;
}

/**
 * A readable label for an emoji key. A unicode emoji shows as itself; a custom one as `:name:` when the
 * name is known, otherwise as its id.
 *
 * @param key - The stored key: a unicode character or `custom:<id>`.
 * @param name - The custom emoji's name, when known.
 */
export function emojiLabel(key: string, name: string | null): string {
  if (!key.startsWith("custom:")) return key;
  return name ? `:${name}:` : `custom ${key.slice("custom:".length)}`;
}

/**
 * The label and the muted second line of a channel row. A thread shows its own name and
 * `thread in #parent`; a name the bot has not seen falls back to the id.
 *
 * @param row - A row of `/channels` or `/voice`.
 */
export function channelLabel(row: NamedChannelRow): { label: string; sub?: string } {
  const label = `#${row.name ?? row.channelId}`;
  if (!row.parentChannelId) return { label };
  return { label, sub: `thread in #${row.parentName ?? row.parentChannelId}` };
}

/** What the sharing view adds up to. */
export interface SharingSummary {
  /** Total per kind, in a fixed order, kinds with nothing included as 0. */
  totals: { kind: SharingRow["kind"]; count: number }[];
  /** Link rows (one per domain), largest first. */
  links: SharingRow[];
}

/** The order of the kinds in the sharing tiles. */
export const SHARING_KINDS: SharingRow["kind"][] = ["image", "video", "audio", "gif", "sticker", "link"];

/**
 * Totals the sharing rows per kind and pulls out the link domains.
 *
 * @param rows - Rows from `/sharing`.
 */
export function summariseSharing(rows: SharingRow[]): SharingSummary {
  const sums = new Map<SharingRow["kind"], number>();
  for (const r of rows) sums.set(r.kind, (sums.get(r.kind) ?? 0) + r.count);
  return {
    totals: SHARING_KINDS.map((kind) => ({ kind, count: sums.get(kind) ?? 0 })),
    links: rows.filter((r) => r.kind === "link").sort((a, b) => b.count - a.count || a.label.localeCompare(b.label)),
  };
}

/** True when every cell of a heatmap is zero (or it has none). */
export function heatmapIsEmpty(cells: number[][]): boolean {
  return cells.every((row) => row.every((v) => !(v > 0)));
}

/**
 * Sums a 7 by 24 heatmap per hour of day.
 *
 * @param cells - `cells[weekday][hour]`.
 * @returns 24 totals, hour 0 first.
 */
export function hourTotals(cells: number[][]): number[] {
  const out = new Array<number>(24).fill(0);
  for (const row of cells) for (let h = 0; h < 24; h++) out[h]! += row[h] ?? 0;
  return out;
}

/**
 * Sums a 7 by 24 heatmap per weekday.
 *
 * @param cells - `cells[weekday][hour]`.
 * @returns One total per row, Monday first.
 */
export function dayTotals(cells: number[][]): number[] {
  return cells.map((row) => row.reduce((a, v) => a + v, 0));
}

/**
 * The index of the largest value, or `null` when nothing is above zero. Ties go to the first.
 *
 * @param values - Totals to look through.
 */
export function peakIndex(values: number[]): number | null {
  let best: number | null = null;
  values.forEach((v, i) => {
    if (v > 0 && (best === null || v > values[best]!)) best = i;
  });
  return best;
}

/**
 * Rounds every cell of a heatmap to two decimals (voice cells are fractional hours) so a cell's title
 * stays short.
 *
 * @param h - The heatmap cells and their maximum.
 */
export function roundHeatmap(h: { cells: number[][]; max: number }): { cells: number[][]; max: number } {
  const r = (v: number) => Math.round(v * 100) / 100;
  return { cells: h.cells.map((row) => row.map(r)), max: r(h.max) };
}

/** The wording of one award line: a title and what the winner did. */
export interface AwardText {
  /** The award's name, lowercase. */
  title: string;
  /** The rest of the line, after the winner's name. */
  tail: string;
}

/**
 * Words an award in the narrator voice.
 *
 * @param award - One entry of `/awards`.
 */
export function awardText(award: Award): AwardText {
  const n = award.value.toLocaleString("en-GB");
  switch (award.key) {
    case "night-owl":
      return { title: "night owl", tail: `sent ${n} messages between 00:00 and 05:00 utc.` };
    case "earliest-bird":
      return { title: "earliest bird", tail: `sent ${n} messages between 05:00 and 08:00 utc.` };
    case "longest-voice":
      return { title: "longest voice", tail: `stayed connected for ${formatDuration(award.value)} in one sitting.` };
    case "fastest-replier":
      return { title: "fastest replier", tail: `answers in a median of ${formatDuration(award.value)}.` };
    case "most-replied-to":
      return { title: "most replied to", tail: `drew ${n} replies from other members.` };
  }
}
