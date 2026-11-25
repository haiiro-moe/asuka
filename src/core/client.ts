import { Client, GatewayIntentBits, Partials, type Guild } from "discord.js";
import { env } from "../config/env.ts";

/** Create the discord.js client with the intents every feature needs. */
export function createClient(): Client {
  return new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMembers,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent,
      GatewayIntentBits.GuildMessageReactions,
      GatewayIntentBits.GuildVoiceStates,
      GatewayIntentBits.GuildModeration,
    ],
    // Needed to receive reaction/message events on messages not in cache.
    partials: [
      Partials.Message,
      Partials.Channel,
      Partials.Reaction,
      Partials.GuildMember,
      Partials.User,
    ],
  });
}

/** Leave the given guild unless it is the one we are locked to. */
export async function enforceGuildLock(guild: Guild) {
  if (guild.id === env.GUILD_ID) return;
  console.warn(`[guild-lock] leaving unauthorized guild ${guild.name} (${guild.id})`);
  await guild.leave().catch((err) => {
    console.error(`[guild-lock] failed to leave ${guild.id}:`, err);
  });
}

/** Leave every guild except the locked one. Run once after the client is ready. */
export async function enforceGuildLockAll(client: Client) {
  for (const guild of client.guilds.cache.values()) {
    await enforceGuildLock(guild);
  }
}
