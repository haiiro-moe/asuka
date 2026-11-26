/**
 * The Discord side of the history backfill: lists the channels and threads of
 * the locked guild and builds the page fetchers the runner reads them with.
 * Everything that touches discord.js objects lives here, so the runner itself
 * can be tested with plain fakes.
 */
import { ChannelType } from "discord.js";
import type { AnyThreadChannel, Collection, Message, TextChannel, NewsChannel, ForumChannel } from "discord.js";
import type { BotContext } from "../../../core/plugin.ts";
import { toRawMessage } from "../facts.ts";
import type { BackfillChannel, FetchPage, FetchReactionPage, ReactionMessage } from "./types.ts";

/** A channel whose messages can be read: a text or announcement channel, or a thread. */
type Readable = TextChannel | NewsChannel | AnyThreadChannel;

/** Discord returns the newest message first; sort anyway so the cursor is always the oldest id. */
function newestFirst(messages: Collection<string, Message>): Message[] {
  return [...messages.values()].sort((a, b) => {
    if (a.id.length !== b.id.length) return b.id.length - a.id.length;
    return a.id < b.id ? 1 : a.id > b.id ? -1 : 0;
  });
}

/** Fetch one page (up to 100) of a channel's history, newest first. */
async function fetchMessages(channel: Readable, before: string | null): Promise<Message[]> {
  const page = await channel.messages.fetch({ limit: 100, ...(before ? { before } : {}) });
  return newestFirst(page);
}

/**
 * Build the page fetcher of a channel: 100 messages per request, each mapped
 * through `toRawMessage`. For a thread the parent id is set from the thread
 * itself, so it never depends on the channel cache.
 *
 * @param channel - A text channel, announcement channel or thread.
 * @returns A function that reads the history from newest to oldest.
 */
export function messagePager(channel: Readable): FetchPage {
  const parentId = channel.isThread() ? (channel.parentId ?? null) : null;
  return async (before) => {
    const messages = await fetchMessages(channel, before);
    return messages.map((m) => ({ ...toRawMessage(m), parentChannelId: parentId }));
  };
}

/** The emoji key of a reaction: the unicode emoji without U+FE0F, or `custom:<id>`. */
function emojiKey(emoji: { id: string | null; name: string | null }): string {
  return emoji.id ? `custom:${emoji.id}` : (emoji.name ?? "").replaceAll("️", "");
}

/**
 * Build the page fetcher of the reaction pass: the same pages, as messages that
 * carry their reactions. Reactors are fetched lazily, 100 per request.
 *
 * @param channel - A text channel, announcement channel or thread.
 * @returns A function that reads the history from newest to oldest.
 */
export function reactionPager(channel: Readable): FetchReactionPage {
  return async (before) => {
    const messages = await fetchMessages(channel, before);
    return messages.map((m): ReactionMessage => ({
      id: m.id,
      authorId: m.author.id,
      authorBot: m.author.bot,
      createdTimestamp: m.createdTimestamp,
      reactions: [...m.reactions.cache.values()].map((r) => ({
        emoji: emojiKey(r.emoji),
        name: r.emoji.id ? r.emoji.name : null,
        users: async () => {
          const out: { id: string; bot: boolean }[] = [];
          let after: string | undefined;
          for (;;) {
            const batch = await r.users.fetch({ limit: 100, ...(after ? { after } : {}) });
            for (const u of batch.values()) out.push({ id: u.id, bot: u.bot });
            if (batch.size < 100) return out;
            after = batch.lastKey();
          }
        },
      })),
    }));
  };
}

/** Wrap a readable channel as a {@link BackfillChannel}. */
function toBackfillChannel(channel: Readable): BackfillChannel {
  return {
    id: channel.id,
    parentId: channel.isThread() ? (channel.parentId ?? null) : null,
    fetchPage: messagePager(channel),
    fetchReactionPage: reactionPager(channel),
  };
}

/** Collect every archived public thread of a channel, following Discord's paging. */
async function archivedThreads(channel: TextChannel | NewsChannel | ForumChannel): Promise<AnyThreadChannel[]> {
  const out: AnyThreadChannel[] = [];
  let before: AnyThreadChannel | undefined;
  for (;;) {
    const page = await channel.threads.fetchArchived({
      type: "public",
      limit: 100,
      ...(before ? { before } : {}),
    });
    out.push(...page.threads.values());
    const hasMore = "hasMore" in page && page.hasMore;
    if (!hasMore || page.threads.size === 0) return out;
    // Archived threads come newest first; continue from the oldest one's archive time.
    before = [...page.threads.values()].at(-1)!;
  }
}

/**
 * List what the backfill reads in the locked guild: its text and announcement
 * channels, plus the active and archived public threads of those and of its
 * forum channels (a forum has no messages of its own, only posts, which are
 * threads). Channels the bot cannot view are left out; a channel it loses
 * access to later fails with Discord code 50001 or 50013 and is marked done by
 * the runner.
 *
 * @param ctx - The bot context.
 * @returns One entry per readable channel or thread.
 */
export async function listBackfillChannels(ctx: BotContext): Promise<BackfillChannel[]> {
  const guild = await ctx.client.guilds.fetch(ctx.guildId);
  const channels = await guild.channels.fetch();

  const out: BackfillChannel[] = [];
  const seen = new Set<string>();
  const add = (c: Readable) => {
    if (seen.has(c.id)) return;
    if (!c.viewable) return;
    seen.add(c.id);
    out.push(toBackfillChannel(c));
  };

  const parents: (TextChannel | NewsChannel | ForumChannel)[] = [];
  for (const channel of channels.values()) {
    if (!channel) continue;
    if (channel.type === ChannelType.GuildText || channel.type === ChannelType.GuildAnnouncement) {
      add(channel);
      parents.push(channel);
    } else if (channel.type === ChannelType.GuildForum) {
      parents.push(channel);
    }
  }

  const active = await guild.channels.fetchActiveThreads();
  for (const thread of active.threads.values()) {
    if (thread.type !== ChannelType.PrivateThread) add(thread);
  }
  for (const parent of parents) {
    if (!parent.viewable) continue;
    try {
      for (const thread of await archivedThreads(parent)) add(thread);
    } catch (e) {
      console.error(`[activity] could not list archived threads of ${parent.id}`, e);
    }
  }
  return out;
}
