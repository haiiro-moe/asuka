import {
  SlashCommandBuilder,
  PermissionFlagsBits,
  MessageFlags,
  type ChatInputCommandInteraction,
} from "discord.js";
import { db, schema, getConfig } from "../../db/index.ts";
import { v2, card, Accent } from "../../core/components.ts";
import type { Command, Plugin } from "../../core/plugin.ts";
import { fetchAllRankings, TatsuApiError } from "./tatsu.ts";
import { tatsuScoreToXp, estimateMessages, simulateCredits } from "./convert.ts";

function progressCard(lines: string[]) {
  return v2(
    card({ accent: Accent.primary, title: "tatsu migration", lines }),
  );
}

async function runMigration(
  interaction: ChatInputCommandInteraction,
  apiKey: string,
  guildId: string,
) {
  await interaction.editReply(
    progressCard(["fetching the Tatsu leaderboard… (0 entries so far)"]),
  );

  let lastEdit = 0;
  const rankings = await fetchAllRankings(apiKey, guildId, async (fetched) => {
    // Throttle progress edits so a big leaderboard doesn't spam the API.
    if (Date.now() - lastEdit < 4000) return;
    lastEdit = Date.now();
    await interaction
      .editReply(
        progressCard([`fetching the Tatsu leaderboard… (${fetched} entries so far)`]),
      )
      .catch(() => {});
  });

  await interaction.editReply(
    progressCard([
      `fetched **${rankings.length}** leaderboard entries. importing…`,
    ]),
  );

  const guild = await interaction.client.guilds.fetch(guildId);
  const guildMembers = await guild.members.fetch();
  const cfg = getConfig();

  let imported = 0;
  let skippedDeparted = 0;
  let skippedZero = 0;
  let totalCredits = 0;
  let topLevel = 0;

  for (const entry of rankings) {
    if (entry.score <= 0) {
      skippedZero++;
      continue;
    }
    const guildMember = guildMembers.get(entry.user_id);
    if (!guildMember || guildMember.user.bot) {
      skippedDeparted++;
      continue;
    }

    const { xp, level } = tatsuScoreToXp(entry.score);
    const messageCount = estimateMessages(entry.score);
    const { credits, nextCreditRewardAt } = simulateCredits(messageCount, cfg);

    const values = {
      xp,
      level,
      messageCount,
      socialCredits: credits,
      nextCreditRewardAt,
    };
    db.insert(schema.members)
      .values({ userId: entry.user_id, ...values })
      .onConflictDoUpdate({ target: schema.members.userId, set: values })
      .run();

    imported++;
    totalCredits += credits;
    if (level > topLevel) topLevel = level;
  }

  await interaction.editReply(
    v2(
      card({
        accent: Accent.success,
        title: "tatsu migration complete",
        lines: [
          `imported **${imported}** members (top level: **${topLevel}**).`,
          `granted **${totalCredits}** social credits from simulated activity.`,
          `skipped **${skippedDeparted}** entries for users no longer in the server (or bots).`,
          ...(skippedZero ? [`skipped **${skippedZero}** zero-score entries.`] : []),
        ],
      }),
    ),
  );
}

const migrate: Command = {
  requiredPermission: PermissionFlagsBits.Administrator,
  data: new SlashCommandBuilder()
    .setName("migrate-tatsu")
    .setDescription(
      "One-shot import of Tatsu server scores into XP, levels and Social Credits.",
    )
    .addStringOption((o) =>
      o
        .setName("apikey")
        .setDescription("Tatsu API key (guild owner: t!apikey). Not stored.")
        .setRequired(true),
    ),
  async execute(interaction, ctx) {
    const apiKey = interaction.options.getString("apikey", true);
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    try {
      await runMigration(interaction, apiKey, ctx.guildId);
    } catch (err) {
      const detail =
        err instanceof TatsuApiError
          ? err.message
          : "unexpected error. check the bot logs.";
      console.error("[tatsu-migrate]", err);
      await interaction.editReply(
        v2(card({ accent: Accent.danger, title: "tatsu migration failed", lines: [detail] })),
      );
    }
  },
};

const plugin: Plugin = {
  name: "tatsu-migrate",
  commands: [migrate],
};

export default plugin;
