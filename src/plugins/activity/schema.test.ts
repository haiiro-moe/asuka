import { beforeAll, beforeEach, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { db, getConfig, initDb, schema } from "../../db/index.ts";
import { plugins } from "../index.ts";

/** Every table this file writes to. Emptied before each test. */
const activityTables = [
  schema.activityMessages,
  schema.activityMentions,
  schema.activityEmoji,
  schema.activityReactions,
  schema.activityVoice,
  schema.activityMembership,
  schema.activityCommands,
  schema.activityCredits,
  schema.activityBackfill,
  schema.activityWrappedRuns,
  schema.activityWrappedLinks,
  schema.activityWrappedOptins,
  schema.activityWrappedServer,
  schema.activityWrappedSignup,
];

// bun test runs with NODE_ENV=test, so the database is in-memory.
beforeAll(() => {
  initDb();
});

// Tests assert whole-table contents, so none may see another test's rows.
beforeEach(() => {
  for (const table of activityTables) db.delete(table).run();
});

test("schema inserts and reads back one row per activity table", () => {
  db.insert(schema.activityMessages)
    .values({
      messageId: "m-roundtrip",
      userId: "u1",
      channelId: "c1",
      parentChannelId: null,
      ts: 1_800_000_000,
      replyToUserId: "u2",
      replyToMessageId: "m0",
      mentionCount: 1,
      attachmentKinds: "image,video",
      linkDomains: "example.com",
      stickerCount: 0,
      length: 42,
      source: "live",
    })
    .run();
  const message = db
    .select()
    .from(schema.activityMessages)
    .where(eq(schema.activityMessages.messageId, "m-roundtrip"))
    .get();
  expect(message).toMatchObject({
    messageId: "m-roundtrip",
    userId: "u1",
    channelId: "c1",
    parentChannelId: null,
    ts: 1_800_000_000,
    replyToUserId: "u2",
    replyToMessageId: "m0",
    mentionCount: 1,
    attachmentKinds: "image,video",
    linkDomains: "example.com",
    stickerCount: 0,
    length: 42,
    source: "live",
  });

  db.insert(schema.activityMentions)
    .values({
      messageId: "m-roundtrip",
      ts: 1_800_000_000,
      fromUserId: "u1",
      toUserId: "u2",
      channelId: "c1",
    })
    .run();
  expect(db.select().from(schema.activityMentions).all()).toMatchObject([
    { messageId: "m-roundtrip", fromUserId: "u1", toUserId: "u2", channelId: "c1", parentChannelId: null },
  ]);

  db.insert(schema.activityEmoji)
    .values({
      messageId: "m-roundtrip",
      ts: 1_800_000_000,
      userId: "u1",
      channelId: "c1",
      emoji: "custom:123456789012345678",
      name: "blobwave",
      count: 2,
    })
    .run();
  expect(db.select().from(schema.activityEmoji).all()).toMatchObject([
    {
      messageId: "m-roundtrip",
      parentChannelId: null,
      emoji: "custom:123456789012345678",
      name: "blobwave",
      count: 2,
    },
  ]);

  db.insert(schema.activityReactions)
    .values({
      messageId: "m-roundtrip",
      userId: "u2",
      emoji: "★",
      name: null,
      channelId: "c1",
      messageAuthorId: "u1",
      addedAt: 1_800_000_100,
      removedAt: null,
    })
    .run();
  expect(db.select().from(schema.activityReactions).all()).toMatchObject([
    {
      messageId: "m-roundtrip",
      userId: "u2",
      emoji: "★",
      name: null,
      parentChannelId: null,
      messageAuthorId: "u1",
      addedAt: 1_800_000_100,
      removedAt: null,
    },
  ]);

  db.insert(schema.activityVoice)
    .values({
      userId: "u1",
      channelId: "v1",
      startedAt: 1_800_000_000,
      endedAt: null,
      lastSeenAt: 1_800_000_060,
      muted: 1,
      deafened: 0,
      streaming: 0,
      video: 1,
    })
    .run();
  expect(db.select().from(schema.activityVoice).all()).toMatchObject([
    {
      userId: "u1",
      channelId: "v1",
      startedAt: 1_800_000_000,
      endedAt: null,
      lastSeenAt: 1_800_000_060,
      muted: 1,
      deafened: 0,
      streaming: 0,
      video: 1,
    },
  ]);

  db.insert(schema.activityMembership)
    .values({ userId: "u1", kind: "join", ts: 1_800_000_000 })
    .run();
  expect(db.select().from(schema.activityMembership).all()).toMatchObject([
    { userId: "u1", kind: "join", ts: 1_800_000_000 },
  ]);

  db.insert(schema.activityCommands)
    .values({ userId: "u1", name: "profile", ok: 1, ts: 1_800_000_000 })
    .run();
  expect(db.select().from(schema.activityCommands).all()).toMatchObject([
    { userId: "u1", name: "profile", ok: 1, ts: 1_800_000_000 },
  ]);

  db.insert(schema.activityCredits)
    .values({ userId: "u1", delta: -5, balanceAfter: 95, ts: 1_800_000_000 })
    .run();
  expect(db.select().from(schema.activityCredits).all()).toMatchObject([
    { userId: "u1", delta: -5, balanceAfter: 95, ts: 1_800_000_000 },
  ]);

  db.insert(schema.activityBackfill)
    .values({
      channelId: "c1",
      beforeId: "m-roundtrip",
      scanned: 100,
      doneAt: null,
      reactionsDoneAt: null,
      updatedAt: 1_800_000_000,
    })
    .run();
  expect(db.select().from(schema.activityBackfill).all()).toMatchObject([
    {
      channelId: "c1",
      beforeId: "m-roundtrip",
      scanned: 100,
      doneAt: null,
      reactionsDoneAt: null,
      updatedAt: 1_800_000_000,
    },
  ]);

  // announce is left out on purpose: it must default to 1 (announce).
  db.insert(schema.activityWrappedRuns)
    .values({
      year: 2026,
      status: "processing",
      total: 10,
      processed: 3,
      sent: 0,
      failed: 0,
      startedBy: "u9",
      startedAt: 1_800_000_000,
      updatedAt: 1_800_000_010,
      finishedAt: null,
    })
    .run();
  expect(db.select().from(schema.activityWrappedRuns).all()).toMatchObject([
    {
      year: 2026,
      status: "processing",
      total: 10,
      processed: 3,
      sent: 0,
      failed: 0,
      startedBy: "u9",
      finishedAt: null,
      announce: 1,
      kind: "real",
      ownerUserId: null,
      serverToken: null,
    },
  ]);

  // dmStatus, opens and processedRunId are left out on purpose: they must take their defaults.
  db.insert(schema.activityWrappedLinks)
    .values({
      userId: "u1",
      year: 2026,
      token: "tok-roundtrip",
      data: JSON.stringify({ messages: 12 }),
      createdAt: 1_800_000_000,
    })
    .run();
  expect(db.select().from(schema.activityWrappedLinks).all()).toMatchObject([
    {
      userId: "u1",
      year: 2026,
      token: "tok-roundtrip",
      data: '{"messages":12}',
      dmStatus: "pending",
      createdAt: 1_800_000_000,
      opens: 0,
      lastOpenedAt: null,
      processedRunId: null,
      private: 0,
      ownerUserId: "",
    },
  ]);

  // data and announcedAt are left out: a token exists before any snapshot.
  db.insert(schema.activityWrappedServer).values({ year: 2026, token: "srv-roundtrip", createdAt: 1_800_000_000 }).run();
  expect(db.select().from(schema.activityWrappedServer).all()).toMatchObject([
    { year: 2026, token: "srv-roundtrip", data: null, createdAt: 1_800_000_000, announcedAt: null },
  ]);

  // buttons and closed take their defaults (with buttons, open).
  db.insert(schema.activityWrappedSignup).values({ year: 2026, channelId: "c1", messageId: "m1", postedAt: 1_800_000_000 }).run();
  expect(db.select().from(schema.activityWrappedSignup).all()).toMatchObject([
    { year: 2026, channelId: "c1", messageId: "m1", buttons: 1, closed: 0, postedAt: 1_800_000_000, closedAt: null },
  ]);

  db.insert(schema.activityWrappedOptins)
    .values({ userId: "u1", optedInAt: 1_800_000_000 })
    .run();
  expect(db.select().from(schema.activityWrappedOptins).all()).toMatchObject([
    { userId: "u1", optedInAt: 1_800_000_000 },
  ]);
});

test("mention, emoji and reaction rows of a thread message keep its parent channel", () => {
  // Thread t1 under channel c1.
  db.insert(schema.activityMentions)
    .values({
      messageId: "m-thread",
      ts: 1_800_000_000,
      fromUserId: "u1",
      toUserId: "u2",
      channelId: "t1",
      parentChannelId: "c1",
    })
    .run();
  db.insert(schema.activityEmoji)
    .values({
      messageId: "m-thread",
      ts: 1_800_000_000,
      userId: "u1",
      channelId: "t1",
      parentChannelId: "c1",
      emoji: "custom:123",
      name: "pog",
      count: 1,
    })
    .run();
  db.insert(schema.activityReactions)
    .values({
      messageId: "m-thread",
      userId: "u2",
      emoji: "custom:123",
      name: "pog",
      channelId: "t1",
      parentChannelId: "c1",
      messageAuthorId: "u1",
      addedAt: 1_800_000_100,
    })
    .run();

  const thread = { messageId: "m-thread", channelId: "t1", parentChannelId: "c1" };
  expect(db.select().from(schema.activityMentions).all()).toMatchObject([thread]);
  expect(db.select().from(schema.activityEmoji).all()).toMatchObject([thread]);
  expect(db.select().from(schema.activityReactions).all()).toMatchObject([thread]);
});

test("activityMessages.messageId is unique", () => {
  const row = {
    messageId: "m-unique",
    userId: "u1",
    channelId: "c1",
    ts: 1_800_000_000,
    mentionCount: 0,
    attachmentKinds: "",
    linkDomains: "",
    stickerCount: 0,
    length: 5,
    source: "backfill" as const,
  };
  db.insert(schema.activityMessages).values(row).run();
  db.insert(schema.activityMessages)
    .values({ ...row, userId: "u2", source: "live" })
    .onConflictDoNothing()
    .run();

  const rows = db
    .select()
    .from(schema.activityMessages)
    .where(eq(schema.activityMessages.messageId, "m-unique"))
    .all();
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({ userId: "u1", source: "backfill" });
});

test('guild_config exposes activityEnabled=1 and activityExcludedChannelIds=""', () => {
  const config = getConfig();
  expect(config.activityEnabled).toBe(1);
  expect(config.activityExcludedChannelIds).toBe("");
});

test("the activity plugin is registered", () => {
  expect(plugins.some((p) => p.name === "activity")).toBe(true);
});
