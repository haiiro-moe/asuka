import {
  SlashCommandBuilder,
  MessageFlags,
  ButtonStyle,
  Events,
  type Guild,
  type GuildMember,
  type TextChannel,
  type ChatInputCommandInteraction,
} from "discord.js";
import { eq, and } from "drizzle-orm";
import { env } from "../../config/env.ts";
import { db, schema, getConfig } from "../../db/index.ts";
import {
  v2,
  card,
  Accent,
  ActionRowBuilder,
  ButtonBuilder,
  ackButtonLoading,
} from "../../core/components.ts";
import { isPresident, isAdmin } from "../../core/permissions.ts";
import { defineListener, type Command, type Plugin } from "../../core/plugin.ts";
import {
  MAX_CLUBS_PER_USER,
  MIN_FOUNDING_MEMBERS,
  createDraftClub,
  approveClub,
  rejectClub,
  terminateClub,
  submitForApproval,
  acceptFounder,
  pendingFounderIds,
  addClubMember,
  postMessageToClubSpace,
  editClub,
  cancelDraft,
  getClub,
  provisionForTier,
  syncClubAccess,
  syncDirectory,
  runDailyPayout,
  userClubCount,
  clubMemberIds,
  findClubByName,
  findClubByChannel,
  approvedClubs,
  bumpActivity,
  clubActivityScore,
  createAnnounceToken,
  TIER_LABEL,
} from "./service.ts";
import { clubApiRoutes } from "./api.ts";

/**
 * Reply with an ephemeral Components V2 card. If the interaction was already
 * acknowledged (via `begin`), edit that reply instead — this keeps slow,
 * channel-provisioning subcommands from hitting the 3s interaction timeout.
 */
function ack(
  interaction: ChatInputCommandInteraction,
  accent: number,
  title: string,
  lines: string[],
) {
  const payload = v2(card({ accent, title, lines }));
  if (interaction.replied || interaction.deferred) {
    return interaction.editReply(payload);
  }
  return interaction.reply({
    ...payload,
    flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
  });
}

/**
 * Acknowledge a slow subcommand immediately (within the 3s window) with an
 * ephemeral Components V2 placeholder, so later `ack` calls can edit it.
 */
function begin(interaction: ChatInputCommandInteraction) {
  return interaction.reply({
    ...v2(card({ accent: Accent.primary, title: "working on it…", lines: [] })),
    flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
  });
}

/** Subcommands that perform Discord API work and must ack before running. */
const SLOW_SUBCOMMANDS = new Set([
  "create",
  "join",
  "invite",
  "leave",
  "kick",
  "edit",
  "terminate",
]);

