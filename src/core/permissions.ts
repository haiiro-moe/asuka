import {
  PermissionFlagsBits,
  type GuildMember,
  type ChatInputCommandInteraction,
} from "discord.js";
import type { GuildConfig } from "../db/index.ts";
import type { Command } from "./plugin.ts";

/** True if the member holds the given Discord permission bit. */
export function hasPermission(member: GuildMember, bit: bigint): boolean {
  return member.permissions.has(bit);
}

/**
 * True if the member has the role identified by `roleId`, or any role ranked
 * at least as high as it (Discord role position). Admins always pass.
 */
export function hasRoleOrHigher(member: GuildMember, roleId: string | null): boolean {
  if (member.permissions.has(PermissionFlagsBits.Administrator)) return true;
  if (!roleId) return false;
  const target = member.guild.roles.cache.get(roleId);
  if (!target) return false;
  return member.roles.highest.comparePositionTo(target) >= 0;
}

/** True if the member currently holds the configured president role. */
export function isPresident(member: GuildMember, config: GuildConfig): boolean {
  return config.presidentRoleId
    ? member.roles.cache.has(config.presidentRoleId)
    : false;
}

/** True if the member is a server admin (Administrator or Manage Guild). */
export function isAdmin(member: GuildMember): boolean {
  return (
    member.permissions.has(PermissionFlagsBits.Administrator) ||
    member.permissions.has(PermissionFlagsBits.ManageGuild)
  );
}

/** Dashboard access tiers, lowest to highest. */
export type WebRole = "user" | "president" | "admin";

export const WEB_ROLE_RANK: Record<WebRole, number> = {
  user: 0,
  president: 1,
  admin: 2,
};

/** Web UI access role. Every guild member gets at least the "user" tier. */
export function resolveWebRole(member: GuildMember, config: GuildConfig): WebRole {
  if (isAdmin(member)) return "admin";
  if (isPresident(member, config)) return "president";
  return "user";
}

/**
 * Runtime authorization check for a slash command. Returns null when allowed,
 * or a user-facing denial message when not.
 */
export function checkCommandAccess(
  command: Command,
  interaction: ChatInputCommandInteraction,
  config: GuildConfig,
): string | null {
  const member = interaction.member as GuildMember | null;
  if (!member || !("permissions" in member)) {
    return "this command only works inside the server.";
  }

  if (
    command.requiredPermission !== undefined &&
    !hasPermission(member, command.requiredPermission)
  ) {
    return "you don't have permission to use this command.";
  }

  if (command.requiredRoleConfigKey) {
    const roleId = config[command.requiredRoleConfigKey] as string | null;
    if (!hasRoleOrHigher(member, roleId)) {
      return "you don't have the role this command needs.";
    }
  }

  return null;
}
