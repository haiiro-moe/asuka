import {
  SlashCommandBuilder,
  ButtonStyle,
  Events,
  type Client,
  type User,
  type GuildMember,
  type ChatInputCommandInteraction,
} from "discord.js";
import { eq, desc, and } from "drizzle-orm";
import { db, schema } from "../../db/index.ts";
import {
  v2,
  card,
  Accent,
  ContainerBuilder,
  TextDisplayBuilder,
  SectionBuilder,
  SeparatorBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  pngAttachment,
  ackButtonLoading,
} from "../../core/components.ts";
import { ensureMember } from "../../core/members.ts";
import { defineListener, type Command, type Plugin } from "../../core/plugin.ts";
import {
  getPresidencyHistoryForUser,
  getPresidentCandidacy,
} from "../elections/service.ts";
import { env } from "../../config/env.ts";
import {
  fetchImageDataUri,
  renderProfileCardPng,
  renderElectionProfileCardPng,
  renderLeaderboardCardPng,
  type LeaderboardRow,
} from "../../core/images/index.tsx";
import {
  getCreditRank,
  getMemberClubs,
  progressBar,
  memberCount,
  leaderboardPage,
  levelProgress,
} from "./stats.ts";

const PAGE_SIZE = 10;

type ProfileViewKind = "main" | "election";

/**
 * Resolve the target user + their best display name (server nickname → global
 * display name → username) from a `member` user option, defaulting to the caller.
 */
function resolveTarget(interaction: ChatInputCommandInteraction): {
  user: User;
  displayName: string;
} {
  const user = interaction.options.getUser("member") ?? interaction.user;
  const member = (interaction.options.getMember("member") ??
    interaction.member) as GuildMember | null;
  return { user, displayName: member?.displayName ?? user.displayName };
}

/** The target user's candidacy in the currently open election, if any. */
function getOpenCandidacy(userId: string) {
  const election = db
    .select()
    .from(schema.elections)
    .where(eq(schema.elections.status, "open"))
    .orderBy(desc(schema.elections.startsAt))
    .get();
  if (!election) return undefined;
  return db
    .select()
    .from(schema.candidates)
    .where(
      and(
        eq(schema.candidates.electionId, election.id),
        eq(schema.candidates.userId, userId),
      ),
    )
    .get();
}

/**
 * The candidacy shown on the election profile view: a live candidacy in the
 * open election, or — for the sitting president — the winning candidacy saved
 * from their election, kept until the next term starts.
 */
function getElectionCandidacy(userId: string) {
  const open = getOpenCandidacy(userId);
  if (open) return { candidate: open, isPresident: false };
  const won = getPresidentCandidacy(userId);
  if (won) return { candidate: won, isPresident: true };
  return { candidate: undefined, isPresident: false };
}

/** Text-only profile container, used when image rendering fails. */
function profileTextContainer(user: User, displayName: string): ContainerBuilder {
  const m = ensureMember(user.id);
  const prog = levelProgress(m.xp);
  const rank = getCreditRank(user.id);
  const clubs = getMemberClubs(user.id);

  const section = new SectionBuilder()
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(`## ${displayName}'s profile`),
      new TextDisplayBuilder().setContent(
        [
          `**level:** ${prog.level}`,
          `**social credits:** ${m.socialCredits} (rank #${rank})`,
        ].join("\n"),
      ),
    )
    .setThumbnailAccessory((t) =>
      t.setURL(user.displayAvatarURL({ size: 256 })).setDescription(displayName),
    );

  const container = new ContainerBuilder()
    .setAccentColor(Accent.primary)
    .addSectionComponents(section)
    .addSeparatorComponents(new SeparatorBuilder().setDivider(true))
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        [
          `**xp:** ${m.xp}`,
          `${progressBar(prog.current, prog.needed)} ${prog.current}/${prog.needed} to level ${prog.level + 1}`,
          `**clubs:** ${clubs.length ? clubs.join(", ") : "none"}`,
        ].join("\n"),
      ),
    );

  const presidencyLog = getPresidencyHistoryForUser(user.id);
  if (presidencyLog.length > 0) {
    container
      .addSeparatorComponents(new SeparatorBuilder().setDivider(true))
      .addTextDisplayComponents(
        new TextDisplayBuilder().setContent(
          [
            "**presidency log**",
            ...presidencyLog.map(
              (t) =>
                `<t:${t.termStart}:D> – ${t.termEnd ? `<t:${t.termEnd}:D>` : "present"} (${t.votes} votes)`,
            ),
          ].join("\n"),
        ),
      );
  }
  return container;
}

