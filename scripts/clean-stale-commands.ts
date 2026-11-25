#!/usr/bin/env bun
/**
 * Delete stale slash commands left on Discord by previous versions of the
 * bot. src/plugins/index.ts is the source of truth: any command Discord has
 * that isn't in that list gets flagged. Dry-run by default.
 *
 * Usage:
 *   bun scripts/clean-stale-commands.ts             # list stale guild commands
 *   bun scripts/clean-stale-commands.ts --apply      # delete them
 *   bun scripts/clean-stale-commands.ts --global            # same, but for global commands
 *   bun scripts/clean-stale-commands.ts --global --apply
 */
import { REST, Routes } from "discord.js";
import { env } from "../src/config/env.ts";
import { plugins } from "../src/plugins/index.ts";

const apply = process.argv.includes("--apply");
const global = process.argv.includes("--global");

const current = new Set(plugins.flatMap((p) => p.commands ?? []).map((c) => c.data.name));

const rest = new REST().setToken(env.DISCORD_TOKEN);
const listRoute = global
  ? Routes.applicationCommands(env.CLIENT_ID)
  : Routes.applicationGuildCommands(env.CLIENT_ID, env.GUILD_ID);

const live = (await rest.get(listRoute)) as { id: string; name: string }[];
const stale = live.filter((c) => !current.has(c.name));

console.log(`Scope: ${global ? "global" : `guild ${env.GUILD_ID}`}`);
console.log(`On Discord: ${live.length}   In code: ${current.size}   Stale: ${stale.length}`);

if (stale.length === 0) {
  console.log("Nothing to clean — Discord matches the current command set.");
  process.exit(0);
}

console.log();
for (const c of stale) console.log(`  stale: ${c.name}  (${c.id})`);

if (!apply) {
  console.log();
  console.log(`Dry run — nothing deleted. Re-run with --apply to delete these ${stale.length}.`);
  process.exit(0);
}

console.log();
for (const c of stale) {
  const deleteRoute = global
    ? Routes.applicationCommand(env.CLIENT_ID, c.id)
    : Routes.applicationGuildCommand(env.CLIENT_ID, env.GUILD_ID, c.id);
  await rest.delete(deleteRoute);
  console.log(`  deleted: ${c.name}`);
}
console.log(`Deleted ${stale.length} stale command(s).`);
