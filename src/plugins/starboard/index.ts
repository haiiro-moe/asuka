import {
  Events,
  ButtonStyle,
  MediaGalleryBuilder,
  MediaGalleryItemBuilder,
  type Client,
  type Message,
  type MessageReaction,
  type PartialMessageReaction,
  type TextChannel,
} from "discord.js";
import { eq } from "drizzle-orm";
import { db, schema, getConfig } from "../../db/index.ts";
import {
  v2,
  Accent,
  ContainerBuilder,
  TextDisplayBuilder,
  ActionRowBuilder,
  ButtonBuilder,
} from "../../core/components.ts";
import { awardStarboardCredits } from "../economy/index.ts";
import { defineListener, type Plugin } from "../../core/plugin.ts";

/** Does this reaction's emoji match the configured starboard emoji? */
function isStarEmoji(reaction: MessageReaction | PartialMessageReaction): boolean {
  const configured = getConfig().starboardEmoji;
  const e = reaction.emoji;
  return e.name === configured || e.id === configured || e.toString() === configured;
}

/** Build the Components V2 starboard post for a source message. */
function buildPost(message: Message, count: number) {
  const cfg = getConfig();
  const container = new ContainerBuilder().setAccentColor(Accent.star);
  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(`## ${cfg.starboardEmoji} ${count}`),
    new TextDisplayBuilder().setContent(
      `<@${message.author.id}> in <#${message.channelId}>`,
    ),
  );
  if (message.content) {
    container.addTextDisplayComponents(
      new TextDisplayBuilder().setContent(message.content.slice(0, 1000)),
    );
  }

  // Mirror the original message's images and videos via a media gallery.
  const media = [...message.attachments.values()]
    .filter(
      (a) =>
        a.contentType?.startsWith("image/") || a.contentType?.startsWith("video/"),
    )
    .slice(0, 10);
  if (media.length) {
    container.addMediaGalleryComponents(
      new MediaGalleryBuilder().addItems(
        media.map((a) => new MediaGalleryItemBuilder().setURL(a.url)),
      ),
    );
  }

  container.addActionRowComponents(
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setStyle(ButtonStyle.Link)
        .setLabel("jump to message")
        .setURL(message.url),
    ),
  );
  return v2(container);
}

async function getStarboardChannel(client: Client): Promise<TextChannel | null> {
  const id = getConfig().starboardChannelId;
  if (!id) return null;
  const channel = await client.channels.fetch(id).catch(() => null);
  return channel?.isTextBased() && "send" in channel ? (channel as TextChannel) : null;
}

async function syncReaction(
  client: Client,
  reaction: MessageReaction | PartialMessageReaction,
) {
  const cfg = getConfig();
  if (!cfg.starboardEnabled || !cfg.starboardChannelId) return;
  if (reaction.partial) reaction = await reaction.fetch().catch(() => reaction);
  if (!isStarEmoji(reaction)) return;

  const message = reaction.message.partial
    ? await reaction.message.fetch().catch(() => null)
    : (reaction.message as Message);
  if (!message || !message.inGuild()) return;
  if (message.author?.bot) return;
  if (message.channelId === cfg.starboardChannelId) return;

  const count = reaction.count ?? 0;
  const board = await getStarboardChannel(client);
  if (!board) return;

  const existing = db
    .select()
    .from(schema.starboardPosts)
    .where(eq(schema.starboardPosts.sourceMessageId, message.id))
    .get();

  if (count >= cfg.starboardThreshold) {
    const payload = buildPost(message, count);
    if (existing?.starboardMessageId) {
      const post = await board.messages
        .fetch(existing.starboardMessageId)
        .catch(() => null);
      if (post) await post.edit(payload).catch(() => {});
      db.update(schema.starboardPosts)
        .set({ count })
        .where(eq(schema.starboardPosts.sourceMessageId, message.id))
        .run();
    } else {
      const sent = await board.send(payload);
      const firstTime = !existing?.rewarded;
      db.insert(schema.starboardPosts)
        .values({
          sourceMessageId: message.id,
          sourceChannelId: message.channelId,
          authorId: message.author.id,
          starboardMessageId: sent.id,
          count,
          rewarded: 1,
        })
        .onConflictDoUpdate({
          target: schema.starboardPosts.sourceMessageId,
          set: { starboardMessageId: sent.id, count, rewarded: 1 },
        })
        .run();
      if (firstTime) awardStarboardCredits(message.author.id);
    }
  } else if (existing?.starboardMessageId) {
    // Dropped below threshold: remove the starboard post but keep the row so the
    // author isn't rewarded twice if it climbs back up.
    const post = await board.messages
      .fetch(existing.starboardMessageId)
      .catch(() => null);
    if (post) await post.delete().catch(() => {});
    db.update(schema.starboardPosts)
      .set({ starboardMessageId: null, count })
      .where(eq(schema.starboardPosts.sourceMessageId, message.id))
      .run();
  }
}

const onAdd = defineListener({
  event: Events.MessageReactionAdd,
  handle: (ctx, reaction) => syncReaction(ctx.client, reaction),
});

const onRemove = defineListener({
  event: Events.MessageReactionRemove,
  handle: (ctx, reaction) => syncReaction(ctx.client, reaction),
});

const plugin: Plugin = {
  name: "starboard",
  listeners: [onAdd, onRemove],
};

export default plugin;