const create: Command = {
  requiredRoleConfigKey: "clubCreateMinRoleId",
  data: new SlashCommandBuilder()
    .setName("club")
    .setDescription("Create and manage clubs.")
    .addSubcommand((s) =>
      s
        .setName("create")
        .setDescription("Propose a new club (needs president approval).")
        .addStringOption((o) =>
          o.setName("name").setDescription("Club name").setRequired(true),
        )
        .addStringOption((o) =>
          o.setName("description").setDescription("What's it about?").setRequired(true),
        )
        .addUserOption((o) =>
          o.setName("member2").setDescription("Founding member #2").setRequired(true),
        )
        .addUserOption((o) =>
          o.setName("member3").setDescription("Founding member #3").setRequired(true),
        ),
    )
    .addSubcommand((s) =>
      s
        .setName("join")
        .setDescription("Join a club.")
        .addStringOption((o) =>
          o.setName("club").setDescription("Club name").setRequired(true).setAutocomplete(true),
        ),
    )
    .addSubcommand((s) =>
      s
        .setName("leave")
        .setDescription("Leave a club.")
        .addStringOption((o) =>
          o.setName("club").setDescription("Club name").setRequired(true).setAutocomplete(true),
        ),
    )
    .addSubcommand((s) =>
      s
        .setName("info")
        .setDescription("View a club's details.")
        .addStringOption((o) =>
          o.setName("club").setDescription("Club name").setRequired(true).setAutocomplete(true),
        ),
    )
    .addSubcommand((s) =>
      s
        .setName("edit")
        .setDescription("Edit your club's name or description (owner only).")
        .addStringOption((o) =>
          o.setName("club").setDescription("Club name").setRequired(true).setAutocomplete(true),
        )
        .addStringOption((o) => o.setName("name").setDescription("New name"))
        .addStringOption((o) => o.setName("description").setDescription("New description")),
    )
    .addSubcommand((s) => s.setName("list").setDescription("List all clubs."))
    .addSubcommand((s) =>
      s
        .setName("invite")
        .setDescription("Invite someone to your club (owner only).")
        .addStringOption((o) =>
          o.setName("club").setDescription("Club name").setRequired(true).setAutocomplete(true),
        )
        .addUserOption((o) =>
          o.setName("member").setDescription("Member to invite").setRequired(true),
        ),
    )
    .addSubcommand((s) =>
      s
        .setName("kick")
        .setDescription("Remove a member from your club (owner only).")
        .addStringOption((o) =>
          o.setName("club").setDescription("Club name").setRequired(true).setAutocomplete(true),
        )
        .addUserOption((o) =>
          o.setName("member").setDescription("Member to remove").setRequired(true),
        ),
    )
    .addSubcommand((s) =>
      s
        .setName("terminate")
        .setDescription("Terminate a club (president/admin only).")
        .addStringOption((o) =>
          o.setName("club").setDescription("Club name").setRequired(true).setAutocomplete(true),
        ),
    )
    .addSubcommand((s) =>
      s
        .setName("announce")
        .setDescription("Get a link to compose and send a club announcement (owner only).")
        .addStringOption((o) =>
          o.setName("club").setDescription("Club name").setRequired(true).setAutocomplete(true),
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
    const guild = interaction.guild as Guild;

    // Slow subcommands provision channels/DMs; ack first to beat the 3s timeout.
    if (SLOW_SUBCOMMANDS.has(sub)) await begin(interaction);

    if (sub === "create") {
      const name = interaction.options.getString("name", true).trim();
      const description = interaction.options.getString("description", true).trim();
      const m2 = interaction.options.getUser("member2", true);
      const m3 = interaction.options.getUser("member3", true);
      const founders = [interaction.user, m2, m3];

      const ids = new Set(founders.map((u) => u.id));
      if (ids.size < MIN_FOUNDING_MEMBERS) {
        return ack(interaction, Accent.danger, "invalid founders", [
          "you need 3 *distinct* founding members.",
        ]);
      }
      // Bots are normally barred from clubs, but allowed in dev for testing.
      if (!env.DEV && founders.some((u) => u.bot)) {
        return ack(interaction, Accent.danger, "invalid founders", ["bots can't join clubs."]);
      }
      for (const u of founders) {
        if (userClubCount(u.id) >= MAX_CLUBS_PER_USER) {
          return ack(interaction, Accent.danger, "member at limit", [
            `<@${u.id}> is already in ${MAX_CLUBS_PER_USER} clubs.`,
          ]);
        }
      }
      if (findClubByName(name)) {
        return ack(interaction, Accent.danger, "name taken", ["a club with that name exists."]);
      }

      const club = createDraftClub({
        name,
        description,
        ownerId: interaction.user.id,
        memberIds: [...ids],
      });

      // Ask the other founders to consent before the club goes for approval.
      const otherFounders = [...ids].filter((id) => id !== interaction.user.id);
      for (const userId of otherFounders) {
        const user = await ctx.client.users.fetch(userId).catch(() => null);

        // In dev, bots auto-accept founding membership without a DM.
        if (env.DEV && user?.bot) {
          acceptFounder(club.id, userId);
          continue;
        }

        const sent = await user
          ?.send({
            ...v2(
              card({
                accent: Accent.club,
                title: `join "${name}" as a founding member?`,
                lines: [
                  `<@${interaction.user.id}> wants you as a founding member of **${name}**.`,
                  description,
                  "all founders must accept before the club goes to the admins.",
                ],
                buttons: [
                  new ButtonBuilder()
                    .setCustomId(`club:fnd:yes:${club.id}`)
                    .setLabel("accept")
                    .setStyle(ButtonStyle.Success),
                  new ButtonBuilder()
                    .setCustomId(`club:fnd:no:${club.id}`)
                    .setLabel("decline")
                    .setStyle(ButtonStyle.Danger),
                ],
              }),
            ),
            flags: MessageFlags.IsComponentsV2,
          })
          .catch(() => null);

        if (!sent) {
          // A human founder couldn't be DMed — abandon the draft.
          db.delete(schema.clubs).where(eq(schema.clubs.id, club.id)).run();
          return ack(interaction, Accent.danger, "couldn't reach founders", [
            `i couldn't dm <@${userId}>. their dms may be closed. ask them to open their dms and try again.`,
          ]);
        }
      }

      // If everyone (e.g. all-bot founders in dev) already accepted, advance now.
      if (pendingFounderIds(club.id).length === 0) {
        await submitForApproval(ctx.client, club.id);
        return ack(interaction, Accent.success, "sent for approval", [
          `**${name}** is with the admins for approval.`,
        ]);
      }

      return ack(interaction, Accent.success, "invitations sent", [
        `waiting for your founding members to accept **${name}**.`,
        "once everyone accepts, it goes to the admins for approval.",
      ]);
    }

    if (sub === "join") {
      const club = findClubByName(interaction.options.getString("club", true));
      if (!club || club.status !== "approved") {
        return ack(interaction, Accent.danger, "not found", ["no such approved club."]);
      }
      if (clubMemberIds(club.id).includes(interaction.user.id)) {
        return ack(interaction, Accent.warning, "already a member", ["You're already in this club."]);
      }
      if (userClubCount(interaction.user.id) >= MAX_CLUBS_PER_USER) {
        return ack(interaction, Accent.danger, "club limit", [
          `you can be in at most ${MAX_CLUBS_PER_USER} clubs.`,
        ]);
      }
      await addClubMember(guild, club, interaction.user.id);
      return ack(interaction, Accent.success, "joined", [`welcome to **${club.name}**.`]);
    }

    if (sub === "invite") {
      const club = findClubByName(interaction.options.getString("club", true));
      if (!club || club.status !== "approved") {
        return ack(interaction, Accent.danger, "not found", ["no such approved club."]);
      }
      const member = interaction.member as GuildMember;
      const isOwner = club.ownerId === interaction.user.id;
      if (!isOwner && !isAdmin(member) && !isPresident(member, getConfig())) {
        return ack(interaction, Accent.danger, "forbidden", [
          "only the club owner (or an admin or president) can invite members.",
        ]);
      }
      const target = interaction.options.getUser("member", true);
      if (target.bot && !env.DEV) {
        return ack(interaction, Accent.danger, "invalid invite", ["bots can't join clubs."]);
      }
      if (clubMemberIds(club.id).includes(target.id)) {
        return ack(interaction, Accent.warning, "already a member", [
          `<@${target.id}> is already in **${club.name}**.`,
        ]);
      }
      if (userClubCount(target.id) >= MAX_CLUBS_PER_USER) {
        return ack(interaction, Accent.danger, "at limit", [
          `<@${target.id}> is already in ${MAX_CLUBS_PER_USER} clubs.`,
        ]);
      }

      // In dev, bots join instantly without a DM prompt.
      if (env.DEV && target.bot) {
        await addClubMember(guild, club, target.id);
        return ack(interaction, Accent.success, "member added", [
          `<@${target.id}> joined **${club.name}**.`,
        ]);
      }

      const sent = await target
        .send({
          ...v2(
            card({
              accent: Accent.club,
              title: `you're invited to ${club.name}`,
              lines: [
                `<@${interaction.user.id}> invited you to join **${club.name}**.`,
                club.description,
              ],
              buttons: [
                new ButtonBuilder()
                  .setCustomId(`club:inv:yes:${club.id}`)
                  .setLabel("accept")
                  .setStyle(ButtonStyle.Success),
                new ButtonBuilder()
                  .setCustomId(`club:inv:no:${club.id}`)
                  .setLabel("decline")
                  .setStyle(ButtonStyle.Danger),
              ],
            }),
          ),
          flags: MessageFlags.IsComponentsV2,
        })
        .catch(() => null);
      if (!sent) {
        return ack(interaction, Accent.danger, "couldn't reach them", [
          `i couldn't dm <@${target.id}>. their dms may be closed.`,
        ]);
      }
      return ack(interaction, Accent.success, "invitation sent", [
        `invited <@${target.id}> to **${club.name}**.`,
      ]);
    }

    if (sub === "leave") {
      const club = findClubByName(interaction.options.getString("club", true));
      if (!club) return ack(interaction, Accent.danger, "not found", ["no such club."]);
      db.delete(schema.clubMembers)
        .where(
          and(
            eq(schema.clubMembers.clubId, club.id),
            eq(schema.clubMembers.userId, interaction.user.id),
          ),
        )
        .run();
      const remaining = clubMemberIds(club.id);
      if (remaining.length === 0) {
        await terminateClub(guild, club.id);
        return ack(interaction, Accent.warning, "club disbanded", [
          `**${club.name}** had no members left and is disbanded.`,
        ]);
      }
      if (club.ownerId === interaction.user.id) {
        db.update(schema.clubs)
          .set({ ownerId: remaining[0]! })
          .where(eq(schema.clubs.id, club.id))
          .run();
      }
      // Remove them from the private thread (DB row already gone, so the
      // thread-guard listener won't re-add them).
      if (club.threadId) {
        const thread = await guild.channels.fetch(club.threadId).catch(() => null);
        if (thread?.isThread()) await thread.members.remove(interaction.user.id).catch(() => {});
      }
      await provisionForTier(guild, club);
      await syncDirectory(ctx.client);
      await postMessageToClubSpace(guild, club.id, "clubs.member-left", {
        user: `<@${interaction.user.id}>`,
        club: club.name,
      });
      return ack(interaction, Accent.success, "left club", [`you left **${club.name}**.`]);
    }

    if (sub === "kick") {
      const club = findClubByName(interaction.options.getString("club", true));
      if (!club) return ack(interaction, Accent.danger, "not found", ["no such club."]);
      const target = interaction.options.getUser("member", true);

      const member = interaction.member as GuildMember;
      const isOwner = club.ownerId === interaction.user.id;
      if (!isOwner && !isAdmin(member) && !isPresident(member, getConfig())) {
        return ack(interaction, Accent.danger, "forbidden", [
          "only the club owner (or an admin or president) can kick members.",
        ]);
      }
      if (target.id === club.ownerId) {
        return ack(interaction, Accent.warning, "can't kick owner", [
          "transfer ownership or terminate the club instead.",
        ]);
      }
      if (!clubMemberIds(club.id).includes(target.id)) {
        return ack(interaction, Accent.warning, "not a member", [
          `<@${target.id}> isn't in **${club.name}**.`,
        ]);
      }

      db.delete(schema.clubMembers)
        .where(
          and(
            eq(schema.clubMembers.clubId, club.id),
            eq(schema.clubMembers.userId, target.id),
          ),
        )
        .run();

      // Remove them from the club's private thread, if it has one.
      if (club.threadId) {
        const thread = await guild.channels.fetch(club.threadId).catch(() => null);
        if (thread?.isThread()) await thread.members.remove(target.id).catch(() => {});
      }

      await provisionForTier(guild, club);
      await syncDirectory(ctx.client);
      await postMessageToClubSpace(guild, club.id, "clubs.member-removed", {
        user: `<@${target.id}>`,
        club: club.name,
      });
      return ack(interaction, Accent.success, "member removed", [
        `<@${target.id}> was removed from **${club.name}**.`,
      ]);
    }

    if (sub === "info") {
      const club = findClubByName(interaction.options.getString("club", true));
      if (!club) return ack(interaction, Accent.danger, "not found", ["no such club."]);
      const members = clubMemberIds(club.id);
      return ack(interaction, Accent.club, club.name, [
        club.description || "no description.",
        `**status:** ${club.status} · **tier:** ${TIER_LABEL[club.level] ?? "—"}`,
        `**activity:** ${clubActivityScore(club.id)}/100`,
        `**owner:** <@${club.ownerId}>`,
        `**members (${members.length}):** ${members.map((id) => `<@${id}>`).join(", ")}`,
      ]);
    }

    if (sub === "edit") {
      const club = findClubByName(interaction.options.getString("club", true));
      if (!club) return ack(interaction, Accent.danger, "not found", ["no such club."]);
      const member = interaction.member as GuildMember;
      const isOwner = club.ownerId === interaction.user.id;
      if (!isOwner && !isAdmin(member) && !isPresident(member, getConfig())) {
        return ack(interaction, Accent.danger, "forbidden", [
          "only the club owner (or an admin or president) can edit this club.",
        ]);
      }
      const newName = interaction.options.getString("name")?.trim();
      const newDescription = interaction.options.getString("description")?.trim();
      if (!newName && newDescription === undefined) {
        return ack(interaction, Accent.warning, "nothing to change", [
          "give a new name, a new description, or both.",
        ]);
      }
      if (newName && newName !== club.name && findClubByName(newName)) {
        return ack(interaction, Accent.danger, "name taken", [
          "another club already has that name.",
        ]);
      }

      const updated = await editClub(guild, club.id, {
        name: newName,
        description: newDescription,
      });
      return ack(interaction, Accent.success, "club updated", [
        `**${updated?.name ?? club.name}** is updated.`,
      ]);
    }

    if (sub === "list") {
      await syncDirectory(ctx.client);
      const clubs = approvedClubs();
      return ack(interaction, Accent.club, "clubs", [
        clubs.length
          ? clubs.map((c) => `» **${c.name}** — ${clubMemberIds(c.id).length} members`).join("\n")
          : "no clubs yet.",
      ]);
    }

    if (sub === "announce") {
      const club = findClubByName(interaction.options.getString("club", true));
      if (!club || club.status !== "approved") {
        return ack(interaction, Accent.danger, "not found", ["no such approved club."]);
      }
      const member = interaction.member as GuildMember;
      const isOwner = club.ownerId === interaction.user.id;
      if (!isOwner && !isAdmin(member) && !isPresident(member, getConfig())) {
        return ack(interaction, Accent.danger, "forbidden", [
          "only the club owner (or an admin or president) can announce for this club.",
        ]);
      }

      const token = createAnnounceToken(club.id, interaction.user.id);
      const url = `${env.PUBLIC_URL}/club-announce/${token}`;

      return ack(interaction, Accent.club, "announcement composer", [
        `write and send an announcement for **${club.name}** here:`,
        url,
        "this link works once and expires in **15 minutes**.",
      ]);
    }

    if (sub === "terminate") {
      const member = interaction.member as GuildMember;
      if (!isAdmin(member) && !isPresident(member, getConfig())) {
        return ack(interaction, Accent.danger, "forbidden", [
          "only the president or an admin can terminate clubs.",
        ]);
      }
      const club = findClubByName(interaction.options.getString("club", true));
      if (!club) return ack(interaction, Accent.danger, "not found", ["no such club."]);
      await terminateClub(guild, club.id);
      return ack(interaction, Accent.warning, "club terminated", [
        `**${club.name}** is terminated.`,
      ]);
    }
  },
};

/** Founder-consent (DM) and admin approval (approval channel) buttons. */
const approval = defineListener({
  event: Events.InteractionCreate,
  async handle(ctx, interaction) {
    if (!interaction.isButton() || !interaction.customId.startsWith("club:")) return;
    const parts = interaction.customId.split(":");
    const kind = parts[1];

    // Admin approval needs an ephemeral permission check before we acknowledge.
    if (kind === "approve" || kind === "reject") {
      const member = interaction.member as GuildMember | null;
      if (!member || (!isAdmin(member) && !isPresident(member, getConfig()))) {
        await interaction.reply({
          content: "only the president or an admin can review club proposals.",
          flags: MessageFlags.Ephemeral,
        });
        return;
      }
    }

    // Acknowledge within the 3s window with a visible loading state (all
    // buttons disabled); the source message is edited afterwards.
    await ackButtonLoading(interaction);
    const edit = (accent: number, title: string, lines: string[] = []) =>
      interaction.editReply(v2(card({ accent, title, lines }))).catch(() => {});

    const handleAction = async () => {
      // --- Founder consent: club:fnd:yes|no:<id> (clicked in a DM) ---
      if (kind === "fnd") {
        const clubId = Number(parts[3]);
        const club = getClub(clubId);
        if (!club || club.status !== "draft") return void edit(Accent.warning, "this invitation expired");
        // Not a listed founder (e.g. removed after a cancel): the buttons are
        // already in the loading state, so resolve the message rather than
        // leaving it stuck.
        if (!clubMemberIds(clubId).includes(interaction.user.id))
          return void edit(Accent.warning, "this invitation expired");
        if (parts[2] === "no") {
          await edit(Accent.danger, "invitation declined");
          await cancelDraft(ctx.client, clubId, interaction.user.id);
          return;
        }
        const allIn = acceptFounder(clubId, interaction.user.id);
        if (allIn) await submitForApproval(ctx.client, clubId);
        await edit(Accent.success, "invitation accepted", [
          allIn
            ? "all founders are in. the club now waits for admin approval."
            : "waiting on the remaining founders.",
        ]);
        return;
      }

      // --- Invite consent: club:inv:yes|no:<id> (clicked in a DM) ---
      if (kind === "inv") {
        const clubId = Number(parts[3]);
        const club = getClub(clubId);
        if (!club || club.status !== "approved") return void edit(Accent.warning, "this invitation expired");
        if (parts[2] === "no") return void edit(Accent.danger, "invitation declined");
        if (clubMemberIds(clubId).includes(interaction.user.id))
          return void edit(Accent.warning, "you're already a member");
        if (userClubCount(interaction.user.id) >= MAX_CLUBS_PER_USER)
          return void edit(Accent.danger, `you're already in ${MAX_CLUBS_PER_USER} clubs`);
        const guild = await ctx.client.guilds.fetch(ctx.guildId).catch(() => null);
        if (guild) await addClubMember(guild, club, interaction.user.id);
        await edit(Accent.success, `welcome to ${club.name}`, ["you've joined the club."]);
        return;
      }

      // --- Admin approval: club:approve|reject:<id> (in the approval channel) ---
      const clubId = Number(parts[2]);
      const guild = interaction.guild as Guild;
      if (kind === "approve") {
        await approveClub(guild, clubId);
        await edit(Accent.success, "club approved");
      } else if (kind === "reject") {
        await rejectClub(ctx.client, clubId);
        await edit(Accent.danger, "club rejected");
      }
    };

    try {
      await handleAction();
    } catch (err) {
      console.error("[clubs] approval button failed:", err);
      await edit(Accent.danger, "something went wrong", ["try again."]);
    }
  },
});

/** Count messages in club channels/threads toward the club's activity score. */
const activity = defineListener({
  event: Events.MessageCreate,
  async handle(_ctx, message) {
    if (message.author.bot || !message.inGuild()) return;
    const club = findClubByChannel(message.channelId);
    if (club) bumpActivity(club.id);
  },
});

/**
 * Fledgling clubs live in a private thread. Two invariants:
 * - @-mentioning someone (or a role they hold) in a thread silently pulls them
 *   into it. Non-members who appear that way are removed immediately and DM'd
 *   that the ping was probably a mistake.
 * - If a still-enrolled member leaves that thread manually, pull them back in
 *   and DM them that the only way out is the `/club leave` command.
 */
const threadGuard = defineListener({
  event: Events.ThreadMembersUpdate,
  async handle(ctx, added, removed, thread) {
    if (added.size === 0 && removed.size === 0) return;
    const club = db
      .select()
      .from(schema.clubs)
      .where(and(eq(schema.clubs.threadId, thread.id), eq(schema.clubs.status, "approved")))
      .get();
    if (!club) return;

    const members = clubMemberIds(club.id);
    const adminRoleId = getConfig().clubAdminRoleId;

    for (const tm of added.values()) {
      if (members.includes(tm.id)) continue;
      const gm = await thread.guild.members.fetch(tm.id).catch(() => null);
      // Bots and clubAdminRoleId holders are added deliberately by syncClubAccess.
      if (!gm || gm.user.bot) continue;
      if (adminRoleId && gm.roles.cache.has(adminRoleId)) continue;
      await thread.members.remove(tm.id).catch(() => {});
      await gm.user
        .send(
          v2(
            card({
              accent: Accent.club,
              title: `removed from ${club.name}'s thread`,
              lines: [
                "you were probably pinged there by mistake. mentions add people to threads.",
                "you're not a member of that club, so you were removed again.",
              ],
            }),
          ),
        )
        .catch(() => {});
    }

    for (const tm of removed.values()) {
      if (!members.includes(tm.id)) continue; // left via command — let them go
      await thread.members.add(tm.id).catch(() => {});
      const user = await ctx.client.users.fetch(tm.id).catch(() => null);
      await user
        ?.send(
          v2(
            card({
              accent: Accent.club,
              title: `you're still a member of ${club.name}`,
              lines: [
                "you were added back to the club thread.",
                "to leave for real, use **`/club leave`**.",
              ],
            }),
          ),
        )
        .catch(() => {});
    }
  },
});

/**
 * Discord drops thread membership (and may leave stale/absent channel
 * overwrites) when a member leaves the guild. If they rejoin and are still
 * DB-enrolled in a club, re-provision their access instead of leaving them
 * silently locked out.
 */
const rejoinSync = defineListener({
  event: Events.GuildMemberAdd,
  async handle(_ctx, member) {
    const clubIds = db
      .select({ id: schema.clubMembers.clubId })
      .from(schema.clubMembers)
      .where(eq(schema.clubMembers.userId, member.id))
      .all()
      .map((r) => r.id);
    for (const clubId of clubIds) {
      const club = getClub(clubId);
      if (club?.status === "approved") await syncClubAccess(member.guild, club);
    }
  },
});

const plugin: Plugin = {
  name: "clubs",
  commands: [create],
  listeners: [approval, activity, threadGuard, rejoinSync],
  schedules: [
    { name: "club-daily-payout", cron: "0 0 * * *", run: () => runDailyPayout() },
  ],
  api: clubApiRoutes,
};

export default plugin;
