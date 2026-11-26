/**
 * Time helpers shared by the activity queries.
 *
 * Every timestamp is unix seconds and every bucket is UTC.
 */
import { eq } from "drizzle-orm";
import { nowSec } from "../../core/util.ts";
import { db, schema } from "../../db/index.ts";

/** Seconds in a day. */
const DAY = 86400;

/** Length of a term when no president term is on record, in days. */
const TERM_FALLBACK_DAYS = 90;

/**
 * A span of time in unix seconds. `from` is inclusive and `to` is exclusive, so
 * two periods that share a boundary never count an event twice.
 */
export interface Period {
  /** First second of the period. */
  from: number;
  /** End of the period; the first second that is no longer part of it. */
  to: number;
}

/** A member has "gone quiet" after this many days without a message or voice. */
export const QUIET_DAYS = 30;

/**
 * The UTC weekday and hour a timestamp falls in.
 *
 * @param ts - Unix seconds.
 * @returns `weekday` from 0 (Monday) to 6 (Sunday) and `hour` from 0 to 23.
 */
export function weekdayHour(ts: number): { weekday: number; hour: number } {
  const date = new Date(ts * 1000);
  return { weekday: (date.getUTCDay() + 6) % 7, hour: date.getUTCHours() };
}

/**
 * The period covering the last `days` days.
 *
 * @param days - Length of the period in days.
 * @param now - End of the period in unix seconds. Defaults to the current time.
 */
export function lastDays(days: number, now: number = nowSec()): Period {
  return { from: now - days * DAY, to: now };
}

/**
 * The current president's term so far.
 *
 * Reads `president.termStart` on each call. Without one (no president has been
 * elected yet) it is the last 90 days.
 *
 * @param now - End of the period in unix seconds. Defaults to the current time.
 */
export function termPeriod(now: number = nowSec()): Period {
  const row = db
    .select({ termStart: schema.president.termStart })
    .from(schema.president)
    .where(eq(schema.president.id, 1))
    .get();
  const termStart = row?.termStart;
  if (termStart == null) return lastDays(TERM_FALLBACK_DAYS, now);
  return { from: termStart, to: now };
}

/**
 * Turn a `?period=` query value into a {@link Period}.
 *
 * | Value | Period |
 * |---|---|
 * | `7d`, `week` | the last 7 days |
 * | `30d` | the last 30 days |
 * | `term` | {@link termPeriod} |
 * | `year` | the last 365 days |
 * | `all` | everything up to `now` |
 *
 * @param value - The query value. Null (the parameter is absent) means `30d`.
 * @param now - End of the period in unix seconds. Defaults to the current time.
 * @throws RangeError when `value` is anything else, the empty string included.
 */
export function parsePeriodParam(value: string | null, now: number = nowSec()): Period {
  switch (value) {
    case null:
    case "30d":
      return lastDays(30, now);
    case "7d":
    case "week":
      return lastDays(7, now);
    case "term":
      return termPeriod(now);
    case "year":
      return lastDays(365, now);
    case "all":
      return { from: 0, to: now };
    default:
      throw new RangeError(`unknown period: ${value}`);
  }
}
