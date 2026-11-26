import { afterAll, beforeAll, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { Events, MessageType } from "discord.js";
import type { GuildMember, Message, MessageReaction, User, VoiceState } from "discord.js";
import { eq } from "drizzle-orm";
import type { BotContext } from "../../../core/plugin.ts";
import { db, getConfig, initDb, schema } from "../../../db/index.ts";
import { openVoiceSegment, touchVoiceSegments } from "../record.ts";
import { captureListeners, captureSchedules } from "./index.ts";
import {
  onMemberAdd,
  onMemberRemove,
  onMessageCreate,
  onReactionAdd,
  onReactionRemove,
  onReady,
  onVoiceStateUpdate,
  reactionEmojiKey,
} from "./listeners.ts";

/** Every table this file writes to. Emptied before each test. */
const touchedTables = [
  schema.activityMessages,
  schema.activityMentions,
  schema.activityEmoji,
  schema.activityReactions,
  schema.activityVoice,
  schema.activityMembership,
];

/** The locked guild of the fake context. */
const GUILD = "g1";

/** A context for the locked guild. The handlers only read `guildId`. */
const ctx = { guildId: GUILD, config: getConfig } as unknown as BotContext;

/** Set the two activity config columns on the singleton row. */
function setConfig(enabled: boolean, excluded = "") {
  db.update(schema.guildConfig)
    .set({ activityEnabled: enabled ? 1 : 0, activityExcludedChannelIds: excluded })
    .where(eq(schema.guildConfig.id, 1))
    .run();
}

beforeAll(() => {
  initDb();
});

beforeEach(() => {
  for (const table of touchedTables) db.delete(table).run();
  setConfig(true);
});

afterAll(() => {
  setConfig(true);
});

/** A fake user. */
function user(id: string, bot = false) {
  return { id, bot, partial: false } as unknown as User;
}

/** A fake channel; a thread when `parentId` is given. */
function channel(parentId: string | null = null) {
  return { isThread: () => parentId !== null, parentId };
}

/** A fake discord.js message with the fields `toRawMessage` reads. */
function message(over: Record<string, unknown> = {}): Message {
  return {
    id: "m1",
    type: MessageType.Default,
    author: user("u1"),
    webhookId: null,
    system: false,
    guildId: GUILD,
    channelId: "c1",
    channel: channel(),
    createdTimestamp: 1_800_000_000_000,
    content: "hello 😀",
    reference: null,
    mentions: { users: new Map(), repliedUser: null },
    attachments: new Map(),
    stickers: new Map(),
    partial: false,
    ...over,
  } as unknown as Message;
}

/** A fake reaction with `emoji` on `msg`. */
function reaction(msg: Message, emoji: { id: string | null; name: string | null } = { id: null, name: "👍" }) {
  return { partial: false, emoji, message: msg } as unknown as MessageReaction;
}

/** A fake guild member. */
function member(id: string, bot = false) {
  return { id, user: user(id, bot), guild: { id: GUILD } } as unknown as GuildMember;
}

/** A fake voice state of `u1`, connected to `c1` with every flag off. */
function voice(over: Record<string, unknown> = {}): VoiceState {
  return {
    id: "u1",
    guild: { id: GUILD },
    member: member((over.id as string | undefined) ?? "u1"),
    channelId: "c1",
    selfMute: false,
    serverMute: false,
    selfDeaf: false,
    serverDeaf: false,
    streaming: false,
    selfVideo: false,
    ...over,
  } as unknown as VoiceState;
}

const messages = () => db.select().from(schema.activityMessages).all();
const reactions = () => db.select().from(schema.activityReactions).all();
const segments = () => db.select().from(schema.activityVoice).all();

describe("reactionEmojiKey", () => {
  test("unicode emoji drop U+FE0F", () => {
    expect(reactionEmojiKey({ id: null, name: "❤️" })).toEqual({ emoji: "❤", name: null });
  });

  test("custom emoji use custom:<id> and keep the name", () => {
    expect(reactionEmojiKey({ id: "123", name: "pog" })).toEqual({ emoji: "custom:123", name: "pog" });
  });

  test("no name and no id gives null", () => {
    expect(reactionEmojiKey({ id: null, name: null })).toBeNull();
  });
});

describe("messages", () => {
  test("a normal message writes one row", async () => {
    await onMessageCreate(ctx, message());
    const rows = messages();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ messageId: "m1", userId: "u1", channelId: "c1", source: "live" });
    expect(db.select().from(schema.activityEmoji).all()).toHaveLength(1);
  });

  test("a bot message writes nothing", async () => {
    await onMessageCreate(ctx, message({ author: user("b1", true) }));
    expect(messages()).toHaveLength(0);
  });

  test("a DM writes nothing", async () => {
    await onMessageCreate(ctx, message({ guildId: null }));
    expect(messages()).toHaveLength(0);
  });

  test("another guild writes nothing", async () => {
    await onMessageCreate(ctx, message({ guildId: "g2" }));
    expect(messages()).toHaveLength(0);
  });

  test("nothing is written while activity is disabled", async () => {
    setConfig(false);
    await onMessageCreate(ctx, message());
    expect(messages()).toHaveLength(0);
  });

  test("a thread message keeps its parent channel", async () => {
    await onMessageCreate(ctx, message({ channelId: "t1", channel: channel("c1") }));
    expect(messages()[0]).toMatchObject({ channelId: "t1", parentChannelId: "c1" });
  });

  test("a failure is logged and never thrown", async () => {
    const error = spyOn(console, "error").mockImplementation(() => {});
    try {
      const broken = message({ mentions: null });
      await expect(onMessageCreate(ctx, broken)).resolves.toBeUndefined();
      expect(error).toHaveBeenCalled();
      expect(String(error.mock.calls[0]?.[0])).toStartWith("[activity]");
    } finally {
      error.mockRestore();
    }
  });
});

