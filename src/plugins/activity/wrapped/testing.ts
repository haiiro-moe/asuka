/**
 * Test helpers for the Wrapped tests: table reset, message facts, and a plain
 * fake Discord client that records DMs and channel posts. Imported by the
 * `*.test.ts` files only.
 *
 * @packageDocumentation
 */
import { eq } from "drizzle-orm";
import type { Client } from "discord.js";
import { db, getConfig, schema } from "../../../db/index.ts";
import type { BotContext } from "../../../core/plugin.ts";
import type { MessageFacts } from "../facts.ts";

/** Every table the Wrapped tests write to. */
const touchedTables = [
  schema.activityMessages,
  schema.activityMentions,
  schema.activityEmoji,
  schema.activityReactions,
  schema.activityVoice,
  schema.activityMembership,
  schema.activityWrappedRuns,
  schema.activityWrappedLinks,
  schema.activityWrappedOptins,
  schema.members,
  schema.botMessages,
];

/** Empty every touched table and reset the config columns the tests change. */
export function resetWrappedTables(): void {
  for (const table of touchedTables) db.delete(table).run();
  db.update(schema.guildConfig)
    .set({ activityExcludedChannelIds: "", modLogChannelId: null, announcementChannelId: null })
    .where(eq(schema.guildConfig.id, 1))
    .run();
}

/** Set config columns on the singleton row. */
export function setConfig(values: Partial<typeof schema.guildConfig.$inferInsert>): void {
  db.update(schema.guildConfig).set(values).where(eq(schema.guildConfig.id, 1)).run();
}

/** Unix seconds of an ISO time, e.g. `at("2026-03-02T14:00:00Z")`. */
export function at(iso: string): number {
  return Math.floor(Date.parse(iso) / 1000);
}

let messageSeq = 0;

/** Facts for a plain message by `userId` at `ts` in channel `c1`, with a fresh message id. */
export function msg(userId: string, ts: number, over: Partial<MessageFacts> = {}): MessageFacts {
  messageSeq += 1;
  return {
    messageId: `m${messageSeq}`,
    userId,
    channelId: "c1",
    parentChannelId: null,
    ts,
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

/** A Discord API error with a numeric code, shaped like discord.js's `DiscordAPIError`. */
export function discordError(code: number, message = "Cannot send messages to this user"): Error {
  return Object.assign(new Error(message), { code, status: 403 });
}

/** What the fake client saw. */
export interface FakeClientLog {
  /** DMs sent, in order: the recipient and the payload. */
  dms: { userId: string; payload: Record<string, unknown> }[];
  /** Channel posts, in order: the channel and the payload. */
  posts: { channelId: string; payload: Record<string, unknown> }[];
}

/**
 * A plain fake client. `users.fetch(id).send()` records a DM, or throws a 50007
 * error for the ids in `closedDms`. `channels.fetch(id).send()` records a post.
 *
 * @param opts.closedDms - Users whose DMs are closed.
 * @param opts.onDm - Called before each DM is recorded (to look at run status mid-run).
 */
export function fakeClient(
  opts: { closedDms?: string[]; onDm?: (userId: string) => void } = {},
): { client: Client; log: FakeClientLog } {
  const log: FakeClientLog = { dms: [], posts: [] };
  const closed = new Set(opts.closedDms ?? []);
  const client = {
    users: {
      cache: new Map(),
      async fetch(userId: string) {
        return {
          id: userId,
          displayName: `name-${userId}`,
          async send(payload: Record<string, unknown>) {
            opts.onDm?.(userId);
            if (closed.has(userId)) throw discordError(50007);
            log.dms.push({ userId, payload });
            return {};
          },
        };
      },
    },
    channels: {
      async fetch(channelId: string) {
        return {
          id: channelId,
          isTextBased: () => true,
          async send(payload: Record<string, unknown>) {
            log.posts.push({ channelId, payload });
            return {};
          },
        };
      },
    },
    guilds: { cache: new Map() },
  };
  return { client: client as unknown as Client, log };
}

/** A BotContext around a fake client. */
export function fakeCtx(client: Client): BotContext {
  return { client, guildId: "000000000000000002", config: getConfig };
}

/** Every string in a component tree, flattened. */
export function allStrings(node: unknown, out: string[] = []): string[] {
  if (typeof node === "string") out.push(node);
  else if (Array.isArray(node)) for (const n of node) allStrings(n, out);
  else if (node && typeof node === "object") {
    const json = typeof (node as { toJSON?: unknown }).toJSON === "function"
      ? (node as { toJSON: () => unknown }).toJSON()
      : node;
    if (json !== node) return allStrings(json, out);
    for (const v of Object.values(node)) allStrings(v, out);
  }
  return out;
}

/** Every button in a component tree (raw JSON or builders), flattened. */
export function allButtons(node: unknown, out: Record<string, unknown>[] = []): Record<string, unknown>[] {
  if (Array.isArray(node)) for (const n of node) allButtons(n, out);
  else if (node && typeof node === "object") {
    const json = typeof (node as { toJSON?: unknown }).toJSON === "function"
      ? (node as { toJSON: () => unknown }).toJSON()
      : node;
    if (json !== node) return allButtons(json, out);
    const obj = node as Record<string, unknown>;
    if (obj.type === 2) out.push(obj);
    for (const v of Object.values(obj)) allButtons(v, out);
  }
  return out;
}
