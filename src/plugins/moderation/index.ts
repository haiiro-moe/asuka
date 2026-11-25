import {
  SlashCommandBuilder,
  PermissionFlagsBits,
  MessageFlags,
  AutoModerationRuleTriggerType,
  AutoModerationRuleEventType,
  AutoModerationActionType,
  type Guild,
  type GuildMember,
  type ChatInputCommandInteraction,
} from "discord.js";
import { desc, eq } from "drizzle-orm";
import { db, schema } from "../../db/index.ts";
import { v2, card, Accent } from "../../core/components.ts";
import { renderBotMessage } from "../../core/messages.ts";
import { parseDuration, formatDuration } from "../../core/util.ts";
import { simulateActivity } from "../../core/members.ts";
import type { BotContext, Command, Plugin } from "../../core/plugin.ts";
import { recordModAction } from "./log.ts";
import { approvedClubs, findClubByName, bumpActivity, clubActivityScore } from "../clubs/service.ts";

const MAX_TIMEOUT_SEC = 28 * 86400;
const CENSOR_RULE_NAME = "Asuka Censor";

/** Reply with an ephemeral Components V2 confirmation card. */
function ack(
  interaction: ChatInputCommandInteraction,
  accent: number,
  title: string,
  lines: string[],
) {
  return interaction.reply({
    ...v2(card({ accent, title, lines })),
    flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
  });
}

/** Reply ephemerally with a registry-managed (web-editable) bot message. */
async function ackMessage(
  interaction: ChatInputCommandInteraction,
  ctx: BotContext,
  key: string,
  params: Record<string, string | number>,
) {
  const payload = await renderBotMessage(key, ctx, params);
  return interaction.reply({
    ...payload,
    flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
  });
}

const timeout: Command = {
  requiredPermission: PermissionFlagsBits.ModerateMembers,
  data: new SlashCommandBuilder()
    .setName("timeout")
    .setDescription("Temporarily mute a member.")
    .addUserOption((o) =>
      o.setName("member").setDescription("Member to time out").setRequired(true),
    )
    .addStringOption((o) =>
      o
        .setName("duration")
        .setDescription("Duration, e.g. 10m, 1h, 2d (max 28d)")
        .setRequired(true),
    )
    .addStringOption((o) => o.setName("reason").setDescription("Reason")),
  async execute(interaction, ctx) {
    const member = interaction.options.getMember("member") as GuildMember | null;
    const durationStr = interaction.options.getString("duration", true);
    const reason = interaction.options.getString("reason");
    if (!member) return ack(interaction, Accent.danger, "Failed", ["Member not found."]);

    const seconds = parseDuration(durationStr);
    if (!seconds || seconds < 1 || seconds > MAX_TIMEOUT_SEC) {
      return ack(interaction, Accent.danger, "Invalid duration", [
        "Use a value between 1 second and 28 days, e.g. `10m`, `1h`, `2d`.",
      ]);
    }

    await member.timeout(seconds * 1000, reason ?? undefined);
    await recordModAction({
      client: ctx.client,
      action: "timeout",
      userId: member.id,
      moderatorId: interaction.user.id,
      reason,
      metadata: { duration: formatDuration(seconds) },
    });
    return ackMessage(interaction, ctx, "moderation.timeout", {
      user: `<@${member.id}>`,
      duration: formatDuration(seconds),
    });
  },
};

const untimeout: Command = {
  requiredPermission: PermissionFlagsBits.ModerateMembers,
  data: new SlashCommandBuilder()
    .setName("untimeout")
    .setDescription("Remove a member's timeout.")
    .addUserOption((o) =>
      o.setName("member").setDescription("Member").setRequired(true),
    ),
  async execute(interaction, ctx) {
    const member = interaction.options.getMember("member") as GuildMember | null;
    if (!member) return ack(interaction, Accent.danger, "Failed", ["Member not found."]);
    await member.timeout(null);
    await recordModAction({
      client: ctx.client,
      action: "untimeout",
      userId: member.id,
      moderatorId: interaction.user.id,
    });
    return ackMessage(interaction, ctx, "moderation.untimeout", {
      user: `<@${member.id}>`,
    });
  },
};

const kick: Command = {
  requiredPermission: PermissionFlagsBits.KickMembers,
  data: new SlashCommandBuilder()
    .setName("kick")
    .setDescription("Kick a member from the server.")
    .addUserOption((o) =>
      o.setName("member").setDescription("Member").setRequired(true),
    )
    .addStringOption((o) => o.setName("reason").setDescription("Reason")),
  async execute(interaction, ctx) {
    const member = interaction.options.getMember("member") as GuildMember | null;
    const reason = interaction.options.getString("reason");
    if (!member) return ack(interaction, Accent.danger, "Failed", ["Member not found."]);
    await member.kick(reason ?? undefined);
    await recordModAction({
      client: ctx.client,
      action: "kick",
      userId: member.id,
      moderatorId: interaction.user.id,
      reason,
    });
    return ackMessage(interaction, ctx, "moderation.kick", {
      user: `<@${member.id}>`,
      reason: reason ?? "",
    });
  },
};

