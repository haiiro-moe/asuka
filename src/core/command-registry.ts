import {
  REST,
  Routes,
  MessageFlags,
  type Client,
  type Interaction,
} from "discord.js";
import { env } from "../config/env.ts";
import { getConfig } from "../db/index.ts";
import { checkCommandAccess } from "./permissions.ts";
import type { BotContext, Command } from "./plugin.ts";

const commands = new Map<string, Command>();

/** Register a plugin's commands into the global registry. */
export function registerCommands(list: Command[]) {
  for (const command of list) {
    const name = command.data.name;
    if (commands.has(name)) {
      throw new Error(`Duplicate command name: ${name}`);
    }
    // Mirror the required permission on the builder so Discord hides the command
    // from members who lack it (defense in depth alongside the runtime check).
    if (command.requiredPermission !== undefined) {
      command.data.setDefaultMemberPermissions(command.requiredPermission);
    }
    commands.set(name, command);
  }
}

/** Deploy all registered commands to the locked guild (instant registration). */
export async function deployCommands(client: Client) {
  const rest = new REST().setToken(env.DISCORD_TOKEN);
  const body = [...commands.values()].map((c) => c.data.toJSON());
  await rest.put(Routes.applicationGuildCommands(env.CLIENT_ID, env.GUILD_ID), {
    body,
  });
  console.log(`[commands] deployed ${body.length} guild commands`);
}

/** Route an incoming interaction to the right command handler. */
export async function handleInteraction(interaction: Interaction, ctx: BotContext) {
  if (interaction.isAutocomplete()) {
    const command = commands.get(interaction.commandName);
    if (command?.autocomplete) {
      try {
        await command.autocomplete(interaction, ctx);
      } catch (err) {
        console.error(`[commands] autocomplete "${interaction.commandName}":`, err);
      }
    }
    return;
  }

  if (!interaction.isChatInputCommand()) return;

  const command = commands.get(interaction.commandName);
  if (!command) return;

  const denial = checkCommandAccess(command, interaction, getConfig());
  if (denial) {
    await interaction.reply({ content: denial, flags: MessageFlags.Ephemeral });
    return;
  }

  try {
    await command.execute(interaction, ctx);
  } catch (err) {
    console.error(`[commands] "${interaction.commandName}" failed:`, err);
    const payload = {
      content: "something went wrong running that command.",
      flags: MessageFlags.Ephemeral as const,
    };
    if (interaction.replied || interaction.deferred) {
      await interaction.followUp(payload).catch(() => {});
    } else {
      await interaction.reply(payload).catch(() => {});
    }
  }
}
