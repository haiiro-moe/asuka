import type { Client } from "discord.js";
import { registerCommands } from "./command-registry.ts";
import { registerSchedules } from "./scheduler.ts";
import type { ApiRoute, BotContext, Plugin } from "./plugin.ts";

/**
 * Wire a set of plugins into the running bot: register slash commands, bind
 * gateway listeners, schedule cron jobs, and collect web API routes.
 * Returns the aggregated API routes for the web server to mount.
 */
export function loadPlugins(
  plugins: Plugin[],
  client: Client,
  ctx: BotContext,
): ApiRoute[] {
  const apiRoutes: ApiRoute[] = [];

  for (const plugin of plugins) {
    if (plugin.commands?.length) registerCommands(plugin.commands);

    for (const listener of plugin.listeners ?? []) {
      const bound = (...args: unknown[]) =>
        // @ts-expect-error variadic event args are validated by the Listener type
        listener.handle(ctx, ...args);
      if (listener.once) client.once(listener.event, bound);
      else client.on(listener.event, bound);
    }

    if (plugin.schedules?.length) registerSchedules(plugin.schedules, ctx);
    if (plugin.api?.length) apiRoutes.push(...plugin.api);

    console.log(
      `[plugins] loaded "${plugin.name}" ` +
        `(${plugin.commands?.length ?? 0} cmds, ` +
        `${plugin.listeners?.length ?? 0} listeners, ` +
        `${plugin.schedules?.length ?? 0} jobs, ` +
        `${plugin.api?.length ?? 0} routes)`,
    );
  }

  return apiRoutes;
}
