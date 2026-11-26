import { afterAll, beforeAll, beforeEach, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { db, initDb, schema } from "../../db/index.ts";
import type { MessageFacts } from "./facts.ts";
import {
  closeDanglingVoiceSegments,
  closeVoiceSegment,
  openVoiceSegment,
  recordCommand,
  recordCredit,
  recordMembership,
  recordMessage,
  recordReactionAdd,
  recordReactionRemove,
  touchVoiceSegments,
} from "./record.ts";
import type { VoiceSnapshot } from "./record.ts";

/** Every table this file writes to. Emptied before each test. */
const touchedTables = [
  schema.activityMessages,
  schema.activityMentions,
  schema.activityEmoji,
  schema.activityReactions,
  schema.activityVoice,
  schema.activityMembership,
  schema.activityCommands,
  schema.activityCredits,
];

/** Empty the touched tables and clear the excluded-channel list. */
function reset() {
  for (const table of touchedTables) db.delete(table).run();
  setExcluded("");
}

/** Write the excluded-channel list onto the singleton config row. */
function setExcluded(list: string) {
  db.update(schema.guildConfig)
    .set({ activityExcludedChannelIds: list })
    .where(eq(schema.guildConfig.id, 1))
    .run();
}

/** Facts for a plain message `m1` by `u1` in channel `c2`. */
function facts(over: Partial<MessageFacts> = {}): MessageFacts {
  return {
    messageId: "m1",
    userId: "u1",
    channelId: "c2",
    parentChannelId: null,
    ts: 1_800_000_000,
    replyToUserId: null,
    replyToMessageId: null,
    mentionedUserIds: [],
    attachmentKinds: [],
    linkDomains: [],
    stickerCount: 0,
    length: 5,
    emoji: [],
    source: "live",
    ...over,
  };
}

/** A reaction by `u2` on `m1`, written by `u1`. */
function reaction(over: Partial<Parameters<typeof recordReactionAdd>[0]> = {}) {
  return {
    messageId: "m1",
    userId: "u2",
    emoji: "🙂",
    name: null,
    channelId: "c2",
    messageAuthorId: "u1",
    ts: 100,
    ...over,
  };
}

/** A voice state in channel `v1` with every flag off. */
function snapshot(over: Partial<VoiceSnapshot> = {}): VoiceSnapshot {
  return { channelId: "v1", muted: false, deafened: false, streaming: false, video: false, ...over };
}

const messages = () => db.select().from(schema.activityMessages).all();
const mentions = () => db.select().from(schema.activityMentions).all();
const emoji = () => db.select().from(schema.activityEmoji).all();
const reactions = () => db.select().from(schema.activityReactions).all();
const voice = () => db.select().from(schema.activityVoice).orderBy(schema.activityVoice.id).all();

// bun test runs with NODE_ENV=test, so the database is in-memory.
beforeAll(() => {
  initDb();
});

beforeEach(reset);

// Other test files share this database: leave it as seeded.
afterAll(reset);

// --- recordMessage ---------------------------------------------------------

test("recordMessage writes the message row", () => {
  const written = recordMessage(
    facts({
      channelId: "t1",
      parentChannelId: "c2",
      replyToUserId: "u2",
      replyToMessageId: "m0",
      mentionedUserIds: ["u2"],
      attachmentKinds: ["image", "video"],
      linkDomains: ["example.com", "youtu.be"],
      stickerCount: 1,
      length: 42,
      source: "backfill",
    }),
  );
  expect(written).toBe(true);
  expect(messages()).toMatchObject([
    {
      messageId: "m1",
      userId: "u1",
      channelId: "t1",
      parentChannelId: "c2",
      ts: 1_800_000_000,
      replyToUserId: "u2",
      replyToMessageId: "m0",
      mentionCount: 1,
      attachmentKinds: "image,video",
      linkDomains: "example.com,youtu.be",
      stickerCount: 1,
      length: 42,
      source: "backfill",
    },
  ]);
});

test("recordMessage stores empty lists as empty text", () => {
  recordMessage(facts());
  expect(messages()).toMatchObject([{ mentionCount: 0, attachmentKinds: "", linkDomains: "" }]);
});

test("a second recordMessage with the same messageId returns false and leaves one row", () => {
  expect(recordMessage(facts({ source: "backfill" }))).toBe(true);
  expect(recordMessage(facts({ userId: "u9", source: "live" }))).toBe(false);
  expect(messages()).toHaveLength(1);
  expect(messages()[0]).toMatchObject({ userId: "u1", source: "backfill" });
});

test("a duplicate message adds no mention or emoji rows", () => {
  recordMessage(facts());
  const again = facts({ mentionedUserIds: ["u2"], emoji: [{ emoji: "🙂", name: null, count: 1 }] });
  expect(recordMessage(again)).toBe(false);
  expect(mentions()).toHaveLength(0);
  expect(emoji()).toHaveLength(0);
});

test("mentions u2 and u3 give two activity_mentions rows", () => {
  recordMessage(facts({ channelId: "t1", parentChannelId: "c2", mentionedUserIds: ["u2", "u3"] }));
  expect(mentions()).toHaveLength(2);
  expect(mentions()).toMatchObject([
    { messageId: "m1", ts: 1_800_000_000, fromUserId: "u1", toUserId: "u2", channelId: "t1" },
    { messageId: "m1", ts: 1_800_000_000, fromUserId: "u1", toUserId: "u3", channelId: "t1" },
  ]);
  expect(messages()[0]?.mentionCount).toBe(2);
});

test("a user listed twice is one mention", () => {
  expect(recordMessage(facts({ mentionedUserIds: ["u2", "u2"] }))).toBe(true);
  expect(mentions()).toHaveLength(1);
  expect(messages()[0]?.mentionCount).toBe(1);
});

test("🙂 twice gives one activity_emoji row with count 2", () => {
  recordMessage(facts({ emoji: [{ emoji: "🙂", name: null, count: 2 }] }));
  expect(emoji()).toHaveLength(1);
  expect(emoji()[0]).toMatchObject({
    messageId: "m1",
    ts: 1_800_000_000,
    userId: "u1",
    channelId: "c2",
    emoji: "🙂",
    name: null,
    count: 2,
  });
});

test("a custom emoji is stored as custom:<id> with its name", () => {
  recordMessage(
    facts({
      emoji: [
        { emoji: "custom:123", name: "pog", count: 3 },
        { emoji: "🙂", name: null, count: 1 },
      ],
    }),
  );
  expect(emoji()).toMatchObject([
    { emoji: "custom:123", name: "pog", count: 3 },
    { emoji: "🙂", name: null, count: 1 },
  ]);
});

test("facts from an excluded channel return false and write nothing", () => {
  setExcluded("c1");
  const busy = { mentionedUserIds: ["u2"], emoji: [{ emoji: "🙂", name: null, count: 1 }] };
  expect(recordMessage(facts({ ...busy, channelId: "c1" }))).toBe(false);
  expect(recordMessage(facts({ ...busy, messageId: "m2", channelId: "t1", parentChannelId: "c1" }))).toBe(false);
  expect(messages()).toHaveLength(0);
  expect(mentions()).toHaveLength(0);
  expect(emoji()).toHaveLength(0);
});

test("recordMessage writes all of a message or none of it", () => {
  // An emoji entry the table cannot hold makes the last insert fail.
  const broken = facts({
    mentionedUserIds: ["u2"],
    emoji: [{ emoji: null as unknown as string, name: null, count: 1 }],
  });
  expect(() => recordMessage(broken)).toThrow();
  expect(messages()).toHaveLength(0);
  expect(mentions()).toHaveLength(0);
  expect(emoji()).toHaveLength(0);
});

// --- reactions ---------------------------------------------------------------

test("a reaction add then remove sets removedAt, and adding again clears it", () => {
  recordReactionAdd(reaction({ ts: 100 }));
  expect(reactions()).toMatchObject([
    {
      messageId: "m1",
      userId: "u2",
      emoji: "🙂",
      name: null,
      channelId: "c2",
      messageAuthorId: "u1",
      addedAt: 100,
      removedAt: null,
    },
  ]);

  recordReactionRemove("m1", "u2", "🙂", 200);
  expect(reactions()).toHaveLength(1);
  expect(reactions()[0]).toMatchObject({ addedAt: 100, removedAt: 200 });

  recordReactionAdd(reaction({ ts: 300 }));
  expect(reactions()).toHaveLength(1);
  expect(reactions()[0]?.removedAt).toBeNull();
});

test("adding the same reaction twice does not throw and keeps one row", () => {
  recordReactionAdd(reaction({ ts: 100 }));
  recordReactionAdd(reaction({ ts: 150 }));
  expect(reactions()).toHaveLength(1);
  expect(reactions()[0]).toMatchObject({ addedAt: 100, removedAt: null });
});

test("a later add fills in a message author that was unknown", () => {
  recordReactionAdd(reaction({ messageAuthorId: null }));
  recordReactionAdd(reaction({ messageAuthorId: "u1" }));
  expect(reactions()[0]?.messageAuthorId).toBe("u1");
  recordReactionAdd(reaction({ messageAuthorId: null }));
  expect(reactions()[0]?.messageAuthorId).toBe("u1");
});

test("reactions are kept apart by member, emoji and message", () => {
  recordReactionAdd(reaction());
  recordReactionAdd(reaction({ userId: "u3" }));
  recordReactionAdd(reaction({ emoji: "custom:123", name: "pog" }));
  recordReactionAdd(reaction({ messageId: "m2" }));
  expect(reactions()).toHaveLength(4);

  recordReactionRemove("m1", "u2", "🙂", 200);
  const removed = reactions().filter((row) => row.removedAt !== null);
  expect(removed).toMatchObject([{ messageId: "m1", userId: "u2", emoji: "🙂", removedAt: 200 }]);
});

test("removing a reaction twice keeps the first removal time", () => {
  recordReactionAdd(reaction());
  recordReactionRemove("m1", "u2", "🙂", 200);
  recordReactionRemove("m1", "u2", "🙂", 250);
  expect(reactions()[0]?.removedAt).toBe(200);
});

test("removing a reaction that was never recorded writes nothing", () => {
  recordReactionRemove("m1", "u2", "🙂", 200);
  expect(reactions()).toHaveLength(0);
});

test("a reaction in an excluded channel is not recorded", () => {
  setExcluded("c1");
  recordReactionAdd(reaction({ channelId: "c1" }));
  expect(reactions()).toHaveLength(0);
});

// --- voice -------------------------------------------------------------------

test("opening then closing a voice segment sets endedAt", () => {
  openVoiceSegment("u1", snapshot({ muted: true, video: true }), 100);
  expect(voice()).toMatchObject([
    {
      userId: "u1",
      channelId: "v1",
      startedAt: 100,
      endedAt: null,
      lastSeenAt: 100,
      muted: 1,
      deafened: 0,
      streaming: 0,
      video: 1,
    },
  ]);

  closeVoiceSegment("u1", 400);
  expect(voice()).toHaveLength(1);
  expect(voice()[0]).toMatchObject({ startedAt: 100, endedAt: 400, lastSeenAt: 400 });
});

test("closeVoiceSegment only closes that member's open segment", () => {
  openVoiceSegment("u1", snapshot(), 100);
  closeVoiceSegment("u1", 200);
  openVoiceSegment("u1", snapshot(), 300);
  openVoiceSegment("u2", snapshot(), 300);

  closeVoiceSegment("u1", 400);
  expect(voice()).toMatchObject([
    { userId: "u1", startedAt: 100, endedAt: 200 },
    { userId: "u1", startedAt: 300, endedAt: 400 },
    { userId: "u2", startedAt: 300, endedAt: null },
  ]);
});

test("closing with no open segment writes nothing", () => {
  closeVoiceSegment("u1", 400);
  expect(voice()).toHaveLength(0);
});

test("opening a segment closes the member's previous open one, so segments never overlap", () => {
  openVoiceSegment("u1", snapshot({ channelId: "v1" }), 100);
  openVoiceSegment("u1", snapshot({ channelId: "v2", muted: true }), 250);
  expect(voice()).toMatchObject([
    { channelId: "v1", startedAt: 100, endedAt: 250 },
    { channelId: "v2", startedAt: 250, endedAt: null, muted: 1 },
  ]);
});

test("touchVoiceSegments(500) updates lastSeenAt of open rows only", () => {
  openVoiceSegment("u1", snapshot(), 100);
  closeVoiceSegment("u1", 200);
  openVoiceSegment("u2", snapshot(), 300);
  openVoiceSegment("u3", snapshot(), 350);

  touchVoiceSegments(500);
  expect(voice()).toMatchObject([
    { userId: "u1", endedAt: 200, lastSeenAt: 200 },
    { userId: "u2", endedAt: null, lastSeenAt: 500 },
    { userId: "u3", endedAt: null, lastSeenAt: 500 },
  ]);
});

test("closeDanglingVoiceSegments closes an open row at its lastSeenAt and returns 1", () => {
  openVoiceSegment("u1", snapshot(), 100);
  closeVoiceSegment("u1", 200);
  openVoiceSegment("u2", snapshot(), 300);
  touchVoiceSegments(500);

  expect(closeDanglingVoiceSegments()).toBe(1);
  expect(voice()).toMatchObject([
    { userId: "u1", endedAt: 200, lastSeenAt: 200 },
    { userId: "u2", startedAt: 300, endedAt: 500, lastSeenAt: 500 },
  ]);
  expect(closeDanglingVoiceSegments()).toBe(0);
});

test("a voice segment in an excluded channel is not opened", () => {
  setExcluded("v9");
  openVoiceSegment("u1", snapshot({ channelId: "v9" }), 100);
  expect(voice()).toHaveLength(0);
});

// --- membership, commands, credits -------------------------------------------

test("recordMembership writes one row per join or leave", () => {
  recordMembership("u1", "join", 100);
  recordMembership("u1", "leave", 200);
  recordMembership("u1", "join", 300);
  expect(db.select().from(schema.activityMembership).all()).toMatchObject([
    { userId: "u1", kind: "join", ts: 100 },
    { userId: "u1", kind: "leave", ts: 200 },
    { userId: "u1", kind: "join", ts: 300 },
  ]);
});

test("recordCommand stores ok as 1 or 0", () => {
  recordCommand("u1", "profile", true, 100);
  recordCommand("u1", "store", false, 200);
  expect(db.select().from(schema.activityCommands).all()).toMatchObject([
    { userId: "u1", name: "profile", ok: 1, ts: 100 },
    { userId: "u1", name: "store", ok: 0, ts: 200 },
  ]);
});

test("recordCredit stores the signed change and the balance after it", () => {
  recordCredit("u1", 50, 150, 100);
  recordCredit("u1", -30, 120, 200);
  expect(db.select().from(schema.activityCredits).all()).toMatchObject([
    { userId: "u1", delta: 50, balanceAfter: 150, ts: 100 },
    { userId: "u1", delta: -30, balanceAfter: 120, ts: 200 },
  ]);
});

test("recordCommand and recordCredit default ts to now", () => {
  const before = Math.floor(Date.now() / 1000);
  recordCommand("u1", "profile", true);
  recordCredit("u1", 5, 5);
  const after = Math.floor(Date.now() / 1000);

  const command = db.select().from(schema.activityCommands).get();
  const credit = db.select().from(schema.activityCredits).get();
  for (const ts of [command?.ts, credit?.ts]) {
    expect(ts).toBeGreaterThanOrEqual(before);
    expect(ts).toBeLessThanOrEqual(after);
  }
});
