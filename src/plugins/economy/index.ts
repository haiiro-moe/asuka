import {
  Events,
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
} from "discord.js";
import { eq } from "drizzle-orm";
import { db, schema, getConfig } from "../../db/index.ts";
import { ensureMember, addCredits } from "../../core/members.ts";
import { v2, card, Accent } from "../../core/components.ts";
import { renderBotMessage } from "../../core/messages.ts";
import { randomInt } from "../../core/util.ts";
import { defineListener, type Command, type Plugin } from "../../core/plugin.ts";
import { recordModAction } from "../moderation/log.ts";

/**
 * Activity-based currency. Each message advances the member's counter; once it
 * crosses a randomly-chosen threshold (200–1000 messages by default) they earn
 * a random 1–15 credits and a fresh threshold is rolled.
 */
function processMessageCredits(userId: string) {
  const cfg = getConfig();
  const member = ensureMember(userId);
  const count = member.messageCount + 1;

  let nextAt = member.nextCreditRewardAt;
  // Initialize the first threshold lazily.
  if (nextAt === 0) {
    nextAt = count + randomInt(cfg.creditWindowMin, cfg.creditWindowMax);
  }

  let reward = 0;
  if (count >= nextAt) {
    reward = randomInt(cfg.creditRewardMin, cfg.creditRewardMax);
    nextAt = count + randomInt(cfg.creditWindowMin, cfg.creditWindowMax);
  }

  db.update(schema.members)
    .set({ messageCount: count, nextCreditRewardAt: nextAt })
    .where(eq(schema.members.userId, userId))
    .run();

  if (reward > 0) addCredits(userId, reward);
  return reward;
}

const listener = defineListener({
  event: Events.MessageCreate,
  async handle(_ctx, message) {
    if (message.author.bot || !message.inGuild()) return;
    if (!getConfig().economyEnabled) return;
    processMessageCredits(message.author.id);
  },
});

/** Award a member starboard-bonus credits. Used by the starboard plugin. */
export function awardStarboardCredits(userId: string): number {
  const cfg = getConfig();
  const reward = randomInt(cfg.starboardCreditMin, cfg.starboardCreditMax);
  addCredits(userId, reward);
  return reward;
}

const amountOptions = (s: import("discord.js").SlashCommandSubcommandBuilder) =>
  s
    .addUserOption((o) =>
      o.setName("member").setDescription("Member").setRequired(true),
    )
    .addIntegerOption((o) =>
      o
        .setName("amount")
        .setDescription("Amount of Social Credits")
        .setRequired(true)
        .setMinValue(1)
        .setMaxValue(1_000_000),
    )
    .addStringOption((o) => o.setName("reason").setDescription("Reason"));

const credits: Command = {
  requiredPermission: PermissionFlagsBits.ManageGuild,
  data: new SlashCommandBuilder()
    .setName("credits")
    .setDescription("Admin: grant or revoke Social Credits.")
    .addSubcommand((s) =>
      amountOptions(s.setName("give").setDescription("Give Social Credits to a member.")),
    )
    .addSubcommand((s) =>
      amountOptions(
        s.setName("take").setDescription("Take Social Credits from a member (balance stops at 0)."),
      ),
    ),
  async execute(interaction, ctx) {
    const sub = interaction.options.getSubcommand();
    const user = interaction.options.getUser("member", true);
    const amount = interaction.options.getInteger("amount", true);
    const reason = interaction.options.getString("reason");
    const giving = sub === "give";

    if (user.bot) {
      return interaction.reply({
        ...v2(card({ accent: Accent.danger, title: "failed", lines: ["bots don't hold social credits."] })),
        flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
      });
    }

    const balance = addCredits(user.id, giving ? amount : -amount);
    await recordModAction({
      client: ctx.client,
      action: giving ? "credits_grant" : "credits_revoke",
      userId: user.id,
      moderatorId: interaction.user.id,
      reason,
      metadata: { amount: giving ? amount : -amount, balance },
    });
    const payload = await renderBotMessage(
      giving ? "economy.credits-granted" : "economy.credits-revoked",
      ctx,
      {
        user: `<@${user.id}>`,
        amount,
        balance,
        reason: reason ?? "",
      },
    );
    return interaction.reply({
      ...payload,
      flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
    });
  },
};

const plugin: Plugin = {
  name: "economy",
  commands: [credits],
  listeners: [listener],
};

export default plugin;
