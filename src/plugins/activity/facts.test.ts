import { afterAll, beforeAll, beforeEach, expect, test } from "bun:test";
import { MessageType } from "discord.js";
import type { Message } from "discord.js";
import { eq } from "drizzle-orm";
import { db, initDb, schema } from "../../db/index.ts";
import { extractMessageFacts, toRawMessage } from "./facts.ts";
import type { RawMessage } from "./facts.ts";

/** Write the excluded-channel list onto the singleton config row. */
function setExcluded(list: string) {
  db.update(schema.guildConfig)
    .set({ activityExcludedChannelIds: list })
    .where(eq(schema.guildConfig.id, 1))
    .run();
}

/** A plain member message in guild `g1`, channel `c2`. */
function raw(over: Partial<RawMessage> = {}): RawMessage {
  return {
    id: "m1",
    author: { id: "u1", bot: false },
    webhookId: null,
    system: false,
    guildId: "g1",
    channelId: "c2",
    parentChannelId: null,
    createdTimestamp: 1_800_000_000_999,
    content: "hello",
    replyToMessageId: null,
    repliedUserId: null,
    mentionedUserIds: [],
    attachmentTypes: [],
    stickerCount: 0,
    ...over,
  };
}

// bun test runs with NODE_ENV=test, so the database is in-memory.
beforeAll(() => {
  initDb();
});

beforeEach(() => {
  setExcluded("");
});

// Other test files share this database: leave the config row as seeded.
afterAll(() => {
  setExcluded("");
});

test("a bot author returns null", () => {
  expect(extractMessageFacts(raw({ author: { id: "b1", bot: true } }), "live")).toBeNull();
});

test("a webhook message returns null", () => {
  expect(extractMessageFacts(raw({ webhookId: "w1" }), "live")).toBeNull();
});

test("a DM (no guild) returns null", () => {
  expect(extractMessageFacts(raw({ guildId: null }), "live")).toBeNull();
});

test("a system message returns null", () => {
  expect(extractMessageFacts(raw({ system: true }), "live")).toBeNull();
});

test("a message in an excluded channel returns null", () => {
  setExcluded("c1");
  expect(extractMessageFacts(raw({ channelId: "c1" }), "live")).toBeNull();
});

test("a message in a thread under an excluded channel returns null", () => {
  setExcluded("c1");
  expect(extractMessageFacts(raw({ channelId: "t1", parentChannelId: "c1" }), "live")).toBeNull();
});

test("a thread under an open channel is kept, with its parent", () => {
  setExcluded("c1");
  const facts = extractMessageFacts(raw({ channelId: "t2", parentChannelId: "c2" }), "live");
  expect(facts).toMatchObject({ channelId: "t2", parentChannelId: "c2" });
});

test("a normal message returns its facts", () => {
  const content = "see https://example.com/a 🙂 <:pog:123>";
  const facts = extractMessageFacts(
    raw({
      content,
      replyToMessageId: "m0",
      repliedUserId: "u2",
      mentionedUserIds: ["u2", "u3"],
      attachmentTypes: ["image/png"],
      stickerCount: 1,
    }),
    "live",
  );
  expect(facts).toEqual({
    messageId: "m1",
    userId: "u1",
    channelId: "c2",
    parentChannelId: null,
    ts: 1_800_000_000,
    replyToUserId: "u2",
    replyToMessageId: "m0",
    mentionedUserIds: ["u2", "u3"],
    attachmentKinds: ["image"],
    linkDomains: ["example.com"],
    stickerCount: 1,
    // 🙂 is one character, though two UTF-16 code units.
    length: content.length - 1,
    emoji: [
      { emoji: "🙂", name: null, count: 1 },
      { emoji: "custom:123", name: "pog", count: 1 },
    ],
    source: "live",
  });
});

test("the facts carry no message text", () => {
  const facts = extractMessageFacts(raw({ content: "a very secret sentence" }), "live");
  expect(JSON.stringify(facts)).not.toContain("secret");
});

test("source is passed through", () => {
  expect(extractMessageFacts(raw(), "backfill")?.source).toBe("backfill");
});

test("ts is the creation time in whole unix seconds", () => {
  expect(extractMessageFacts(raw({ createdTimestamp: 1_800_000_000_000 }), "live")?.ts).toBe(1_800_000_000);
  expect(extractMessageFacts(raw({ createdTimestamp: 1_800_000_001_999 }), "live")?.ts).toBe(1_800_000_001);
});

test("length counts characters, not UTF-16 code units", () => {
  expect(extractMessageFacts(raw({ content: "" }), "live")?.length).toBe(0);
  expect(extractMessageFacts(raw({ content: "abc" }), "live")?.length).toBe(3);
  expect(extractMessageFacts(raw({ content: "🙂🙂" }), "live")?.length).toBe(2);
});

