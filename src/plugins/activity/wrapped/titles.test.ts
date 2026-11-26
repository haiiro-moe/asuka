import { afterAll, beforeAll, beforeEach, expect, test } from "bun:test";
import { db, initDb, schema } from "../../../db/index.ts";
import { closeVoiceSegment, openVoiceSegment, recordMessage } from "../record.ts";
import { buildWrapped } from "./data.ts";
import { titlesFor } from "./titles.ts";
import { at, msg, resetWrappedTables } from "./testing.ts";

beforeAll(() => {
  initDb();
});

beforeEach(() => {
  resetWrappedTables();
});

afterAll(() => {
  resetWrappedTables();
});

/** `n` messages by `userId` from `ts`, one minute apart, in channel c1 unless overridden. */
function messages(userId: string, n: number, ts: number, over: Parameters<typeof msg>[2] = {}) {
  for (let i = 0; i < n; i++) recordMessage(msg(userId, ts + i * 60, over));
}

/** Open and close a voice segment. */
function voice(userId: string, channelId: string, from: number, to: number) {
  openVoiceSegment(userId, { channelId, muted: false, deafened: false, streaming: false, video: false }, from);
  closeVoiceSegment(userId, to);
}

/** The title keys of a member. */
function keys(userId: string, year = 2026): string[] {
  return titlesFor(userId, year).map((t) => t.key).sort();
}

test("a sole winner gets the title; a tie shares it", () => {
  // u1: 100 messages at 02:00 UTC; u2: 100 at 12:00 UTC.
  messages("u1", 100, at("2026-03-02T02:00:00Z"));
  messages("u2", 100, at("2026-03-02T12:00:00Z"));

  const u1 = titlesFor("u1", 2026);
  const night = u1.find((t) => t.key === "night-owl")!;
  expect(night).toEqual({ key: "night-owl", label: "night owl", detail: "1st of 2, most after midnight" });
  expect(keys("u2")).not.toContain("night-owl");

  // Both wrote 100: most-messages is shared.
  expect(keys("u1")).toContain("most-messages");
  expect(keys("u2")).toContain("most-messages");
  expect(u1.find((t) => t.key === "most-messages")!.detail).toBe("joint 1st of 2, most messages");
});

test("a quiet year awards nothing", () => {
  messages("u1", 99, at("2026-03-02T02:00:00Z"), { emoji: [{ emoji: "😂", name: null, count: 5 }] });
  voice("u1", "v1", at("2026-03-03T00:00:00Z"), at("2026-03-03T09:00:00Z"));
  expect(titlesFor("u1", 2026)).toEqual([]);
});

test("earliest bird, emoji lord, most replied-to and fastest replier", () => {
  const t = at("2026-04-01T06:00:00Z");
  // u1: 100 messages from 06:00 UTC, each with an emoji; the first ten are p0..p9.
  for (let i = 0; i < 100; i++) {
    recordMessage(msg("u1", t + i * 60, { messageId: i < 10 ? `p${i}` : `u1-${i}`, emoji: [{ emoji: "😂", name: null, count: 1 }] }));
  }
  // u2 replies to p0..p9 five seconds after each; u3 a minute after.
  for (let i = 0; i < 10; i++) {
    recordMessage(msg("u2", t + i * 60 + 5, { replyToUserId: "u1", replyToMessageId: `p${i}` }));
    recordMessage(msg("u3", t + i * 60 + 60, { replyToUserId: "u1", replyToMessageId: `p${i}` }));
  }
  messages("u2", 90, at("2026-04-02T12:00:00Z"));
  messages("u3", 90, at("2026-04-03T12:00:00Z"));

  // All three wrote 100, so most-messages is shared by all three.
  expect(keys("u1")).toEqual(["earliest-bird", "emoji-lord", "most-messages", "most-replied-to"]);
  expect(keys("u2")).toEqual(["fastest-replier", "most-messages"]);
  expect(keys("u3")).toEqual(["most-messages"]);
});

test("voice titles need 10 hours", () => {
  voice("u1", "v1", at("2026-05-01T00:00:00Z"), at("2026-05-01T11:00:00Z"));
  voice("u2", "v1", at("2026-05-02T00:00:00Z"), at("2026-05-02T05:00:00Z"));
  expect(keys("u1")).toEqual(["longest-voice", "most-voice-hours"]);
  expect(keys("u2")).toEqual([]);
});

test("club titles go to the club's owner; the president title to whoever held the chair", () => {
  db.insert(schema.clubs).values({ id: 1, name: "big", ownerId: "owner", status: "approved", channelId: "cl1" }).run();
  db.insert(schema.clubs).values({ id: 2, name: "small", ownerId: "other", status: "approved", channelId: "cl2" }).run();
  for (let i = 0; i < 3; i++) db.insert(schema.clubMembers).values({ clubId: 1, userId: `a${i}`, accepted: 1 }).run();
  db.insert(schema.clubMembers).values({ clubId: 2, userId: "b0", accepted: 1 }).run();
  messages("x", 100, at("2026-06-01T12:00:00Z"), { channelId: "cl1" });
  messages("y", 20, at("2026-06-02T12:00:00Z"), { channelId: "cl2" });

  db.insert(schema.elections)
    .values({ id: 1, status: "closed", startsAt: at("2026-01-01T00:00:00Z"), endsAt: at("2026-01-08T00:00:00Z"), winnerId: "pres" })
    .run();
  db.insert(schema.candidates).values({ electionId: 1, userId: "pres", voteCount: 3 }).run();

  expect(keys("owner")).toEqual(["club-most-members", "club-most-messages"]);
  expect(keys("other")).toEqual([]);
  const pres = titlesFor("pres", 2026);
  expect(pres.map((t) => t.key)).toEqual(["president"]);
  expect(pres[0]!.label).toBe("president");
  // The titles are part of the personal snapshot.
  messages("pres", 1, at("2026-02-01T00:00:00Z"));
  expect(buildWrapped("pres", 2026)!.titles.map((t) => t.key)).toEqual(["president"]);
});