const ban: Command = {
  requiredPermission: PermissionFlagsBits.BanMembers,
  data: new SlashCommandBuilder()
    .setName("ban")
    .setDescription("Ban a member.")
    .addUserOption((o) => o.setName("user").setDescription("User").setRequired(true))
    .addStringOption((o) => o.setName("reason").setDescription("Reason"))
    .addIntegerOption((o) =>
      o
        .setName("delete_days")
        .setDescription("Days of their messages to delete (0-7)")
        .setMinValue(0)
        .setMaxValue(7),
    ),
  async execute(interaction, ctx) {
    const user = interaction.options.getUser("user", true);
    const reason = interaction.options.getString("reason");
    const deleteDays = interaction.options.getInteger("delete_days") ?? 0;
    await (interaction.guild as Guild).bans.create(user.id, {
      reason: reason ?? undefined,
      deleteMessageSeconds: deleteDays * 86400,
    });
    await recordModAction({
      client: ctx.client,
      action: "ban",
      userId: user.id,
      moderatorId: interaction.user.id,
      reason,
    });
    return ackMessage(interaction, ctx, "moderation.ban", {
      user: `<@${user.id}>`,
      reason: reason ?? "",
    });
  },
};

const unban: Command = {
  requiredPermission: PermissionFlagsBits.BanMembers,
  data: new SlashCommandBuilder()
    .setName("unban")
    .setDescription("Lift a ban by user id.")
    .addStringOption((o) =>
      o.setName("user_id").setDescription("User id").setRequired(true),
    )
    .addStringOption((o) => o.setName("reason").setDescription("Reason")),
  async execute(interaction, ctx) {
    const userId = interaction.options.getString("user_id", true);
    const reason = interaction.options.getString("reason");
    const removed = await (interaction.guild as Guild).bans
      .remove(userId, reason ?? undefined)
      .catch(() => null);
    if (!removed) {
      return ack(interaction, Accent.danger, "Failed", ["No ban found for that id."]);
    }
    await recordModAction({
      client: ctx.client,
      action: "unban",
      userId,
      moderatorId: interaction.user.id,
      reason,
    });
    return ackMessage(interaction, ctx, "moderation.unban", {
      user: `<@${userId}>`,
      reason: reason ?? "",
    });
  },
};

const warn: Command = {
  requiredPermission: PermissionFlagsBits.ModerateMembers,
  data: new SlashCommandBuilder()
    .setName("warn")
    .setDescription("Issue a warning to a member.")
    .addUserOption((o) =>
      o.setName("member").setDescription("Member").setRequired(true),
    )
    .addStringOption((o) =>
      o.setName("reason").setDescription("Reason").setRequired(true),
    ),
  async execute(interaction, ctx) {
    const user = interaction.options.getUser("member", true);
    const reason = interaction.options.getString("reason", true);
    db.insert(schema.warnings)
      .values({ userId: user.id, moderatorId: interaction.user.id, reason })
      .run();
    await recordModAction({
      client: ctx.client,
      action: "warn",
      userId: user.id,
      moderatorId: interaction.user.id,
      reason,
    });
    const count = db
      .select()
      .from(schema.warnings)
      .where(eq(schema.warnings.userId, user.id))
      .all().length;
    return ackMessage(interaction, ctx, "moderation.warn", {
      user: `<@${user.id}>`,
      reason,
      count,
    });
  },
};

const warnings: Command = {
  requiredPermission: PermissionFlagsBits.ModerateMembers,
  data: new SlashCommandBuilder()
    .setName("warnings")
    .setDescription("List a member's warnings.")
    .addUserOption((o) =>
      o.setName("member").setDescription("Member").setRequired(true),
    ),
  async execute(interaction) {
    const user = interaction.options.getUser("member", true);
    const member = interaction.options.getMember("member") as GuildMember | null;
    const displayName = member?.displayName ?? user.displayName;
    const rows = db
      .select()
      .from(schema.warnings)
      .where(eq(schema.warnings.userId, user.id))
      .orderBy(desc(schema.warnings.createdAt))
      .limit(15)
      .all();
    const lines = rows.length
      ? rows.map(
          (w) => `• <t:${w.createdAt}:d> by <@${w.moderatorId}> — ${w.reason}`,
        )
      : ["No warnings on record."];
    return ack(interaction, Accent.primary, `Warnings for ${displayName}`, lines);
  },
};

/** Fetch (or lazily create) the bot-managed AutoMod keyword rule. */
async function getCensorRule(guild: Guild) {
  const rules = await guild.autoModerationRules.fetch();
  return rules.find((r) => r.name === CENSOR_RULE_NAME) ?? null;
}

