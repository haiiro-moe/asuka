import { afterAll, beforeAll, beforeEach, expect, test } from "bun:test";
import { db, initDb, schema } from "../../../db/index.ts";
import { closeVoiceSegment, openVoiceSegment, recordMessage, recordReactionAdd, recordReactionRemove } from "../record.ts";
import { buildWrapped, yearBounds } from "./data.ts";
import { at, msg, resetWrappedTables, setConfig } from "./testing.ts";

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

test("yearBounds is the UTC calendar year, start inclusive and end exclusive", () => {
  expect(yearBounds(2026)).toEqual({ from: at("2026-01-01T00:00:00Z"), to: at("2027-01-01T00:00:00Z") });
});

test("counts only the given member's messages", () => {
  for (let i = 0; i < 3; i++) recordMessage(msg("u1", at("2026-03-02T10:00:00Z") + i, { channelId: "c1" }));
  for (let i = 0; i < 5; i++) {
    recordMessage(
      msg("u2", at("2026-03-02T22:00:00Z") + i, {
        channelId: "c9",
        replyToUserId: "u1",
        mentionedUserIds: ["u1"],
        emoji: [{ emoji: "🙂", name: null, count: 4 }],
      }),
    );
  }

  const data = buildWrapped("u1", 2026)!;
  expect(data.messages).toBe(3);
  expect(data.topChannelId).toBe("c1");
  expect(data.busiestHour).toBe(10);
  expect(data.topEmoji).toEqual([]);
  // u2 replied to and mentioned u1, but u1 never wrote to anyone.
  expect(data.mostRepliedToId).toBeNull();
  expect(data.closestFriendId).toBeNull();
  expect(buildWrapped("u2", 2026)!.messages).toBe(5);
});

test("year bounds are UTC: 23:59:59Z on 31 Dec counts, 00:00:00Z on 1 Jan does not", () => {
  recordMessage(msg("u1", at("2026-01-01T00:00:00Z")));
  recordMessage(msg("u1", at("2026-12-31T23:59:59Z")));
  recordMessage(msg("u1", at("2027-01-01T00:00:00Z")));

  expect(buildWrapped("u1", 2026)!.messages).toBe(2);
  expect(buildWrapped("u1", 2027)!.messages).toBe(1);
  expect(buildWrapped("u1", 2025)).toBeNull();
});

test("closestFriendId is the counterpart with the highest reply, mention and voice weight", () => {
  const t = at("2026-05-04T12:00:00Z");
  // Three replies to u2.
  for (let i = 0; i < 3; i++) recordMessage(msg("u1", t + i, { replyToUserId: "u2", replyToMessageId: `x${i}` }));
  // Two mentions of u3, and 20 minutes in voice together (2 points).
  for (let i = 0; i < 2; i++) recordMessage(msg("u1", t + 10 + i, { mentionedUserIds: ["u3"] }));
  voice("u1", "v1", t, t + 3600);
  voice("u3", "v1", t + 600, t + 1800);

  const data = buildWrapped("u1", 2026)!;
  expect(data.mostRepliedToId).toBe("u2");
  expect(data.closestFriendId).toBe("u3");
});

test("voice overlap alone can make a closest friend, and needs the same channel", () => {
  const t = at("2026-05-04T12:00:00Z");
  voice("u1", "v1", t, t + 7200);
  voice("u2", "v1", t + 600, t + 4200);
  voice("u3", "v2", t, t + 7200);

  const data = buildWrapped("u1", 2026)!;
  expect(data.closestFriendId).toBe("u2");
  expect(data.voiceHours).toBe(2);
  expect(data.messages).toBe(0);
});

test("replies to yourself do not make you your own friend", () => {
  recordMessage(msg("u1", at("2026-05-04T12:00:00Z"), { replyToUserId: "u1" }));
  const data = buildWrapped("u1", 2026)!;
  expect(data.mostRepliedToId).toBeNull();
  expect(data.closestFriendId).toBeNull();
});

test("no activity that year returns null", () => {
  expect(buildWrapped("nobody", 2026)).toBeNull();
  recordMessage(msg("u1", at("2025-06-01T00:00:00Z")));
  expect(buildWrapped("u1", 2026)).toBeNull();
});