describe("reactions", () => {
  test("a reaction add then remove ends with removedAt set", async () => {
    const r = reaction(message());
    await onReactionAdd(ctx, r, user("u2"));
    expect(reactions()).toHaveLength(1);
    expect(reactions()[0]).toMatchObject({
      messageId: "m1",
      userId: "u2",
      emoji: "👍",
      channelId: "c1",
      messageAuthorId: "u1",
      removedAt: null,
    });

    await onReactionRemove(ctx, r, user("u2"));
    expect(reactions()).toHaveLength(1);
    expect(reactions()[0]!.removedAt).not.toBeNull();
  });

  test("a reaction by a bot writes nothing", async () => {
    await onReactionAdd(ctx, reaction(message()), user("b1", true));
    expect(reactions()).toHaveLength(0);
  });

  test("a reaction on a bot's message has no author", async () => {
    await onReactionAdd(ctx, reaction(message({ author: user("b1", true) })), user("u2"));
    expect(reactions()[0]!.messageAuthorId).toBeNull();
  });

  test("a reaction in a thread keeps its parent channel", async () => {
    await onReactionAdd(ctx, reaction(message({ channelId: "t1", channel: channel("c1") })), user("u2"));
    expect(reactions()[0]).toMatchObject({ channelId: "t1", parentChannelId: "c1" });
  });

  test("a reaction in a thread under an excluded channel writes nothing", async () => {
    setConfig(true, "c1");
    await onReactionAdd(ctx, reaction(message({ channelId: "t1", channel: channel("c1") })), user("u2"));
    expect(reactions()).toHaveLength(0);
  });

  test("a custom emoji is keyed custom:<id>", async () => {
    await onReactionAdd(ctx, reaction(message(), { id: "123", name: "pog" }), user("u2"));
    expect(reactions()[0]).toMatchObject({ emoji: "custom:123", name: "pog" });
  });

  test("partial reactions and messages are fetched first", async () => {
    const full = message();
    const partialMessage = { partial: true, fetch: async () => full } as unknown as Message;
    const partial = {
      partial: true,
      emoji: { id: null, name: "👍" },
      message: partialMessage,
      fetch: async () => ({ partial: false, emoji: { id: null, name: "👍" }, message: partialMessage }),
    } as unknown as MessageReaction;
    await onReactionAdd(ctx, partial, user("u2"));
    expect(reactions()[0]).toMatchObject({ messageId: "m1", messageAuthorId: "u1", channelId: "c1" });
  });

  test("nothing is written while activity is disabled", async () => {
    setConfig(false);
    await onReactionAdd(ctx, reaction(message()), user("u2"));
    expect(reactions()).toHaveLength(0);
  });
});

describe("membership", () => {
  test("a join and a leave write a row each", async () => {
    await onMemberAdd(ctx, member("u1"));
    await onMemberRemove(ctx, member("u1"));
    const rows = db.select().from(schema.activityMembership).all();
    expect(rows.map((r) => [r.userId, r.kind])).toEqual([
      ["u1", "join"],
      ["u1", "leave"],
    ]);
  });

  test("a bot joining writes nothing", async () => {
    await onMemberAdd(ctx, member("b1", true));
    expect(db.select().from(schema.activityMembership).all()).toHaveLength(0);
  });
});