test("attachment kinds follow the content type", () => {
  const facts = extractMessageFacts(
    raw({ attachmentTypes: ["image/png", "video/mp4", "audio/ogg", "application/pdf", null, "IMAGE/GIF"] }),
    "live",
  );
  expect(facts?.attachmentKinds).toEqual(["image", "video", "audio", "other", "other", "image"]);
});

test("link domains are lowercase hostnames, de-duplicated, in order", () => {
  const content = [
    "https://Example.COM/a and http://example.com/b",
    "(https://sub.example.org/x?y=1).",
    "[label](https://youtu.be/abc)",
    "<https://user:pw@host.test:8080/p>",
    "ends a sentence https://dot.test.",
    "not links: example.net ftp://files.test https://",
  ].join("\n");
  expect(extractMessageFacts(raw({ content }), "live")?.linkDomains).toEqual([
    "example.com",
    "sub.example.org",
    "youtu.be",
    "host.test",
    "dot.test",
  ]);
});

test("a message without links, attachments or emoji has empty lists", () => {
  expect(extractMessageFacts(raw(), "live")).toMatchObject({
    replyToUserId: null,
    replyToMessageId: null,
    mentionedUserIds: [],
    attachmentKinds: [],
    linkDomains: [],
    stickerCount: 0,
    emoji: [],
  });
});

test("mentioned users are de-duplicated and never include the author", () => {
  const facts = extractMessageFacts(raw({ mentionedUserIds: ["u2", "u1", "u2", "u3"] }), "live");
  expect(facts?.mentionedUserIds).toEqual(["u2", "u3"]);
});

/** A stand-in for a discord.js message: only the fields `toRawMessage` reads. */
function fakeMessage(over: Record<string, unknown> = {}): Message {
  return {
    id: "m1",
    author: { id: "u1", bot: false },
    webhookId: null,
    system: false,
    guildId: "g1",
    channelId: "t1",
    channel: { isThread: () => true, parentId: "c1" },
    createdTimestamp: 1_800_000_000_123,
    content: "hi <@u3>",
    type: MessageType.Reply,
    reference: { messageId: "m0" },
    mentions: {
      repliedUser: { id: "u2" },
      users: new Map([
        ["u2", {}],
        ["u3", {}],
      ]),
    },
    attachments: new Map([
      ["a1", { contentType: "image/png" }],
      ["a2", { contentType: null }],
    ]),
    stickers: new Map([["s1", {}]]),
    ...over,
  } as unknown as Message;
}

test("toRawMessage reads a reply sent in a thread", () => {
  expect(toRawMessage(fakeMessage())).toEqual({
    id: "m1",
    author: { id: "u1", bot: false },
    webhookId: null,
    system: false,
    guildId: "g1",
    channelId: "t1",
    parentChannelId: "c1",
    createdTimestamp: 1_800_000_000_123,
    content: "hi <@u3>",
    replyToMessageId: "m0",
    repliedUserId: "u2",
    mentionedUserIds: ["u2", "u3"],
    attachmentTypes: ["image/png", null],
    stickerCount: 1,
  });
});

test("toRawMessage reads a plain channel message", () => {
  const message = fakeMessage({
    channelId: "c2",
    channel: { isThread: () => false },
    type: MessageType.Default,
    reference: null,
    mentions: { repliedUser: null, users: new Map() },
    attachments: new Map(),
    stickers: new Map(),
  });
  expect(toRawMessage(message)).toMatchObject({
    channelId: "c2",
    parentChannelId: null,
    replyToMessageId: null,
    repliedUserId: null,
    mentionedUserIds: [],
    attachmentTypes: [],
    stickerCount: 0,
  });
});

test("toRawMessage only treats a reply as a reply", () => {
  // A forward and a crosspost also carry a reference, but answer nobody.
  const message = fakeMessage({ type: MessageType.Default, mentions: { repliedUser: null, users: new Map() } });
  expect(toRawMessage(message)).toMatchObject({ replyToMessageId: null, repliedUserId: null });
});

test("toRawMessage survives a channel that is not cached", () => {
  expect(toRawMessage(fakeMessage({ channel: null })).parentChannelId).toBeNull();
});

test("a raw discord message goes straight through extractMessageFacts", () => {
  const facts = extractMessageFacts(toRawMessage(fakeMessage()), "live");
  expect(facts).toMatchObject({
    messageId: "m1",
    userId: "u1",
    channelId: "t1",
    parentChannelId: "c1",
    replyToUserId: "u2",
    replyToMessageId: "m0",
    mentionedUserIds: ["u2", "u3"],
    attachmentKinds: ["image", "other"],
    stickerCount: 1,
  });
});
