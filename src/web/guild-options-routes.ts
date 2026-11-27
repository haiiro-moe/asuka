import { ChannelType } from "discord.js";
import type { ApiRoute, BotContext } from "../core/plugin.ts";

/** Channel kinds the config pickers can offer. */
export type GuildOptionChannelKind =
  | "text"
  | "announcement"
  | "voice"
  | "stage"
  | "forum"
  | "category";

/** One channel as returned by `GET /api/guild-options`. */
export interface GuildOptionChannel {
  id: string;
  name: string;
  kind: GuildOptionChannelKind;
  /** Id of the parent category, or null when uncategorised or itself a category. */
  parentId: string | null;
  /** Name of the parent category, or null. */
  parentName: string | null;
  /** Discord position within the parent. */
  position: number;
}

/** One role as returned by `GET /api/guild-options`. */
export interface GuildOptionRole {
  id: string;
  name: string;
  /** Role colour as a 24-bit integer (0 = no colour). */
  colour: number;
  position: number;
  /** True for bot or integration managed roles. */
  managed: boolean;
}

/** Response body of `GET /api/guild-options`. */
export interface GuildOptions {
  channels: GuildOptionChannel[];
  roles: GuildOptionRole[];
}

/** The minimal channel shape the mapper reads (a subset of a discord.js guild channel). */
export interface ChannelLike {
  id: string;
  name: string;
  type: number;
  parentId?: string | null;
  rawPosition?: number;
  position?: number;
}

/** The minimal role shape the mapper reads (a subset of a discord.js role). */
export interface RoleLike {
  id: string;
  name: string;
  color?: number;
  position: number;
  managed?: boolean;
}

const KIND_BY_TYPE: Partial<Record<number, GuildOptionChannelKind>> = {
  [ChannelType.GuildText]: "text",
  [ChannelType.GuildAnnouncement]: "announcement",
  [ChannelType.GuildVoice]: "voice",
  [ChannelType.GuildStageVoice]: "stage",
  [ChannelType.GuildForum]: "forum",
  [ChannelType.GuildCategory]: "category",
};

/**
 * Map a guild's channels and roles to the picker option lists.
 *
 * Channels are ordered like Discord shows them: uncategorised channels first,
 * then each category followed by its children (by position, then id). Threads and
 * any other unsupported channel type are dropped, as is the `@everyone` role.
 * Roles are ordered highest position first; bot-managed roles are kept with
 * `managed: true`.
 *
 * @param channels Guild channels (any iterable; a discord.js cache values() works).
 * @param roles Guild roles.
 * @param guildId The guild id, used to identify `@everyone` (its role id equals it).
 * @returns The `{ channels, roles }` response body.
 */
export function mapGuildOptions(
  channels: Iterable<ChannelLike>,
  roles: Iterable<RoleLike>,
  guildId: string,
): GuildOptions {
  const all = [...channels];
  const categories = new Map<string, ChannelLike>();
  for (const c of all) if (c.type === ChannelType.GuildCategory) categories.set(c.id, c);
  const pos = (c: ChannelLike) => c.rawPosition ?? c.position ?? 0;

  const rows: { out: GuildOptionChannel; key: [number, number, number] }[] = [];
  for (const c of all) {
    const kind = KIND_BY_TYPE[c.type];
    if (!kind) continue;
    const parent = kind === "category" ? undefined : categories.get(c.parentId ?? "");
    const out: GuildOptionChannel = {
      id: c.id,
      name: c.name,
      kind,
      parentId: parent?.id ?? null,
      parentName: parent?.name ?? null,
      position: pos(c),
    };
    // Group by category position (-1 = uncategorised), category row first, then children.
    const key: [number, number, number] =
      kind === "category" ? [pos(c), 0, 0] : [parent ? pos(parent) : -1, 1, pos(c)];
    rows.push({ out, key });
  }
  rows.sort(
    (a, b) =>
      a.key[0] - b.key[0] ||
      a.key[1] - b.key[1] ||
      a.key[2] - b.key[2] ||
      a.out.id.localeCompare(b.out.id),
  );

  const outRoles = [...roles]
    .filter((r) => r.id !== guildId)
    .map((r) => ({
      id: r.id,
      name: r.name,
      colour: r.color ?? 0,
      position: r.position,
      managed: !!r.managed,
    }))
    .sort((a, b) => b.position - a.position || a.id.localeCompare(b.id));

  return { channels: rows.map((r) => r.out), roles: outRoles };
}

/** Channels and roles of the locked guild, for the config page pickers (admin). */
const guildOptionsRoute: ApiRoute = {
  method: "GET",
  path: "/api/guild-options",
  access: "admin",
  handle(_req, ctx: BotContext) {
    const guild = ctx.client.guilds.cache.get(ctx.guildId);
    if (!guild) return Response.json({ channels: [], roles: [] } satisfies GuildOptions);
    return Response.json(
      mapGuildOptions(guild.channels.cache.values(), guild.roles.cache.values(), ctx.guildId),
    );
  },
};

/** API routes for guild channel/role option lists. */
export const guildOptionsRoutes: ApiRoute[] = [guildOptionsRoute];
