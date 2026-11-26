/**
 * Message facts: what activity analytics keeps of a message.
 *
 * A message is reduced in two steps. {@link toRawMessage} copies the fields
 * that matter out of a discord.js message into a plain {@link RawMessage}, and
 * {@link extractMessageFacts} turns that into {@link MessageFacts}, or into
 * null when the message must not be recorded. Live capture and the history
 * backfill both go through these two functions, so they agree on every rule.
 *
 * The text is read here and goes no further: the facts hold its length, the
 * emoji in it and the domains it links to, never the text itself (see
 * docs/activity/foundation.md).
 */
import { MessageType } from "discord.js";
import type { Message } from "discord.js";
import { parseEmoji } from "./emoji.ts";
import type { ParsedEmoji } from "./emoji.ts";
import { isExcluded } from "./exclusion.ts";

/**
 * The fields of a Discord message that facts are derived from, as plain data.
 *
 * It exists so that {@link extractMessageFacts} can be called, and tested,
 * without a discord.js object. Build one with {@link toRawMessage}.
 */
export interface RawMessage {
  /** The message id. */
  id: string;
  /** The author's id, and whether the author is a bot. */
  author: { id: string; bot: boolean };
  /** Id of the webhook that sent the message; null for a message a member sent. */
  webhookId: string | null;
  /** True for a system message (a join notice, a pin notice, a boost). */
  system: boolean;
  /** The guild the message was sent in; null for a DM. */
  guildId: string | null;
  /** The channel, or the thread, the message was sent in. */
  channelId: string;
  /** The parent channel when `channelId` is a thread; null otherwise. */
  parentChannelId: string | null;
  /** When the message was sent, in unix **milliseconds** (as discord.js gives it). */
  createdTimestamp: number;
  /** The message text. Read to derive facts, never stored. */
  content: string;
  /** The message this one replies to; null when it is not a reply. */
  replyToMessageId: string | null;
  /** Author of the message replied to; null when it is not a reply or the author is unknown. */
  repliedUserId: string | null;
  /**
   * Ids of the users mentioned, as Discord reports them. A reply that pings
   * lists its target here too; `extractMessageFacts` takes that one out again.
   */
  mentionedUserIds: string[];
  /** MIME type of each attachment; null where Discord gave none. */
  attachmentTypes: (string | null)[];
  /** How many stickers the message carries. */
  stickerCount: number;
}

/** What an attachment is, judged by its MIME type. */
export type AttachmentKind = "image" | "video" | "audio" | "other";

/**
 * Everything that is recorded about one message. `recordMessage` writes it to
 * `activity_messages`, `activity_mentions` and `activity_emoji`.
 */
export interface MessageFacts {
  /** The message id. Unique in `activity_messages`. */
  messageId: string;
  /** The author's id. */
  userId: string;
  /** The channel, or the thread, the message was sent in. */
  channelId: string;
  /** The parent channel when `channelId` is a thread; null otherwise. */
  parentChannelId: string | null;
  /** When the message was sent, in unix seconds. */
  ts: number;
  /** Author of the message replied to; null when it is not a reply or the author is unknown. */
  replyToUserId: string | null;
  /** The message replied to; null when it is not a reply. */
  replyToMessageId: string | null;
  /**
   * The users mentioned: each id once, the author's own id left out. The reply
   * target is listed only when the text names them (`<@id>`); the ping a reply
   * sends by itself is not a mention, `replyToUserId` carries the reply.
   */
  mentionedUserIds: string[];
  /** One entry per attachment, in order. */
  attachmentKinds: AttachmentKind[];
  /** The domains linked in the text: lowercase, each once, in order of first appearance. */
  linkDomains: string[];
  /** How many stickers the message carries. */
  stickerCount: number;
  /** Length of the text in characters (code points, so an emoji counts once). */
  length: number;
  /** The emoji used in the text, one entry per distinct emoji. */
  emoji: ParsedEmoji[];
  /** Which path produced the facts: the gateway listener or the history backfill. */
  source: "live" | "backfill";
}

/**
 * One `http://` or `https://` link per match. A link ends at whitespace, at a
 * quote or backtick, or at a bracket, so the `)` of a markdown link and the `>`
 * of `<https://...>` are left out. The host is taken from the match by `URL`.
 */