describe("voice", () => {
  test("joining opens a segment and leaving closes it", async () => {
    await onVoiceStateUpdate(ctx, voice({ channelId: null }), voice());
    expect(segments()).toHaveLength(1);
    expect(segments()[0]).toMatchObject({ userId: "u1", channelId: "c1", endedAt: null });

    await onVoiceStateUpdate(ctx, voice(), voice({ channelId: null }));
    expect(segments()).toHaveLength(1);
    expect(segments()[0]!.endedAt).not.toBeNull();
  });

  test("a mute closes the segment and opens another", async () => {
    await onVoiceStateUpdate(ctx, voice({ channelId: null }), voice());
    await onVoiceStateUpdate(ctx, voice(), voice({ selfMute: true }));
    const rows = segments();
    expect(rows).toHaveLength(2);
    expect(rows[0]!.endedAt).not.toBeNull();
    expect(rows[1]).toMatchObject({ endedAt: null, muted: 1 });
  });

  test("an unchanged state opens nothing new", async () => {
    await onVoiceStateUpdate(ctx, voice({ channelId: null }), voice());
    await onVoiceStateUpdate(ctx, voice(), voice({ suppress: true }));
    expect(segments()).toHaveLength(1);
  });

  test("an excluded voice channel opens no segment", async () => {
    setConfig(true, "c1");
    await onVoiceStateUpdate(ctx, voice({ channelId: null }), voice());
    expect(segments()).toHaveLength(0);
  });

  test("a bot in voice writes nothing", async () => {
    await onVoiceStateUpdate(ctx, voice({ channelId: null }), voice({ id: "b1", member: member("b1", true) }));
    expect(segments()).toHaveLength(0);
  });

  test("a restart closes the open segment at lastSeenAt and reopens the connected members", async () => {
    const snap = { channelId: "c1", muted: false, deafened: false, streaming: false, video: false };
    openVoiceSegment("u1", snap, 1_000);
    touchVoiceSegments(1_060);

    await onReady(ctx, () => [voice(), voice({ id: "u2", channelId: "c2", selfVideo: true })]);

    const rows = segments();
    expect(rows).toHaveLength(3);
    expect(rows[0]).toMatchObject({ userId: "u1", startedAt: 1_000, endedAt: 1_060 });
    const open = rows.filter((r) => r.endedAt === null);
    expect(open.map((r) => [r.userId, r.channelId, r.video])).toEqual([
      ["u1", "c1", 0],
      ["u2", "c2", 1],
    ]);
    expect(open.every((r) => r.startedAt > 1_060)).toBe(true);
  });

  test("a restart skips bots and excluded channels", async () => {
    setConfig(true, "c2");
    await onReady(ctx, () => [voice({ id: "b1", member: member("b1", true) }), voice({ id: "u2", channelId: "c2" })]);
    expect(segments()).toHaveLength(0);
  });
});

describe("voice heartbeat", () => {
  const snap = { channelId: "c1", muted: false, deafened: false, streaming: false, video: false };

  test("stamps lastSeenAt on open segments", async () => {
    openVoiceSegment("u1", snap, 1_000);
    await captureSchedules[0]!.run(ctx);
    expect(captureSchedules[0]!.name).toBe("voice-activity-heartbeat");
    expect(segments()[0]!.lastSeenAt).toBeGreaterThan(1_000);
    expect(segments()[0]!.endedAt).toBeNull();
  });

  test("closes open segments at their last heartbeat while disabled", async () => {
    openVoiceSegment("u1", snap, 1_000);
    touchVoiceSegments(1_060);
    setConfig(false);
    await captureSchedules[0]!.run(ctx);
    expect(segments()[0]).toMatchObject({ endedAt: 1_060, lastSeenAt: 1_060 });
  });
});

describe("captureListeners", () => {
  test("binds the seven events", () => {
    expect(captureListeners.map((l): string => l.event).sort()).toEqual(
      [
        Events.ClientReady,
        Events.GuildMemberAdd,
        Events.GuildMemberRemove,
        Events.MessageCreate,
        Events.MessageReactionAdd,
        Events.MessageReactionRemove,
        Events.VoiceStateUpdate,
      ].sort(),
    );
  });
});
