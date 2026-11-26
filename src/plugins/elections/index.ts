import {
  SlashCommandBuilder,
  MessageFlags,
  type Guild,
  type GuildMember,
  type ChatInputCommandInteraction,
} from "discord.js";
import { eq, and, lte } from "drizzle-orm";
import { db, schema, getConfig } from "../../db/index.ts";
import { v2, card, Accent } from "../../core/components.ts";
import { isPresident, isAdmin } from "../../core/permissions.ts";
import { nowSec, formatDuration } from "../../core/util.ts";
import type { Command, Plugin, BotContext } from "../../core/plugin.ts";
import {
  openElection,
  closeElection,
  startVoting,
  getOpenElection,
  getCandidates,
  applyCandidate,
  checkEligibility,
  applyTheme,
  getThemeStatus,
} from "./service.ts";

function ack(
  interaction: ChatInputCommandInteraction,
  accent: number,
  title: string,
  lines: string[],
) {
  const payload = v2(card({ accent, title, lines }));
  // Slow subcommands defer first (image rendering + channel cleanup can blow
  // the 3s interaction deadline); ephemerality is set at defer time.
  if (interaction.deferred || interaction.replied) {
    return interaction.editReply(payload);
  }
  return interaction.reply({
    ...payload,
    flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
  });
}

const election: Command = {
  data: new SlashCommandBuilder()
    .setName("election")
    .setDescription("Student council elections.")
    .addSubcommand((s) =>
      s
        .setName("apply")
        .setDescription("Stand as a candidate for president.")
        .addStringOption((o) =>
          o.setName("motto").setDescription("Your campaign motto").setRequired(true),
        )
        .addStringOption((o) =>
          o
            .setName("vision")
            .setDescription("What you'd do as president")
            .setRequired(true),
        ),
    )
    .addSubcommand((s) => s.setName("status").setDescription("View the current election."))
    .addSubcommand((s) =>
      s.setName("start").setDescription("Open an election now (admin only)."),
    )
    .addSubcommand((s) =>
      s.setName("end").setDescription("Close the election and tally votes (admin only)."),
    ),

  async execute(interaction, ctx) {
    const sub = interaction.options.getSubcommand();
    const guild = interaction.guild as Guild;
    const member = interaction.member as GuildMember;

    // apply/start/end render banner images and clean channels — too slow for
    // the 3s interaction deadline, so acknowledge up front.
    if (sub === "apply" || sub === "start" || sub === "end") {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    }

    if (sub === "apply") {
      const ineligible = checkEligibility(member);
      if (ineligible) return ack(interaction, Accent.danger, "not eligible", [ineligible]);
      const motto = interaction.options.getString("motto", true);
      const vision = interaction.options.getString("vision", true);
      const error = await applyCandidate(ctx.client, member, motto, vision);
      if (error) return ack(interaction, Accent.danger, "couldn't apply", [error]);
      return ack(interaction, Accent.success, "you're running", [
        "your candidate profile is posted in the election channel.",
      ]);
    }

    if (sub === "status") {
      const open = getOpenElection();
      if (!open) return ack(interaction, Accent.election, "elections", ["no election is open."]);
      const candidates = getCandidates(open.id);
      const lines = [
        open.status === "registration"
          ? `registration is open. voting begins <t:${open.votingStartsAt}:R>.`
          : `voting closes <t:${open.endsAt}:R>.`,
        "",
        candidates.length
          ? candidates.map((c) => `» <@${c.userId}> — _${c.motto}_`).join("\n")
          : "no candidates yet.",
      ];
      return ack(interaction, Accent.election, "current election", lines);
    }

    // Admin-only management subcommands.
    if (!isAdmin(member)) {
      return ack(interaction, Accent.danger, "forbidden", ["admin only."]);
    }
    if (sub === "start") {
      const opened = await openElection(ctx.client);
      return ack(
        interaction,
        opened ? Accent.success : Accent.warning,
        opened ? "election opened" : "not opened",
        [opened ? "a new election is open." : "an election is already open, or it's disabled or unconfigured."],
      );
    }
    if (sub === "end") {
      const open = getOpenElection();
      if (!open) return ack(interaction, Accent.warning, "no election", ["nothing to close."]);
      const winner = await closeElection(guild, open.id);
      return ack(interaction, Accent.success, "election closed", [
        winner ? `winner: <@${winner.userId}> (${winner.votes} votes).` : "no winner.",
      ]);
    }
  },
};

const theme: Command = {
  data: new SlashCommandBuilder()
    .setName("theme")
    .setDescription("Change the server theme (president only, weekly).")
    .addStringOption((o) =>
      o.setName("name").setDescription("Your custom name for the %s slot"),
    )
    .addAttachmentOption((o) =>
      o.setName("icon").setDescription("New server icon image"),
    ),
  async execute(interaction) {
    const guild = interaction.guild as Guild;
    const member = interaction.member as GuildMember;
    const cfg = getConfig();
    if (!isPresident(member, cfg) && !isAdmin(member)) {
      return ack(interaction, Accent.danger, "forbidden", [
        "only the student council president can change the server theme.",
      ]);
    }

    const status = getThemeStatus();
    if (status.cooldownRemaining > 0) {
      return ack(interaction, Accent.warning, "too soon", [
        `you can change the theme again in **${formatDuration(status.cooldownRemaining)}**.`,
      ]);
    }

    const name = interaction.options.getString("name");
    const icon = interaction.options.getAttachment("icon");
    // Guild name/icon updates + announcement can exceed the 3s deadline.
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const result = await applyTheme(guild, {
      name,
      iconUrl: icon?.url,
      actorId: interaction.user.id,
    });
    if ("error" in result) {
      return ack(interaction, Accent.warning, "nothing to do", [result.error]);
    }
    return ack(interaction, Accent.success, "theme updated", result.applied);
  },
};

/**
 * Hourly: move elections whose registration window has elapsed into the
 * voting phase, and close any whose voting window has elapsed.
 */
async function electionTick(ctx: BotContext) {
  const votingDue = db
    .select()
    .from(schema.elections)
    .where(
      and(
        eq(schema.elections.status, "registration"),
        lte(schema.elections.votingStartsAt, nowSec()),
      ),
    )
    .all();
  for (const e of votingDue) await startVoting(ctx.client, e);

  const closeDue = db
    .select()
    .from(schema.elections)
    .where(and(eq(schema.elections.status, "open"), lte(schema.elections.endsAt, nowSec())))
    .all();
  const guild = await ctx.client.guilds.fetch(ctx.guildId).catch(() => null);
  if (!guild) return;
  for (const e of closeDue) await closeElection(guild, e.id);
}

const plugin: Plugin = {
  name: "elections",
  commands: [election, theme],
  schedules: [
    {
      name: "election-open",
      cron: "0 12 1 */3 *", // noon on the 1st, every 3rd month
      run: (ctx) => void openElection(ctx.client),
    },
    { name: "election-close-check", cron: "0 * * * *", run: electionTick },
  ],
};

export default plugin;