const censor: Command = {
  requiredPermission: PermissionFlagsBits.ManageGuild,
  data: new SlashCommandBuilder()
    .setName("censor")
    .setDescription("Manage the AutoMod blocked-word filter.")
    .addSubcommand((s) =>
      s
        .setName("add")
        .setDescription("Block a word/phrase")
        .addStringOption((o) =>
          o.setName("word").setDescription("Word or phrase").setRequired(true),
        ),
    )
    .addSubcommand((s) =>
      s
        .setName("remove")
        .setDescription("Unblock a word/phrase")
        .addStringOption((o) =>
          o.setName("word").setDescription("Word or phrase").setRequired(true),
        ),
    )
    .addSubcommand((s) => s.setName("list").setDescription("List blocked words")),
  async execute(interaction, ctx) {
    const guild = interaction.guild as Guild;
    const sub = interaction.options.getSubcommand();
    let rule = await getCensorRule(guild);

    if (sub === "list") {
      const words = rule?.triggerMetadata.keywordFilter ?? [];
      return ack(interaction, Accent.primary, "Censored words", [
        words.length ? words.map((w) => `• \`${w}\``).join("\n") : "None.",
      ]);
    }

    const word = interaction.options.getString("word", true).toLowerCase();
    const current = new Set(rule?.triggerMetadata.keywordFilter ?? []);

    if (sub === "add") current.add(word);
    else current.delete(word);
    const filter = [...current];

    if (!rule) {
      rule = await guild.autoModerationRules.create({
        name: CENSOR_RULE_NAME,
        eventType: AutoModerationRuleEventType.MessageSend,
        triggerType: AutoModerationRuleTriggerType.Keyword,
        triggerMetadata: { keywordFilter: filter },
        actions: [{ type: AutoModerationActionType.BlockMessage }],
        enabled: true,
      });
    } else {
      await rule.edit({ triggerMetadata: { keywordFilter: filter } });
    }

    await recordModAction({
      client: ctx.client,
      action: "censor",
      userId: "—",
      moderatorId: interaction.user.id,
      reason: `${sub} "${word}"`,
    });
    return ack(interaction, Accent.primary, "Censor updated", [
      `${sub === "add" ? "Blocked" : "Unblocked"} \`${word}\`. ${filter.length} word(s) total.`,
    ]);
  },
};

const simulate: Command = {
  requiredPermission: PermissionFlagsBits.ManageGuild,
  data: new SlashCommandBuilder()
    .setName("simulate")
    .setDescription("Admin tools to simulate activity for testing.")
    .addSubcommand((s) =>
      s
        .setName("member")
        .setDescription("Simulate messages for a member: grants approximate XP and overall activity.")
        .addUserOption((o) =>
          o.setName("member").setDescription("Member").setRequired(true),
        )
        .addIntegerOption((o) =>
          o
            .setName("messages")
            .setDescription("Number of messages to simulate")
            .setRequired(true)
            .setMinValue(1)
            .setMaxValue(5000),
        ),
    )
    .addSubcommand((s) =>
      s
        .setName("club")
        .setDescription("Simulate messages for a club: counts only toward that club's activity.")
        .addStringOption((o) =>
          o.setName("club").setDescription("Club name").setRequired(true).setAutocomplete(true),
        )
        .addIntegerOption((o) =>
          o
            .setName("messages")
            .setDescription("Number of messages to simulate")
            .setRequired(true)
            .setMinValue(1)
            .setMaxValue(5000),
        ),
    ),
  async autocomplete(interaction) {
    const focused = interaction.options.getFocused().toLowerCase();
    const choices = approvedClubs()
      .filter((c) => c.name.toLowerCase().includes(focused))
      .slice(0, 25)
      .map((c) => ({ name: c.name, value: c.name }));
    await interaction.respond(choices);
  },
  async execute(interaction, ctx) {
    const sub = interaction.options.getSubcommand();
    const messages = interaction.options.getInteger("messages", true);

    if (sub === "member") {
      const user = interaction.options.getUser("member", true);
      const result = simulateActivity(user.id, messages);
      await recordModAction({
        client: ctx.client,
        action: "simulate_activity",
        userId: user.id,
        moderatorId: interaction.user.id,
        reason: `Simulated ${messages} message(s) of activity`,
        metadata: { messages, xpGained: result.gainedXp },
      });
      return ack(
        interaction,
        Accent.primary,
        "Activity simulated",
        [
          `<@${user.id}> gained **${result.gainedXp} XP** from ${messages} simulated message(s).`,
          result.leveledUp ? `They leveled up to **level ${result.level}**!` : "",
        ].filter(Boolean),
      );
    }

    const club = findClubByName(interaction.options.getString("club", true));
    if (!club || club.status !== "approved") {
      return ack(interaction, Accent.danger, "Not found", ["No such approved club."]);
    }
    bumpActivity(club.id, messages);
    await recordModAction({
      client: ctx.client,
      action: "simulate_club_activity",
      userId: "—",
      moderatorId: interaction.user.id,
      reason: `Simulated ${messages} message(s) of activity for "${club.name}"`,
      metadata: { club: club.name, messages },
    });
    return ack(interaction, Accent.primary, "Club activity simulated", [
      `**${club.name}** gained ${messages} simulated message(s) of activity.`,
      `New activity score: **${clubActivityScore(club.id)}**/100.`,
    ]);
  },
};

const plugin: Plugin = {
  name: "moderation",
  commands: [timeout, untimeout, kick, ban, unban, warn, warnings, censor, simulate],
};

export default plugin;
