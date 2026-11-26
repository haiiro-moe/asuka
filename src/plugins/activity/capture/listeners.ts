/**
 * Gateway handlers of live capture.
 *
 * Each handler turns one gateway event into rows through the write API in
 * `record.ts`. They share three rules:
 *
 * - **Gated.** Nothing is recorded while `guild_config.activityEnabled` is 0.
 *   The config is read inside the handler, never at module top level.
 * - **Never throws.** Every handler catches its own errors and logs them with
 *   an `[activity]` prefix, so a capture failure cannot reach the gateway or
 *   the other listeners of the event.
 * - **No bots, no other guilds.** A bot is never recorded, as an actor or as
 *   the author of a reacted-to message, and events from a guild other than the
 *   locked one are ignored.
 *
 * The handlers take plain arguments so tests can call them with fakes;
 * `index.ts` binds them to their events. See docs/activity/capture.md.
 */
import type {
  GuildMember,
  Message,
  MessageReaction,
  PartialGuildMember,
  PartialMessage,
  PartialMessageReaction,
  PartialUser,
  User,
  VoiceState,
} from "discord.js";
import type { BotContext } from "../../../core/plugin.ts";
import { nowSec } from "../../../core/util.ts";
import { getConfig } from "../../../db/index.ts";
import { isExcluded } from "../exclusion.ts";
import { extractMessageFacts, toRawMessage } from "../facts.ts";
import {
  closeDanglingVoiceSegments,
  openVoiceSegment,
  recordMembership,
  recordMessage,
  recordReactionAdd,
  recordReactionRemove,
} from "../record.ts";
import { applyVoice, snapshotOf } from "./voice.ts";

/** U+FE0F, dropped from reaction emoji the same way `parseEmoji` drops it. */
const VARIATION_SELECTOR = /️/g;

/**
 * Run a handler's work, logging instead of throwing.
 *
 * @param what - Names the handler in the log line.
 * @param work - The work; skipped while activity is disabled.
 */
async function guarded(what: string, work: () => Promise<void> | void): Promise<void> {
  try {
    if (!getConfig().activityEnabled) return;
    await work();
  } catch (err) {
    console.error(`[activity] ${what} capture failed:`, err);
  }
}

/**
 * Whether a user must be left out as a bot.
 *
 * @param user - The user, possibly partial or missing.
 * @returns True for a bot, and for a user whose bot flag is unknown (missing or
 *   partial): an id that might be a bot's is never stored.
 */
function botOrUnknown(user: User | PartialUser | null | undefined): boolean {
  return user?.bot !== false;
}

/**
 * The key a reaction's emoji is stored under, built the way `parseEmoji` keys
 * emoji in message text, so text use and reaction use of one emoji add up.
 *
 * @param emoji - The reaction's emoji.
 * @returns `custom:<id>` with the name for a custom emoji, the unicode emoji
 *   without U+FE0F and a null name otherwise; null when Discord gave neither
 *   an id nor a name.
 */
export function reactionEmojiKey(emoji: { id: string | null; name: string | null }): {
  emoji: string;
  name: string | null;
} | null {
  if (emoji.id) return { emoji: `custom:${emoji.id}`, name: emoji.name ?? null };
  if (!emoji.name) return null;
  return { emoji: emoji.name.replace(VARIATION_SELECTOR, ""), name: null };
}

/**
 * The parent channel of the channel a message is in.
 *
 * @param message - The message, possibly partial.
 * @returns The parent's id when the message is in a thread that is cached;
 *   null otherwise.
 */
function parentOf(message: Message | PartialMessage): string | null {
  // Typed as always present, but resolved from the cache and null when it is not there.
  const channel = message.channel as Message["channel"] | null;
  return channel?.isThread() ? (channel.parentId ?? null) : null;
}

/**
 * `MessageCreate`: record a message's facts.
 *
 * Bots, webhooks, system messages, DMs and excluded channels write nothing
 * (`extractMessageFacts` returns null for them). A message seen twice is
 * written once.
 *
 * @param ctx - The bot context; only `guildId` is read.
 * @param message - The new message.
 */
export async function onMessageCreate(ctx: BotContext, message: Message): Promise<void> {
  await guarded("message", () => {
    if (message.author?.bot) return;
    if (message.guildId !== ctx.guildId) return;
    const facts = extractMessageFacts(toRawMessage(message), "live");
    if (facts) recordMessage(facts);
  });
}

/**
 * `MessageReactionAdd`: record a reaction.
 *
 * A partial reaction, its message and a partial user are fetched first; when a
 * fetch fails the handler goes on with what it has. The reaction is skipped
 * when the member who reacted is a bot (or unknown), in a DM, in another guild,
 * or in an excluded channel or a thread under one. The message author is
 * stored as null when it is a bot or could not be read.
 *
 * @param ctx - The bot context; only `guildId` is read.
 * @param reaction - The reaction, possibly partial.
 * @param user - The member who reacted, possibly partial.
 */
