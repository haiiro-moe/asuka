import { Events } from "discord.js";
import { env } from "./config/env.ts";
import { initDb, getConfig } from "./db/index.ts";
import { createClient, enforceGuildLock, enforceGuildLockAll } from "./core/client.ts";
import { deployCommands, handleInteraction } from "./core/command-registry.ts";
import { loadPlugins } from "./core/plugin-loader.ts";
import { stopSchedules } from "./core/scheduler.ts";
import type { BotContext } from "./core/plugin.ts";
import { startWebServer } from "./web/server.ts";
import { plugins } from "./plugins/index.ts";

console.log("[boot] applying database migrations…");
initDb();

const client = createClient();

const ctx: BotContext = {
  client,
  guildId: env.GUILD_ID,
  config: getConfig,
};

// Wire plugins: commands, listeners, schedules, and collect web API routes.
const apiRoutes = loadPlugins(plugins, client, ctx);

// Core gateway routing (kept out of plugins).
client.once(Events.ClientReady, async (c) => {
  console.log(`[boot] logged in as ${c.user.tag}`);
  await enforceGuildLockAll(c);
  await deployCommands(c);
  startWebServer(apiRoutes, ctx);
  console.log("[boot] ready");
});

client.on(Events.GuildCreate, (guild) => void enforceGuildLock(guild));
client.on(Events.InteractionCreate, (interaction) =>
  void handleInteraction(interaction, ctx),
);

client.on(Events.Error, (err) => console.error("[client] error:", err));

async function shutdown() {
  console.log("\n[boot] shutting down…");
  stopSchedules();
  await client.destroy();
  process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

await client.login(env.DISCORD_TOKEN);
