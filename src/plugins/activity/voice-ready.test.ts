import { afterAll, beforeAll, beforeEach, expect, test } from "bun:test";
import { db, initDb, schema } from "../../db/index.ts";
import { closeVoiceSegment, openVoiceSegment } from "./record.ts";
import type { VoiceSnapshot } from "./record.ts";
import { VOICE_MIN_WHOLE_MONTHS, voiceReadiness, voiceReady, voiceReadyAtFor } from "./voice-ready.ts";

/** Unix seconds for a UTC date. */
function utc(...parts: [number, number, number?, number?, number?, number?]): number {
  return Date.UTC(...parts) / 1000;
}

/** A plain voice state in channel `v1`. */
const snap: VoiceSnapshot = { channelId: "v1", muted: false, deafened: false, streaming: false, video: false };

/** Record one finished voice segment through the write API. */
function segment(userId: string, start: number, end: number) {
  openVoiceSegment(userId, snap, start);
  closeVoiceSegment(userId, end);
}

// bun test runs with NODE_ENV=test, so the database is in-memory.
beforeAll(() => {
  initDb();
});

beforeEach(() => {
  db.delete(schema.activityVoice).run();
});

// Other test files share this database: leave the table empty.
afterAll(() => {
  db.delete(schema.activityVoice).run();
});

test("the rule asks for two whole months", () => {
  expect(VOICE_MIN_WHOLE_MONTHS).toBe(2);
});

test("voiceReadyAtFor skips the partial month and then waits two whole ones", () => {
  expect(voiceReadyAtFor(utc(2026, 10, 27, 12))).toBe(utc(2027, 1, 1));
  expect(voiceReadyAtFor(utc(2026, 10, 15))).toBe(utc(2027, 1, 1));
});

test("voiceReadyAtFor counts the first month when it starts exactly at a month start", () => {
  expect(voiceReadyAtFor(utc(2026, 10, 1))).toBe(utc(2027, 0, 1));
});

test("voiceReadyAtFor treats one second after a month start as a partial month", () => {
  expect(voiceReadyAtFor(utc(2026, 10, 1, 0, 0, 1))).toBe(utc(2027, 1, 1));
});

test("voiceReadyAtFor crosses the year end", () => {
  expect(voiceReadyAtFor(utc(2026, 11, 31, 23, 59, 59))).toBe(utc(2027, 2, 1));
});

test("voiceReadiness is not ready, with no times, when there is no voice data", () => {
  expect(voiceReadiness()).toEqual({ ready: false, since: null, readyAt: null });
  expect(voiceReadiness(utc(2030, 0, 1))).toEqual({ ready: false, since: null, readyAt: null });
  expect(voiceReady()).toBe(false);
});

test("voiceReadiness turns ready exactly at readyAt", () => {
  const first = utc(2026, 10, 27, 12);
  segment("u1", first, first + 600);
  const readyAt = utc(2027, 1, 1);

  expect(voiceReadiness(readyAt - 1)).toEqual({ ready: false, since: first, readyAt });
  expect(voiceReadiness(readyAt)).toEqual({ ready: true, since: first, readyAt });
  expect(voiceReady(readyAt - 1)).toBe(false);
  expect(voiceReady(readyAt)).toBe(true);
});

test("voiceReadiness uses the earliest row even when later ones exist", () => {
  segment("u2", utc(2027, 0, 5), utc(2027, 0, 5, 1));
  segment("u1", utc(2026, 10, 27, 12), utc(2026, 10, 27, 13));
  segment("u3", utc(2026, 11, 3), utc(2026, 11, 3, 1));

  expect(voiceReadiness(0).since).toBe(utc(2026, 10, 27, 12));
});

test("voiceReadiness counts rows in excluded channels", () => {
  db.insert(schema.activityVoice)
    .values({ userId: "u1", channelId: "gone", startedAt: utc(2026, 8, 2), endedAt: utc(2026, 8, 2, 1), lastSeenAt: utc(2026, 8, 2, 1) })
    .run();
  db.update(schema.guildConfig).set({ activityExcludedChannelIds: "gone" }).run();
  try {
    segment("u2", utc(2026, 10, 27), utc(2026, 10, 27, 1));
    expect(voiceReadiness(0).since).toBe(utc(2026, 8, 2));
  } finally {
    db.update(schema.guildConfig).set({ activityExcludedChannelIds: "" }).run();
  }
});