export async function onReactionAdd(
  ctx: BotContext,
  reaction: MessageReaction | PartialMessageReaction,
  user: User | PartialUser,
): Promise<void> {
  await guarded("reaction add", async () => {
    if (user.partial) user = await user.fetch().catch(() => user);
    if (botOrUnknown(user)) return;

    if (reaction.partial) reaction = await reaction.fetch().catch(() => reaction);
    let message = reaction.message;
    if (message.partial) message = await message.fetch().catch(() => message);

    if (message.guildId !== ctx.guildId) return;
    const key = reactionEmojiKey(reaction.emoji);
    if (!key) return;

    const channelId = message.channelId;
    const parentChannelId = parentOf(message);
    if (isExcluded(channelId, parentChannelId)) return;

    const author = message.author;
    recordReactionAdd({
      messageId: message.id,
      userId: user.id,
      emoji: key.emoji,
      name: key.name,
      channelId,
      parentChannelId,
      messageAuthorId: author && !botOrUnknown(author) ? author.id : null,
      ts: nowSec(),
    });
  });
}

/**
 * `MessageReactionRemove`: mark a recorded reaction as removed.
 *
 * Nothing is fetched: the event carries the message id and the emoji. A
 * reaction that was never recorded (a bot's, one in an excluded channel, one
 * added before capture started) is left alone by the write API.
 *
 * @param _ctx - The bot context (unused).
 * @param reaction - The reaction, possibly partial.
 * @param user - The member whose reaction was removed, possibly partial.
 */
export async function onReactionRemove(
  _ctx: BotContext,
  reaction: MessageReaction | PartialMessageReaction,
  user: User | PartialUser,
): Promise<void> {
  await guarded("reaction remove", () => {
    if (user.bot === true) return;
    const key = reactionEmojiKey(reaction.emoji);
    if (!key) return;
    recordReactionRemove(reaction.message.id, user.id, key.emoji, nowSec());
  });
}

/**
 * `GuildMemberAdd`: record a join. Bots are skipped.
 *
 * @param ctx - The bot context; only `guildId` is read.
 * @param member - The member who joined.
 */
export async function onMemberAdd(ctx: BotContext, member: GuildMember): Promise<void> {
  await guarded("member join", () => {
    if (member.guild.id !== ctx.guildId || botOrUnknown(member.user)) return;
    recordMembership(member.id, "join", nowSec());
  });
}

/**
 * `GuildMemberRemove`: record a leave (a kick or ban counts as a leave). Bots
 * are skipped.
 *
 * @param ctx - The bot context; only `guildId` is read.
 * @param member - The member who left, possibly partial.
 */
export async function onMemberRemove(ctx: BotContext, member: GuildMember | PartialGuildMember): Promise<void> {
  await guarded("member leave", () => {
    if (member.guild.id !== ctx.guildId || botOrUnknown(member.user)) return;
    recordMembership(member.id, "leave", nowSec());
  });
}

/**
 * `VoiceStateUpdate`: close and open the member's voice segments to match
 * their new state (see `planVoice`). Bots, and members whose bot flag is
 * unknown, are skipped.
 *
 * @param ctx - The bot context; only `guildId` is read.
 * @param _oldState - The previous state (unused: the open segment in the
 *   database is the previous state).
 * @param newState - The member's new state.
 */
export async function onVoiceStateUpdate(ctx: BotContext, _oldState: VoiceState, newState: VoiceState): Promise<void> {
  await guarded("voice", () => {
    if (newState.guild?.id !== ctx.guildId) return;
    if (botOrUnknown(newState.member?.user)) return;
    applyVoice(newState.id, snapshotOf(newState), nowSec());
  });
}

/** Where {@link onReady} finds the members connected to voice. */
export type VoiceStateSource = () => Iterable<VoiceState>;

/**
 * The voice states of the locked guild, from the client's cache.
 *
 * @param ctx - The bot context.
 * @returns A source over `guild.voiceStates.cache`; empty when the guild is not
 *   cached.
 */
export function cachedVoiceStates(ctx: BotContext): VoiceStateSource {
  return () => ctx.client.guilds.cache.get(ctx.guildId)?.voiceStates.cache.values() ?? [];
}

/**
 * `ClientReady`: resume voice capture after a (re)start.
 *
 * First every segment left open is closed at its own `lastSeenAt` (the last
 * heartbeat before the bot stopped), then a segment is opened for each member
 * who is connected now, so time spent offline is never counted and time spent
 * connected across a restart is.
 *
 * @param ctx - The bot context.
 * @param source - The connected members; the guild's voice-state cache by
 *   default. Tests pass fakes.
 */
export async function onReady(ctx: BotContext, source: VoiceStateSource = cachedVoiceStates(ctx)): Promise<void> {
  await guarded("voice resume", () => {
    const closed = closeDanglingVoiceSegments();
    if (closed > 0) console.log(`[activity] closed ${closed} voice segments left open by a restart`);

    const ts = nowSec();
    for (const state of source()) {
      try {
        if (botOrUnknown(state.member?.user)) continue;
        const snapshot = snapshotOf(state);
        if (snapshot) openVoiceSegment(state.id, snapshot, ts);
      } catch (err) {
        console.error(`[activity] voice resume failed for ${state.id}:`, err);
      }
    }
  });
}