/** Text-only election profile container, used when image rendering fails. */
function electionTextContainer(user: User, displayName: string): ContainerBuilder {
  const m = ensureMember(user.id);
  const prog = levelProgress(m.xp);
  const rank = getCreditRank(user.id);
  const { candidate, isPresident } = getElectionCandidacy(user.id);

  const lines = [
    `**leaderboard rank:** #${rank}`,
    `**level:** ${prog.level} · **xp:** ${m.xp} (${prog.current}/${prog.needed} to next)`,
    `**social credits:** ${m.socialCredits}`,
  ];
  if (candidate) {
    lines.push(
      "",
      `**campaign motto:** ${candidate.motto || "—"}`,
      `**if elected:** ${candidate.roleDescription || "—"}`,
    );
    if (isPresident) {
      lines.push("", `-# sitting president — won with ${candidate.voteCount} vote(s).`);
    }
  } else {
    lines.push("", "-# not currently standing in an election.");
  }

  return new ContainerBuilder()
    .setAccentColor(Accent.election)
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        `## ${displayName} — ${isPresident ? "president profile" : "election profile"}`,
      ),
      new TextDisplayBuilder().setContent(lines.join("\n")),
    );
}

/**
 * Build the /profile message: an image card (with a text fallback) plus, when
 * the target is a candidate in the open election, a button toggling between
 * the main profile and the election profile view.
 */
async function profileView(user: User, displayName: string, view: ProfileViewKind) {
  const m = ensureMember(user.id);
  const prog = levelProgress(m.xp);
  const rank = getCreditRank(user.id);
  const { candidate, isPresident } = getElectionCandidacy(user.id);

  const toggle = candidate
    ? new ActionRowBuilder<ButtonBuilder>().addComponents(
        view === "main"
          ? new ButtonBuilder()
              .setCustomId(`pf:election:${user.id}`)
              .setLabel(isPresident ? "president profile" : "election profile")
              .setStyle(ButtonStyle.Secondary)
          : new ButtonBuilder()
              .setCustomId(`pf:main:${user.id}`)
              .setLabel("profile")
              .setStyle(ButtonStyle.Secondary),
      )
    : null;

  const avatarDataUri = await fetchImageDataUri(
    user.displayAvatarURL({ extension: "png", size: 256, forceStatic: true }),
  );

  const png =
    view === "main"
      ? await renderProfileCardPng({
          displayName,
          avatarDataUri,
          level: prog.level,
          xp: m.xp,
          xpCurrent: prog.current,
          xpNeeded: prog.needed,
          credits: m.socialCredits,
          rank,
          clubs: getMemberClubs(user.id),
          presidency: getPresidencyHistoryForUser(user.id),
        })
      : await renderElectionProfileCardPng({
          displayName,
          avatarDataUri,
          rank,
          level: prog.level,
          credits: m.socialCredits,
          motto: candidate?.motto ?? null,
          vision: candidate?.roleDescription ?? null,
          isCandidate: Boolean(candidate),
          subtitle: isPresident ? "president" : undefined,
        });

  if (png) {
    const { file, gallery } = pngAttachment(png, `${view}-profile-${user.id}.png`);
    const container = new ContainerBuilder()
      .setAccentColor(view === "main" ? Accent.primary : Accent.election)
      .addMediaGalleryComponents(gallery);
    if (toggle) container.addActionRowComponents(toggle);
    return { ...v2(container), files: [file] };
  }

  const container =
    view === "main"
      ? profileTextContainer(user, displayName)
      : electionTextContainer(user, displayName);
  if (toggle) container.addActionRowComponents(toggle);
  return v2(container);
}

const profile: Command = {
  data: new SlashCommandBuilder()
    .setName("profile")
    .setDescription("View a member's profile.")
    .addUserOption((o) => o.setName("member").setDescription("Member (defaults to you)")),
  async execute(interaction) {
    const { user, displayName } = resolveTarget(interaction);
    // Image render + avatar fetch can blow the 3s interaction deadline.
    await interaction.deferReply();
    await interaction.editReply(await profileView(user, displayName, "main"));
  },
};

