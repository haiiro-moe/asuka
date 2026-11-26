/**
 * Voice readiness: whether the voice log is old enough to show numbers from.
 *
 * Anything derived from voice is withheld until the log holds at least
 * {@link VOICE_MIN_WHOLE_MONTHS} whole calendar months, so a young recording
 * never produces misleading figures. This module is the one place that decides.
 *
 * Every timestamp is unix seconds and every month is a UTC month.
 */
import { min } from "drizzle-orm";
import { nowSec } from "../../core/util.ts";
import { db, schema } from "../../db/index.ts";

/** Whole calendar months of voice data needed before voice-derived numbers show. */
export const VOICE_MIN_WHOLE_MONTHS = 2;

/** Where the voice log stands against the readiness rule. */
export interface VoiceReadiness {
  /** True once the log holds {@link VOICE_MIN_WHOLE_MONTHS} whole months. */
  ready: boolean;
  /** Start of the earliest voice segment, or null when nothing is recorded. */
  since: number | null;
  /** When voice becomes ready, or null when nothing is recorded. */
  readyAt: number | null;
}

/**
 * When the voice log first holds {@link VOICE_MIN_WHOLE_MONTHS} whole months.
 *
 * The month `firstTs` falls in is partial, so counting starts at the next month
 * start. The one exception is a `firstTs` that is exactly a UTC month start at
 * 00:00:00: that month is whole and counts.
 *
 * @param firstTs - Start of the earliest voice segment, in unix seconds.
 * @returns The first second of the UTC day on which voice becomes ready.
 */
export function voiceReadyAtFor(firstTs: number): number {
  const date = new Date(firstTs * 1000);
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth();
  const monthStart = Date.UTC(year, month, 1) / 1000;
  const firstWholeMonth = firstTs === monthStart ? month : month + 1;
  return Date.UTC(year, firstWholeMonth + VOICE_MIN_WHOLE_MONTHS, 1) / 1000;
}

/**
 * Whether voice-derived numbers may be shown yet.
 *
 * Reads the earliest `activity_voice.startedAt` in one query. Channel exclusion
 * is ignored on purpose: it decides what is shown, not how long the recorder
 * has been running.
 *
 * @param now - Current time in unix seconds. Defaults to the current time.
 * @returns With no voice rows, `ready` is false and both times are null.
 */
export function voiceReadiness(now: number = nowSec()): VoiceReadiness {
  const row = db.select({ since: min(schema.activityVoice.startedAt) }).from(schema.activityVoice).get();
  const since = row?.since ?? null;
  if (since === null) return { ready: false, since: null, readyAt: null };
  const readyAt = voiceReadyAtFor(since);
  return { ready: now >= readyAt, since, readyAt };
}

/**
 * Shorthand for `voiceReadiness(now).ready`.
 *
 * @param now - Current time in unix seconds. Defaults to the current time.
 */
export function voiceReady(now: number = nowSec()): boolean {
  return voiceReadiness(now).ready;
}

/**
 * Voice readiness for a Wrapped year: judged at the year's last second, or at
 * `now` while the year is still running, whichever is earlier.
 *
 * Processing a year after it ended must not show voice that only became
 * ready later: a log that started in mid-November 2026 is ready on
 * 1 Feb 2027, but the 2026 Wrapped holds just six weeks of it and stays
 * without voice.
 *
 * @param year - The UTC calendar year.
 * @param now - Current time in unix seconds. Defaults to the current time.
 * @returns {@link voiceReadiness} at `min(now, last second of the year)`.
 */
export function voiceReadinessForYear(year: number, now: number = nowSec()): VoiceReadiness {
  const lastSecond = Date.UTC(year + 1, 0, 1) / 1000 - 1;
  return voiceReadiness(Math.min(now, lastSecond));
}
