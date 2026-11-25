/**
 * Occurrence math for recurring events. All computations use the server's
 * local timezone via Date, stepping calendar units so DST shifts and short
 * months behave like a calendar, not like fixed 86400-second hops.
 */

export type Recurrence =
  | "none"
  | "daily"
  | "weekdays"
  | "weekly"
  | "biweekly"
  | "monthly_day"
  | "monthly_weekday"
  | "yearly"
  | "custom_days";

export interface RecurrenceSpec {
  /** First occurrence start (unix sec). */
  startAt: number;
  recurrence: Recurrence;
  /** custom_days: repeat every N days. */
  recurrenceInterval: number;
  /** No occurrence may start after this (unix sec); null = forever. */
  recurrenceUntil: number | null;
}

export const RECURRENCE_LABELS: Record<Recurrence, string> = {
  none: "One-off",
  daily: "Daily",
  weekdays: "Weekdays (Mon–Fri)",
  weekly: "Weekly",
  biweekly: "Every 2 weeks",
  monthly_day: "Monthly (same day of month)",
  monthly_weekday: "Monthly (same nth weekday)",
  yearly: "Yearly",
  custom_days: "Every N days",
};

/** Safety valve: never iterate more than this many candidate occurrences. */
const MAX_STEPS = 10000;

/** The nth (1-based) occurrence of `weekday` within start's month, e.g. 2nd Tuesday. */
function nthWeekdayOfMonth(d: Date): { weekday: number; nth: number } {
  return { weekday: d.getDay(), nth: Math.floor((d.getDate() - 1) / 7) + 1 };
}

/** The date of the nth `weekday` in the given month, or null if it doesn't exist. */
function dateOfNthWeekday(
  year: number,
  month: number,
  weekday: number,
  nth: number,
  template: Date,
): Date | null {
  const first = new Date(year, month, 1);
  const offset = (weekday - first.getDay() + 7) % 7;
  const day = 1 + offset + (nth - 1) * 7;
  const candidate = new Date(
    year,
    month,
    day,
    template.getHours(),
    template.getMinutes(),
    template.getSeconds(),
  );
  return candidate.getMonth() === month ? candidate : null;
}

/** Generate occurrence starts (unix sec) in ascending order, starting at startAt. */
function* occurrences(spec: RecurrenceSpec): Generator<number> {
  const start = new Date(spec.startAt * 1000);
  yield spec.startAt;
  if (spec.recurrence === "none") return;

  const emit = (d: Date) => Math.floor(d.getTime() / 1000);

  switch (spec.recurrence) {
    case "daily":
    case "weekdays":
    case "custom_days": {
      const stepDays =
        spec.recurrence === "custom_days" ? Math.max(1, spec.recurrenceInterval) : 1;
      const d = new Date(start);
      for (let i = 0; i < MAX_STEPS; i++) {
        d.setDate(d.getDate() + stepDays);
        if (spec.recurrence === "weekdays" && (d.getDay() === 0 || d.getDay() === 6)) {
          continue;
        }
        yield emit(d);
      }
      return;
    }
    case "weekly":
    case "biweekly": {
      const stepDays = spec.recurrence === "weekly" ? 7 : 14;
      const d = new Date(start);
      for (let i = 0; i < MAX_STEPS; i++) {
        d.setDate(d.getDate() + stepDays);
        yield emit(d);
      }
      return;
    }
    case "monthly_day": {
      const dayOfMonth = start.getDate();
      for (let i = 1; i < MAX_STEPS; i++) {
        const d = new Date(start);
        d.setDate(1); // avoid rollover while changing months
        d.setMonth(start.getMonth() + i);
        d.setDate(dayOfMonth);
        // Months without this day (e.g. Feb 31) roll over — skip those.
        if (d.getDate() !== dayOfMonth) continue;
        yield emit(d);
      }
      return;
    }
    case "monthly_weekday": {
      const { weekday, nth } = nthWeekdayOfMonth(start);
      for (let i = 1; i < MAX_STEPS; i++) {
        const anchor = new Date(start.getFullYear(), start.getMonth() + i, 1);
        const d = dateOfNthWeekday(
          anchor.getFullYear(),
          anchor.getMonth(),
          weekday,
          nth,
          start,
        );
        if (d) yield emit(d);
      }
      return;
    }
    case "yearly": {
      for (let i = 1; i < MAX_STEPS; i++) {
        const d = new Date(start);
        d.setFullYear(start.getFullYear() + i);
        // Feb 29 in a non-leap year rolls to Mar 1 — skip those years.
        if (d.getMonth() !== start.getMonth() || d.getDate() !== start.getDate()) {
          continue;
        }
        yield emit(d);
      }
      return;
    }
  }
}

/** The earliest occurrence start >= `after`, or null when the series is over. */
export function nextOccurrence(spec: RecurrenceSpec, after: number): number | null {
  for (const at of occurrences(spec)) {
    if (spec.recurrenceUntil !== null && at > spec.recurrenceUntil) return null;
    if (at >= after) return at;
  }
  return null;
}

/** The latest occurrence start < `before`, or null when none has happened yet. */
export function previousOccurrence(spec: RecurrenceSpec, before: number): number | null {
  let last: number | null = null;
  for (const at of occurrences(spec)) {
    if (at >= before) break;
    if (spec.recurrenceUntil !== null && at > spec.recurrenceUntil) break;
    last = at;
  }
  return last;
}

/** Occurrence starts within [from, to), capped at `limit`. */
export function occurrencesBetween(
  spec: RecurrenceSpec,
  from: number,
  to: number,
  limit = 100,
): number[] {
  const out: number[] = [];
  for (const at of occurrences(spec)) {
    if (at >= to) break;
    if (spec.recurrenceUntil !== null && at > spec.recurrenceUntil) break;
    if (at >= from) {
      out.push(at);
      if (out.length >= limit) break;
    }
  }
  return out;
}

/** Seconds each occurrence lasts (0 for point-in-time events). */
export function occurrenceDuration(startAt: number, endAt: number | null): number {
  return endAt !== null && endAt > startAt ? endAt - startAt : 0;
}

/**
 * A series is completed when no occurrence starts at/after `now` and the last
 * occurrence (plus its duration) has fully passed.
 */
export function isCompleted(
  spec: RecurrenceSpec,
  endAt: number | null,
  now: number,
): boolean {
  if (nextOccurrence(spec, now) !== null) return false;
  const prev = previousOccurrence(spec, now);
  if (prev === null) return true;
  return prev + occurrenceDuration(spec.startAt, endAt) <= now;
}