const LINK = /https?:\/\/[^\s<>()[\]"'`]+/gi;

/** Trailing dots of a hostname: `example.com.` is the same host as `example.com`. */
const TRAILING_DOTS = /\.+$/;

/**
 * The domains a text links to.
 *
 * @param text - The raw message content.
 * @returns Lowercase hostnames (no port, no credentials), each once, in order
 *   of first appearance. A link `URL` cannot parse is skipped.
 */
function linkDomains(text: string): string[] {
  const domains = new Set<string>();
  for (const match of text.matchAll(LINK)) {
    let hostname: string;
    try {
      hostname = new URL(match[0]).hostname;
    } catch {
      continue;
    }
    const domain = hostname.toLowerCase().replace(TRAILING_DOTS, "");
    if (domain !== "") domains.add(domain);
  }
  return [...domains];
}

/**
 * Classify an attachment by its MIME type.
 *
 * @param contentType - The attachment's MIME type, or null when unknown.
 * @returns `image`, `video` or `audio` by the type's first part; `other` for
 *   everything else, an unknown type included.
 */
function attachmentKind(contentType: string | null): AttachmentKind {
  const type = contentType?.toLowerCase() ?? "";
  if (type.startsWith("image/")) return "image";
  if (type.startsWith("video/")) return "video";
  if (type.startsWith("audio/")) return "audio";
  return "other";
}

/**
 * Whether a text holds a mention token for a user.
 *
 * @param text - The raw message content.
 * @param userId - The user to look for.
 * @returns True when the text contains `<@id>` or its older nickname form `<@!id>`.
 */
function namesUser(text: string, userId: string): boolean {
  return text.includes(`<@${userId}>`) || text.includes(`<@!${userId}>`);
}

/**
 * Derive the recordable facts from a message.
 *
 * A reply pings its target unless the author turns that off, and Discord then
 * lists the target among the mentioned users. That ping is not counted as a
 * mention: the target stays in `replyToUserId` and is left out of
 * `mentionedUserIds`, unless the text itself names them with `<@id>`. Otherwise
 * nearly every reply would also be a mention, and the two could not be told
 * apart.
 *
 * The excluded-channel list is read from the guild config on each call, so call
 * this only after `initDb()` has run (inside a handler, never at module top
 * level).
 *
 * @param m - The message as plain data.
 * @param source - Which path is recording it: `live` capture or the `backfill`.
 * @returns The facts, or null when the message is not recorded: the author is
 *   a bot, a webhook sent it, it is a system message, it is a DM, or its
 *   channel (or the parent channel of its thread) is excluded.
 *
 * @example
 * ```ts
 * const facts = extractMessageFacts(toRawMessage(message), "live");
 * if (facts) recordMessage(facts);
 * ```
 */
export function extractMessageFacts(m: RawMessage, source: "live" | "backfill"): MessageFacts | null {
  if (m.author.bot || m.webhookId !== null || m.system || m.guildId === null) return null;
  if (isExcluded(m.channelId, m.parentChannelId)) return null;

  const mentioned = new Set(m.mentionedUserIds);
  // Mentioning yourself is not an edge to anyone.
  mentioned.delete(m.author.id);
  // The ping of a reply is the reply itself, not a mention.
  if (m.repliedUserId !== null && !namesUser(m.content, m.repliedUserId)) {
    mentioned.delete(m.repliedUserId);
  }

  return {
    messageId: m.id,
    userId: m.author.id,
    channelId: m.channelId,
    parentChannelId: m.parentChannelId,
    ts: Math.floor(m.createdTimestamp / 1000),
    replyToUserId: m.repliedUserId,
    replyToMessageId: m.replyToMessageId,
    mentionedUserIds: [...mentioned],
    attachmentKinds: m.attachmentTypes.map(attachmentKind),
    linkDomains: linkDomains(m.content),
    stickerCount: m.stickerCount,
    length: Array.from(m.content).length,
    emoji: parseEmoji(m.content),
    source,
  };
}

/**
 * Copy the fields facts are derived from out of a discord.js message.
 *
 * Only a message of type `Reply` counts as a reply. A forward, a crosspost and
 * a thread's starter message also carry a reference, but they answer nobody.
 *
 * The parent channel is read from the cached channel. If the channel is not in
 * the cache, `parentChannelId` is null, as for a message outside a thread.
 *
 * @param m - A full (not partial) discord.js message.
 * @returns The message as plain data, ready for {@link extractMessageFacts}.
 */
export function toRawMessage(m: Message): RawMessage {
  // Typed as always present, but resolved from the cache and null when it is not there.
  const channel = m.channel as Message["channel"] | null;
  const isReply = m.type === MessageType.Reply;

  return {
    id: m.id,
    author: { id: m.author.id, bot: m.author.bot },
    webhookId: m.webhookId ?? null,
    system: m.system === true,
    guildId: m.guildId ?? null,
    channelId: m.channelId,
    parentChannelId: channel?.isThread() ? (channel.parentId ?? null) : null,
    createdTimestamp: m.createdTimestamp,
    content: m.content ?? "",
    replyToMessageId: isReply ? (m.reference?.messageId ?? null) : null,
    repliedUserId: isReply ? (m.mentions.repliedUser?.id ?? null) : null,
    mentionedUserIds: [...m.mentions.users.keys()],
    attachmentTypes: [...m.attachments.values()].map((attachment) => attachment.contentType ?? null),
    stickerCount: m.stickers.size,
  };
}
