import { afterAll, beforeAll, beforeEach, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { db, initDb, schema } from "../../db/index.ts";
import { QUIET_DAYS, lastDays, parsePeriodParam, termPeriod, weekdayHour } from "./time.ts";

const DAY = 86400;
const NOW = 1_800_000_000;

/** Set the singleton president row's term start. */
function setTermStart(termStart: number | null) {
  db.update(schema.president).set({ termStart }).where(eq(schema.president.id, 1)).run();
}

// bun test runs with NODE_ENV=test, so the database is in-memory.
beforeAll(() => {
  initDb();
});

beforeEach(() => {
  setTermStart(null);
});

// Other test files share this database: leave the president row as seeded.
afterAll(() => {
  setTermStart(null);
});

test("QUIET_DAYS is 30", () => {
  expect(QUIET_DAYS).toBe(30);
});

test("weekdayHour is UTC with Monday as 0", () => {
  expect(weekdayHour(Date.UTC(2026, 10, 23, 14) / 1000)).toEqual({ weekday: 0, hour: 14 });
  // Sunday 22 Nov 2026, the last second of the day.
  expect(weekdayHour(Date.UTC(2026, 10, 22, 23, 59, 59) / 1000)).toEqual({ weekday: 6, hour: 23 });
  // Saturday 28 Nov 2026, midnight.
  expect(weekdayHour(Date.UTC(2026, 10, 28, 0) / 1000)).toEqual({ weekday: 5, hour: 0 });
});

test("lastDays ends at now and spans the given days", () => {
  expect(lastDays(7, NOW)).toEqual({ from: NOW - 7 * DAY, to: NOW });
  const live = lastDays(1);
  expect(live.to - live.from).toBe(DAY);
  expect(Math.abs(live.to - Date.now() / 1000)).toBeLessThan(5);
});

test("termPeriod starts at the president's term start", () => {
  setTermStart(NOW - 12 * DAY);
  expect(termPeriod(NOW)).toEqual({ from: NOW - 12 * DAY, to: NOW });
});

test("termPeriod falls back to the last 90 days without a term start", () => {
  expect(termPeriod(NOW)).toEqual({ from: NOW - 90 * DAY, to: NOW });
});

test("parsePeriodParam defaults to 30 days", () => {
  const period = parsePeriodParam(null, 1000000);
  expect(period.to).toBe(1000000);
  expect(period.to - period.from).toBe(30 * 86400);
});

test("parsePeriodParam knows every named period", () => {
  expect(parsePeriodParam("7d", NOW)).toEqual({ from: NOW - 7 * DAY, to: NOW });
  expect(parsePeriodParam("30d", NOW)).toEqual({ from: NOW - 30 * DAY, to: NOW });
  expect(parsePeriodParam("year", NOW)).toEqual({ from: NOW - 365 * DAY, to: NOW });
  expect(parsePeriodParam("all", NOW)).toEqual({ from: 0, to: NOW });
  setTermStart(NOW - 5 * DAY);
  expect(parsePeriodParam("term", NOW)).toEqual({ from: NOW - 5 * DAY, to: NOW });
});

test("week is an alias of 7d", () => {
  expect(parsePeriodParam("week", NOW)).toEqual(parsePeriodParam("7d", NOW));
});

test("parsePeriodParam rejects unknown values", () => {
  expect(() => parsePeriodParam("bogus")).toThrow(RangeError);
  expect(() => parsePeriodParam("")).toThrow(RangeError);
  expect(() => parsePeriodParam("7D", NOW)).toThrow(RangeError);
});
