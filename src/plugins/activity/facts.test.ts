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
    // u2 is the reply target and is not named in the text, so it is no mention.
    mentionedUserIds: ["u3"],
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

/** The link domains of a message with this text. */
function domainsOf(content: string): string[] | undefined {
  return extractMessageFacts(raw({ content }), "live")?.linkDomains;
}

test("punctuation after a link is not part of its domain", () => {
  expect(domainsOf("look at https://example.com, it is good")).toEqual(["example.com"]);
  expect(domainsOf("wow https://a.com!")).toEqual(["a.com"]);
  expect(domainsOf("first https://b.com; then the rest")).toEqual(["b.com"]);
  expect(domainsOf("**https://x.com**")).toEqual(["x.com"]);
  expect(domainsOf("~~https://e.com~~")).toEqual(["e.com"]);
  expect(domainsOf("is it https://q.com?")).toEqual(["q.com"]);
  expect(domainsOf("this one: https://c.com:")).toEqual(["c.com"]);
  expect(domainsOf("__https://u.com__ ||https://s.com||")).toEqual(["u.com", "s.com"]);
  expect(domainsOf("really https://m.com?!...")).toEqual(["m.com"]);
});

test("a clean link is left as it is", () => {
  expect(domainsOf("https://clean.test")).toEqual(["clean.test"]);
  expect(domainsOf("https://clean.test/a_b/c~d?e=1;f=2#g!")).toEqual(["clean.test"]);
  expect(domainsOf("https://sub-1.clean.test:8443/")).toEqual(["sub-1.clean.test"]);
  expect(domainsOf("http://192.168.0.1/admin")).toEqual(["192.168.0.1"]);
});

test("punctuation after a link with a path does not change its domain", () => {
  expect(domainsOf("see https://example.com/a, https://example.com/b! and https://other.test/c.")).toEqual([
    "example.com",
    "other.test",
  ]);
});

test("the same domain with and without trailing punctuation is one domain", () => {
  expect(domainsOf("https://example.com, https://example.com! https://example.com")).toEqual(["example.com"]);
});

test("a hostname with characters no domain has is dropped", () => {
  expect(domainsOf("https://bad,host.test/x https://a.com!b/ https://under_score.test/")).toEqual([]);
  expect(domainsOf("https://x.com**bold https://ok.test/")).toEqual(["ok.test"]);
});

test("an international domain is stored in its punycode form", () => {
  expect(domainsOf("https://bücher.example/")).toEqual(["xn--bcher-kva.example"]);
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

/** A reply by `u1` to message `m0` written by `u2`. Discord lists `u2` as mentioned when the reply pings. */
function reply(over: Partial<RawMessage> = {}): RawMessage {
  return raw({ replyToMessageId: "m0", repliedUserId: "u2", mentionedUserIds: ["u2"], content: "ok", ...over });
}

test("a reply that pings its target is a reply, not a mention", () => {
  const facts = extractMessageFacts(reply(), "live");
  expect(facts).toMatchObject({ replyToUserId: "u2", replyToMessageId: "m0", mentionedUserIds: [] });
});

test("a reply that names its target in the text keeps the mention", () => {
  expect(extractMessageFacts(reply({ content: "thanks <@u2>" }), "live")).toMatchObject({
    replyToUserId: "u2",
    mentionedUserIds: ["u2"],
  });
  // The older nickname form of the same token.
  expect(extractMessageFacts(reply({ content: "<@!u2> thanks" }), "live")?.mentionedUserIds).toEqual(["u2"]);
});

test("a reply that mentions someone else keeps that mention", () => {
  const facts = extractMessageFacts(reply({ content: "<@u3> look", mentionedUserIds: ["u2", "u3"] }), "live");
  expect(facts).toMatchObject({ replyToUserId: "u2", mentionedUserIds: ["u3"] });
});

test("a mention token for another user does not keep the reply target", () => {
  // `<@u22>` and a role mention `<@&u2>` are not `<@u2>`.
  const facts = extractMessageFacts(
    reply({ content: "<@u22> and <@&u2>", mentionedUserIds: ["u2", "u22"] }),
    "live",
  );
  expect(facts?.mentionedUserIds).toEqual(["u22"]);
});

test("a mention in a message that is not a reply is kept without a token check", () => {
  const facts = extractMessageFacts(raw({ content: "no token here", mentionedUserIds: ["u2"] }), "live");
  expect(facts?.mentionedUserIds).toEqual(["u2"]);
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

test("toRawMessage leaves bots out of the mentioned users", () => {
  const message = fakeMessage({
    type: MessageType.Default,
    reference: null,
    content: "<@b1> <@u3> <@b2> <@u4>",
    mentions: {
      repliedUser: null,
      users: new Map([
        ["b1", { id: "b1", bot: true }],
        ["u3", { id: "u3", bot: false }],
        ["b2", { id: "b2", bot: true }],
        ["u4", { id: "u4", bot: false }],
      ]),
    },
  });
  expect(toRawMessage(message).mentionedUserIds).toEqual(["u3", "u4"]);
});

test("toRawMessage keeps the replied-to message but not a bot as its author", () => {
  // A member answering one of the bot's own cards, with the default ping.
  const message = fakeMessage({
    content: "nice card",
    mentions: {
      repliedUser: { id: "b1", bot: true },
      users: new Map([["b1", { id: "b1", bot: true }]]),
    },
  });
  expect(toRawMessage(message)).toMatchObject({
    replyToMessageId: "m0",
    repliedUserId: null,
    mentionedUserIds: [],
  });
});

test("a reply to a member is unchanged by the bot filter", () => {
  const message = fakeMessage({
    mentions: {
      repliedUser: { id: "u2", bot: false },
      users: new Map([
        ["u2", { id: "u2", bot: false }],
        ["b1", { id: "b1", bot: true }],
      ]),
    },
  });
  expect(toRawMessage(message)).toMatchObject({
    replyToMessageId: "m0",
    repliedUserId: "u2",
    mentionedUserIds: ["u2"],
  });
});

test("a reply to a bot that names the bot records no bot id at all", () => {
  const message = fakeMessage({
    content: "<@b1> thanks, and <@u3> look",
    mentions: {
      repliedUser: { id: "b1", bot: true },
      users: new Map([
        ["b1", { id: "b1", bot: true }],
        ["u3", { id: "u3", bot: false }],
      ]),
    },
  });
  const facts = extractMessageFacts(toRawMessage(message), "live");
  expect(facts).toMatchObject({ replyToUserId: null, replyToMessageId: "m0", mentionedUserIds: ["u3"] });
  expect(JSON.stringify(facts)).not.toContain("b1");
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
    mentionedUserIds: ["u3"],
    attachmentKinds: ["image", "other"],
    stickerCount: 1,
  });
});
