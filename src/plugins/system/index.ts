import { SlashCommandBuilder, MessageFlags } from "discord.js";
import { renderBotMessage } from "../../core/messages.ts";
import type { Plugin } from "../../core/plugin.ts";

const plugin: Plugin = {
  name: "system",
  commands: [
    {
      data: new SlashCommandBuilder()
        .setName("ping")
        .setDescription("Check that the bot is alive."),
      async execute(interaction, ctx) {
        const payload = await renderBotMessage("system.pong", ctx, {
          latency: Math.round(ctx.client.ws.ping),
        });
        await interaction.reply({
          ...payload,
          flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
        });
      },
    },
  ],
};

export default plugin;
