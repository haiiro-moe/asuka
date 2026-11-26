import { afterAll, beforeAll, beforeEach, expect, test } from "bun:test";
import { db, initDb, schema } from "../../../db/index.ts";
import { closeVoiceSegment, openVoiceSegment, recordMessage } from "../record.ts";
import { buildWrapped } from "./data.ts";
import { clubFor, clubYearStats, presidencyFor } from "./extras.ts";
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

/** Open a voice segment for `userId` in `channelId` from `from` to `to`. */
function voice(userId: string, channelId: string, from: number, to: number) {
  openVoiceSegment(userId, { channelId, muted: false, deafened: false, streaming: false, video: false }, from);
  closeVoiceSegment(userId, to);
}

/** `n` messages by `userId` in `channelId` starting at `ts`, one second apart. */
function messages(userId: string, n: number, ts: number, over: Parameters<typeof msg>[2] = {}) {
  for (let i = 0; i < n; i++) recordMessage(msg(userId, ts + i, over));
}

/** An approved club with its channels and `members` accepted members. */
function club(id: number, ownerId: string, opts: { channelId?: string; voiceChannelId?: string; members?: number; status?: "approved" | "pending" } = {}) {
  db.insert(schema.clubs)
    .values({
      id,
      name: `club${id}`,
      ownerId,
      status: opts.status ?? "approved",
      channelId: opts.channelId ?? null,
      voiceChannelId: opts.voiceChannelId ?? null,
    })
    .run();
  for (let i = 0; i < (opts.members ?? 0); i++) {
    db.insert(schema.clubMembers).values({ clubId: id, userId: `m${id}-${i}`, accepted: 1 }).run();
  }
}

test("the soulmate is the old closest friend: replies, mentions and voice overlap combined", () => {
  const t = at("2026-05-04T12:00:00Z");
  for (let i = 0; i < 3; i++) recordMessage(msg("u1", t + i, { replyToUserId: "u2", replyToMessageId: `x${i}` }));
  for (let i = 0; i < 2; i++) recordMessage(msg("u1", t + 10 + i, { mentionedUserIds: ["u3"] }));
  voice("u1", "v1", t, t + 3600);
  voice("u3", "v1", t + 600, t + 1800);

  const data = buildWrapped("u1", 2026)!;
  expect(data.soulmateId).toBe("u3");
  expect(data.mostRepliedToId).toBe("u2");
});

test("club is the owned approved club with the most messages, ranked among all approved clubs", () => {
  const t = at("2026-04-01T10:00:00Z");
  club(1, "u1", { channelId: "cA", members: 2 });
  club(2, "u1", { channelId: "cB", voiceChannelId: "vB", members: 1 });
  club(3, "u2", { channelId: "cC", voiceChannelId: "vC", members: 3 });
  club(4, "u1", { channelId: "cP", members: 9, status: "pending" });
  messages("x", 3, t, { channelId: "cA" });
  messages("x", 4, t + 100, { channelId: "cB" });
  // A thread under the club channel counts for the club.
  messages("y", 1, t + 200, { channelId: "tB", parentChannelId: "cB" });
  messages("x", 10, t + 300, { channelId: "cC" });
  messages("x", 50, t + 400, { channelId: "cP" });
  voice("x", "vB", t, t + 7200);
  voice("y", "vC", t, t + 3600);

  const stats = clubYearStats(2026);
  expect(stats.map((s) => s.clubId).sort()).toEqual([1, 2, 3]);

  expect(clubFor("u1", 2026)).toEqual({
    clubId: 2,
    name: "club2",
    members: 1,
    messages: 5,
    messagesRank: 2,
    membersRank: 3,
    voiceRank: 1,
    clubs: 3,
  });
  expect(clubFor("u3", 2026)).toBeNull();
  expect(buildWrapped("x", 2026)!.club).toBeNull();
});

/**
 * 2025: u1 wins election 1 (6 of 8 votes) and holds the chair from 1 Jan to
 * 11 Jan (10 days); u2 wins election 2 and holds it from 18 Jan to the end of
 * the year.
 */
function presidencies() {
  db.insert(schema.elections)
    .values({ id: 1, status: "closed", startsAt: at("2024-12-20T00:00:00Z"), endsAt: at("2025-01-01T00:00:00Z"), winnerId: "u1" })
    .run();
  db.insert(schema.elections)
    .values({ id: 2, status: "closed", startsAt: at("2025-01-11T00:00:00Z"), endsAt: at("2025-01-18T00:00:00Z"), winnerId: "u2" })
    .run();
  db.insert(schema.candidates).values({ electionId: 1, userId: "u1", voteCount: 6 }).run();
  db.insert(schema.candidates).values({ electionId: 1, userId: "u3", voteCount: 2 }).run();
  db.insert(schema.candidates).values({ electionId: 2, userId: "u2", voteCount: 4 }).run();
}

test("presidency over a fixed term: days, vote share, per day, server activity and top emoji", () => {
  presidencies();
  // In office (1-11 Jan): u1 writes 20, u3 writes 10. The server's 30 in 10 days is 3 a day.
  messages("u1", 19, at("2025-01-02T00:00:00Z"));
  recordMessage(msg("u1", at("2025-01-05T00:00:00Z"), { emoji: [{ emoji: "😂", name: null, count: 2 }] }));
  messages("u3", 10, at("2025-01-03T00:00:00Z"));
  // The rest of the year: 335 more, so the year is 365 in 365 days, 1 a day.
  messages("u3", 334, at("2025-03-01T00:00:00Z"));
  recordMessage(msg("u1", at("2025-06-01T00:00:00Z"), { emoji: [{ emoji: "💀", name: null, count: 9 }] }));

  expect(presidencyFor("u1", 2025)).toEqual({
    terms: 1,
    daysInOffice: 10,
    votes: 6,
    votePercent: 75,
    messagesInOffice: 20,
    perDay: 2,
    serverActivityPercent: 200,
    topEmojiInOffice: "😂",
  });
  expect(presidencyFor("u3", 2025)).toBeNull();
  // u2's term runs from 18 Jan to the end of 2025: 348 days.
  const u2 = presidencyFor("u2", 2025)!;
  expect(u2.daysInOffice).toBe(348);
  expect(u2.votePercent).toBe(100);
  // Nobody held the chair in 2023.
  expect(presidencyFor("u1", 2023)).toBeNull();
  expect(buildWrapped("u1", 2025)!.presidency!.daysInOffice).toBe(10);
});