test("topEmoji is capped at 3 and merges text and reaction use", () => {
  const t = at("2026-02-10T09:00:00Z");
  recordMessage(
    msg("u1", t, {
      emoji: [
        { emoji: "custom:1", name: "pog", count: 2 },
        { emoji: "💀", name: null, count: 1 },
        { emoji: "😂", name: null, count: 3 },
      ],
    }),
  );
  // Three reactions with 💀 by u1 on other people's messages.
  for (let i = 0; i < 3; i++) {
    recordReactionAdd({ messageId: `r${i}`, userId: "u1", emoji: "💀", name: null, channelId: "c1", messageAuthorId: "u2", ts: t + i });
  }
  // One reaction with 🙂, and one more that was removed again.
  recordReactionAdd({ messageId: "r9", userId: "u1", emoji: "🙂", name: null, channelId: "c1", messageAuthorId: "u2", ts: t });
  recordReactionAdd({ messageId: "r8", userId: "u1", emoji: "🙂", name: null, channelId: "c1", messageAuthorId: "u2", ts: t });
  recordReactionRemove("r8", "u1", "🙂", t + 5);
  // Someone else's emoji never count.
  recordMessage(msg("u2", t, { emoji: [{ emoji: "🙂", name: null, count: 50 }] }));

  const data = buildWrapped("u1", 2026)!;
  expect(data.topEmoji).toEqual([
    { emoji: "💀", name: null, count: 4 },
    { emoji: "😂", name: null, count: 3 },
    { emoji: "custom:1", name: "pog", count: 2 },
  ]);
});

test("busiest hour, weekday and channel", () => {
  // 2026-03-02 is a Monday, 2026-03-03 a Tuesday.
  recordMessage(msg("u1", at("2026-03-02T22:10:00Z"), { channelId: "c5" }));
  recordMessage(msg("u1", at("2026-03-03T22:20:00Z"), { channelId: "c5" }));
  recordMessage(msg("u1", at("2026-03-03T08:00:00Z"), { channelId: "c6" }));

  const data = buildWrapped("u1", 2026)!;
  expect(data.busiestHour).toBe(22);
  expect(data.busiestDay).toBe("tuesday");
  expect(data.topChannelId).toBe("c5");
});

test("a thread is a channel of its own: the most active thread is the top channel", () => {
  const t = at("2026-03-02T12:00:00Z");
  // Three messages in thread t1 under c5, two in c5 itself, two in another thread t2 of c5.
  for (let i = 0; i < 3; i++) recordMessage(msg("u1", t + i, { channelId: "t1", parentChannelId: "c5" }));
  for (let i = 0; i < 2; i++) recordMessage(msg("u1", t + 10 + i, { channelId: "c5" }));
  for (let i = 0; i < 2; i++) recordMessage(msg("u1", t + 20 + i, { channelId: "t2", parentChannelId: "c5" }));

  expect(buildWrapped("u1", 2026)!.topChannelId).toBe("t1");
});

test("voice hours are clipped to the year", () => {
  voice("u1", "v1", at("2026-12-31T23:00:00Z"), at("2027-01-01T01:00:00Z"));
  expect(buildWrapped("u1", 2026)!.voiceHours).toBe(1);
  expect(buildWrapped("u1", 2027)!.voiceHours).toBe(1);
});

test("xpLevel is the member's current level", () => {
  db.insert(schema.members).values({ userId: "u1", level: 7, xp: 1000 }).run();
  recordMessage(msg("u1", at("2026-03-02T10:00:00Z")));
  expect(buildWrapped("u1", 2026)!.xpLevel).toBe(7);
});

test("rows in excluded channels and their threads are left out", () => {
  const t = at("2026-04-01T12:00:00Z");
  recordMessage(msg("u1", t, { channelId: "c1" }));
  recordMessage(msg("u1", t + 1, { channelId: "secret", replyToUserId: "u2", mentionedUserIds: ["u3"] }));
  recordMessage(
    msg("u1", t + 2, {
      channelId: "thread",
      parentChannelId: "secret",
      emoji: [{ emoji: "😂", name: null, count: 9 }],
    }),
  );
  voice("u1", "secret", t, t + 3600);
  voice("u3", "secret", t, t + 3600);
  // Exclude the channel after the rows were written.
  setConfig({ activityExcludedChannelIds: "secret" });

  const data = buildWrapped("u1", 2026)!;
  expect(data.messages).toBe(1);
  expect(data.topEmoji).toEqual([]);
  expect(data.voiceHours).toBe(0);
  expect(data.mostRepliedToId).toBeNull();
  expect(data.closestFriendId).toBeNull();
  expect(data.topChannelId).toBe("c1");
});