/** Handle profile main/election view toggle button clicks. */
const profileToggle = defineListener({
  event: Events.InteractionCreate,
  async handle(_ctx, interaction) {
    if (!interaction.isButton() || !interaction.customId.startsWith("pf:")) return;
    const [, view, userId] = interaction.customId.split(":");
    if ((view !== "main" && view !== "election") || !userId) return;

    await ackButtonLoading(interaction);
    try {
      const user = await interaction.client.users.fetch(userId);
      const member = await interaction.guild?.members.fetch(userId).catch(() => null);
      const payload = await profileView(user, member?.displayName ?? user.displayName, view);
      // attachments: [] drops the previous upload so the old image doesn't linger.
      await interaction.editReply({ ...payload, attachments: [] });
    } catch (err) {
      console.error("[profile] view toggle failed:", err);
      await interaction
        .editReply(
          v2(card({ accent: Accent.danger, title: "something went wrong", lines: ["run /profile again."] })),
        )
        .catch(() => {});
    }
  },
});

/** Resolve a member's display name for image rendering (no mention parsing). */
function displayNameFor(client: Client, userId: string): string {
  const guild = client.guilds.cache.get(env.GUILD_ID);
  return (
    guild?.members.cache.get(userId)?.displayName ??
    client.users.cache.get(userId)?.displayName ??
    userId
  );
}

/** Build the leaderboard page payload plus prev/next buttons. */
async function leaderboardView(client: Client, page: number) {
  const total = memberCount();
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const clamped = Math.min(Math.max(0, page), totalPages - 1);
  const rows = leaderboardPage(clamped, PAGE_SIZE);

  const buttons = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`lb:${clamped - 1}`)
      .setLabel("previous")
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(clamped <= 0),
    new ButtonBuilder()
      .setCustomId(`lb:${clamped + 1}`)
      .setLabel("next")
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(clamped >= totalPages - 1),
  );

  const imageRows: LeaderboardRow[] = rows.map((m, i) => ({
    rank: clamped * PAGE_SIZE + i + 1,
    name: displayNameFor(client, m.userId),
    credits: m.socialCredits,
    level: m.level,
  }));
  const png = await renderLeaderboardCardPng({ rows: imageRows });

  if (png) {
    const { file, gallery } = pngAttachment(png, `leaderboard-p${clamped}.png`);
    const container = new ContainerBuilder()
      .setAccentColor(Accent.star)
      .addMediaGalleryComponents(gallery)
      .addTextDisplayComponents(
        new TextDisplayBuilder().setContent(`-# page ${clamped + 1}/${totalPages}`),
      )
      .addActionRowComponents(buttons);
    return { ...v2(container), files: [file] };
  }

  const lines = rows.length
    ? rows.map(
        (m, i) =>
          `**${clamped * PAGE_SIZE + i + 1}.** <@${m.userId}> — ${m.socialCredits} credits · lvl ${m.level}`,
      )
    : ["no ranked members yet."];

  const container = new ContainerBuilder()
    .setAccentColor(Accent.star)
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent("## ★ social credit leaderboard"),
      new TextDisplayBuilder().setContent(lines.join("\n")),
      new TextDisplayBuilder().setContent(`-# page ${clamped + 1}/${totalPages}`),
    )
    .addActionRowComponents(buttons);

  return v2(container);
}

const leaderboard: Command = {
  data: new SlashCommandBuilder()
    .setName("leaderboard")
    .setDescription("View the social credit leaderboard."),
  async execute(interaction) {
    await interaction.deferReply();
    await interaction.editReply(await leaderboardView(interaction.client, 0));
  },
};

/** Handle leaderboard pagination button clicks. */
const pagination = defineListener({
  event: Events.InteractionCreate,
  async handle(_ctx, interaction) {
    if (!interaction.isButton() || !interaction.customId.startsWith("lb:")) return;
    const page = Number(interaction.customId.slice(3));
    await ackButtonLoading(interaction);
    try {
      const payload = await leaderboardView(interaction.client, page);
      await interaction.editReply({ ...payload, attachments: [] });
    } catch (err) {
      console.error("[profile] leaderboard page failed:", err);
      await interaction
        .editReply(
          v2(card({ accent: Accent.danger, title: "something went wrong", lines: ["run /leaderboard again."] })),
        )
        .catch(() => {});
    }
  },
});

const plugin: Plugin = {
  name: "profile",
  commands: [profile, leaderboard],
  listeners: [pagination, profileToggle],
};

export default plugin;
