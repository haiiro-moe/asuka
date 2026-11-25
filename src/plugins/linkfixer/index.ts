import { Events, PermissionFlagsBits } from "discord.js";
import { getConfig } from "../../db/index.ts";
import { defineListener, type Plugin } from "../../core/plugin.ts";
import { fixUrl, extractUrls } from "./domains.ts";

const listener = defineListener({
  event: Events.MessageCreate,
  async handle(_ctx, message) {
    if (message.author.bot || !message.inGuild()) return;
    if (!getConfig().linkFixerEnabled) return;
    const content = message.content;
    if (!content) return;

    const disabled = new Set(getConfig().linkFixerDisabledPlatforms);
    const fixedUrls: string[] = [];
    for (const url of extractUrls(content)) {
      const fixed = fixUrl(url);
      if (fixed && !disabled.has(fixed.key)) fixedUrls.push(fixed.fixedUrl);
    }
    if (fixedUrls.length === 0) return;

    // Suppressing another member's embed requires Manage Messages in the channel.
    const canSuppress = message.guild.members.me
      ?.permissionsIn(message.channel)
      .has(PermissionFlagsBits.ManageMessages);
    if (!canSuppress) return;

    try {
      await message.suppressEmbeds(true);
      // Plain content, not Components V2: IsComponentsV2 disables Discord's
      // native URL auto-embed, which is the whole mechanism this relies on.
      await message.reply({
        content: fixedUrls.join("\n"),
        allowedMentions: { repliedUser: false, parse: [] },
      });
    } catch (err) {
      console.error("[linkfixer] failed:", err);
    }
  },
});

const plugin: Plugin = {
  name: "linkfixer",
  listeners: [listener],
};

export default plugin;
