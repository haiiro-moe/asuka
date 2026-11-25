import type {
  Client,
  ClientEvents,
  ChatInputCommandInteraction,
  SlashCommandBuilder,
  SlashCommandSubcommandsOnlyBuilder,
  SlashCommandOptionsOnlyBuilder,
  AutocompleteInteraction,
} from "discord.js";
import type { GuildConfig } from "../db/index.ts";

/** Shared services handed to every command, listener, schedule, and API route. */
export interface BotContext {
  client: Client;
  /** Convenience accessor for the locked guild's id. */
  guildId: string;
  /** Fetch the latest singleton config row. */
  config: () => GuildConfig;
}

export type SlashBuilder =
  | SlashCommandBuilder
  | SlashCommandSubcommandsOnlyBuilder
  | SlashCommandOptionsOnlyBuilder;

/** A single slash command contributed by a plugin. */
export interface Command {
  data: SlashBuilder;
  /**
   * Required Discord permission bit (from PermissionFlagsBits). Enforced both
   * via setDefaultMemberPermissions on registration and at runtime.
   */
  requiredPermission?: bigint;
  /**
   * Config key naming a role; the member must have that role or higher.
   * Resolved against the live guild config at runtime.
   */
  requiredRoleConfigKey?: keyof GuildConfig;
  execute(interaction: ChatInputCommandInteraction, ctx: BotContext): Promise<unknown>;
  autocomplete?(
    interaction: AutocompleteInteraction,
    ctx: BotContext,
  ): Promise<unknown>;
}

/** A discord.js gateway event listener. */
export interface Listener<K extends keyof ClientEvents = keyof ClientEvents> {
  event: K;
  once?: boolean;
  handle(ctx: BotContext, ...args: ClientEvents[K]): Promise<void> | void;
}

/** A cron-scheduled job. */
export interface Schedule {
  name: string;
  /** Croner-compatible pattern, e.g. "*\/1 * * * *". */
  cron: string;
  run(ctx: BotContext): Promise<void> | void;
}

/** A JSON HTTP route contributed by a plugin to the web server. */
export interface ApiRoute {
  method: "GET" | "POST" | "PUT" | "DELETE" | "PATCH";
  /** Path beginning with /api, e.g. "/api/autoreplies". */
  path: string;
  /**
   * Minimum access role required to call this route ("user" = any signed-in
   * guild member; "president" also admits admins). "public" bypasses the
   * dashboard cookie session entirely — the handler is responsible for its
   * own auth (e.g. a one-time token parsed from `params`).
   */
  access: "admin" | "president" | "user" | "public";
  handle(req: Request, ctx: ApiContext): Promise<Response> | Response;
}

/** Extra context for API routes (params parsed from the path pattern). */
export interface ApiContext extends BotContext {
  params: Record<string, string>;
  /** Null for "public" routes, which have no dashboard cookie session. */
  session: { userId: string; role: "admin" | "president" | "user" } | null;
}

/** A plugin bundles related commands, listeners, schedules and API routes. */
export interface Plugin {
  name: string;
  commands?: Command[];
  listeners?: Listener[];
  schedules?: Schedule[];
  api?: ApiRoute[];
}

/** Helper for typed listener definitions with inference on event args. */
export function defineListener<K extends keyof ClientEvents>(
  listener: Listener<K>,
): Listener {
  return listener as unknown as Listener;
}
