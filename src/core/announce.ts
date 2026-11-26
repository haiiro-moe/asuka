import type { Client, TextChannel } from "discord.js";
import { getConfig } from "../db/index.ts";
import { v2, card, text, Accent, ContainerBuilder, pngAttachment } from "./components.ts";
import { renderBotMessage, messageCtx } from "./messages.ts";

/**
 * Post a Components V2 message to the configured announcement channel. Used for
 * presidential actions and any other server-wide announcement worth surfacing.
 * No-ops silently when the channel isn't configured.
 *
 * When `image` is set it renders as a banner above the lines and replaces the
 * markdown title (the banner is the title).
 *
 * Callers pass `title` and `lines` already in the haiiro voice (lowercase title,
 * no emoji); this helper adds no decoration of its own. `accent` should be an
 * {@link Accent} value and defaults to `Accent.primary` (pine).
 */
export async function announce(
  client: Client,
  opts: {
    accent?: number;
    title: string;
    lines: string[];
    image?: { buffer: Buffer; name: string };
  },
) {
  const id = getConfig().announcementChannelId;
  if (!id) return;
  const channel = await client.channels.fetch(id).catch(() => null);
  if (!channel?.isTextBased() || !("send" in channel)) return;

  let payload;
  if (opts.image) {
    const { file, gallery } = pngAttachment(opts.image.buffer, opts.image.name);
    const container = new ContainerBuilder()
      .setAccentColor(opts.accent ?? Accent.primary)
      .addMediaGalleryComponents(gallery);
    if (opts.lines.length) container.addTextDisplayComponents(text(opts.lines.join("\n")));
    payload = { ...v2(container), files: [file] };
  } else {
    payload = v2(
      card({ accent: opts.accent ?? Accent.primary, title: opts.title, lines: opts.lines }),
    );
  }
  await (channel as TextChannel)
    .send(payload)
    .catch((err) => console.error("[announce] failed:", err));
}

/**
 * announce() but with a registry-rendered (web-editable) message from the
 * bot-message catalog instead of a hardcoded card.
 */
export async function announceMessage(
  client: Client,
  key: string,
  params: Record<string, string | number>,
) {
  const id = getConfig().announcementChannelId;
  if (!id) return;
  const channel = await client.channels.fetch(id).catch(() => null);
  if (!channel?.isTextBased() || !("send" in channel)) return;
  const payload = await renderBotMessage(key, messageCtx(client), params);
  await (channel as TextChannel)
    .send(payload)
    .catch((err) => console.error("[announce] failed:", err));
}
