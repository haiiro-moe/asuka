import {
  ChannelType,
  ButtonStyle,
  PermissionFlagsBits,
  OverwriteType,
  type Client,
  type Guild,
  type TextChannel,
  type CategoryChannel,
} from "discord.js";
import { eq, and, or, isNull } from "drizzle-orm";
import { db, schema, getConfig } from "../../db/index.ts";
import { addCredits } from "../../core/members.ts";
import { nowSec } from "../../core/util.ts";
import {
  v2,
  card,
  Accent,
  MessageFlags,
  ButtonBuilder,
  ContainerBuilder,
  TextDisplayBuilder,
  SeparatorBuilder,
} from "../../core/components.ts";
import { announce, announceMessage } from "../../core/announce.ts";
import { renderBotMessage, messageCtx } from "../../core/messages.ts";

export const MAX_CLUBS_PER_USER = 3;
export const MIN_FOUNDING_MEMBERS = 3;

type Club = typeof schema.clubs.$inferSelect;

/** Funding tier for a given member count. 6+ → 3, 5 → 2, 3-4 → 1, else 0. */
export function tierForSize(size: number): number {
  if (size >= 6) return 3;
  if (size === 5) return 2;
  if (size >= 3) return 1;
  return 0;
}

export const TIER_LABEL: Record<number, string> = {
  1: "Fledgling club",
  2: "Officially recognized club",
  3: "Supported club",
};

/** How many approved clubs a user currently belongs to. */
export function userClubCount(userId: string): number {
  return db
    .select()
    .from(schema.clubMembers)
    .innerJoin(schema.clubs, eq(schema.clubMembers.clubId, schema.clubs.id))
    .where(
      and(
        eq(schema.clubMembers.userId, userId),
        eq(schema.clubs.status, "approved"),
      ),
    )
    .all().length;
}

export function clubMemberIds(clubId: number): string[] {
  return db
    .select({ id: schema.clubMembers.userId })
    .from(schema.clubMembers)
    .where(eq(schema.clubMembers.clubId, clubId))
    .all()
    .map((r) => r.id);
}

export function findClubByName(name: string): Club | undefined {
  return db
    .select()
    .from(schema.clubs)
    .where(eq(schema.clubs.name, name))
    .get();
}

/** Find the approved club that owns a given channel/thread/voice channel. */
export function findClubByChannel(channelId: string): Club | undefined {
  return db
    .select()
    .from(schema.clubs)
    .where(
      and(
        eq(schema.clubs.status, "approved"),
        or(
          eq(schema.clubs.channelId, channelId),
          eq(schema.clubs.threadId, channelId),
          eq(schema.clubs.voiceChannelId, channelId),
        ),
      ),
    )
    .get();
}

/** Activity points decay with a 3-day half-life. */
export const ACTIVITY_HALF_LIFE_SEC = 3 * 86400;

function decayedAt(points: number, updatedAt: number, now: number): number {
  const elapsed = Math.max(0, now - updatedAt);
  return points * Math.pow(0.5, elapsed / ACTIVITY_HALF_LIFE_SEC);
}

/** Record `amount` messages of activity for a club (decay-then-increment). */
export function bumpActivity(clubId: number, amount = 1) {
  const now = nowSec();
  const club = db
    .select()
    .from(schema.clubs)
    .where(eq(schema.clubs.id, clubId))
    .get();
  if (!club) return;
  const points =
    decayedAt(club.activityPoints, club.activityUpdatedAt, now) + amount;
  db.update(schema.clubs)
    .set({ activityPoints: points, activityUpdatedAt: now, lastActiveAt: now })
    .where(eq(schema.clubs.id, clubId))
    .run();
}

/**
 * A club's 0–100 activity score: its decayed message activity relative to the
 * most active club on the server (the busiest club scores 100).
 */
export function clubActivityScore(clubId: number): number {
  const now = nowSec();
  let mine = 0;
  let max = 0;
  for (const c of approvedClubs()) {
    const p = decayedAt(c.activityPoints, c.activityUpdatedAt, now);
    if (c.id === clubId) mine = p;
    if (p > max) max = p;
  }
  return max <= 0 ? 0 : Math.round((100 * mine) / max);
}

export function approvedClubs(): Club[] {
  return db
    .select()
    .from(schema.clubs)
    .where(eq(schema.clubs.status, "approved"))
    .all();
}

/**
 * Create a draft club. The owner auto-accepts; the other founders must consent
 * before it advances to admin approval.
 */
export function createDraftClub(opts: {
  name: string;
  description: string;
  ownerId: string;
  memberIds: string[];
}): Club {
  const club = db
    .insert(schema.clubs)
    .values({
      name: opts.name,
      description: opts.description,
      ownerId: opts.ownerId,
      status: "draft",
      level: tierForSize(opts.memberIds.length),
    })
    .returning()
    .get();
  for (const userId of opts.memberIds) {
    db.insert(schema.clubMembers)
      .values({
        clubId: club.id,
        userId,
        accepted: userId === opts.ownerId ? 1 : 0,
      })
      .run();
  }
  return club;
}

export function getClub(clubId: number): Club | undefined {
  return db
    .select()
    .from(schema.clubs)
    .where(eq(schema.clubs.id, clubId))
    .get();
}

/** Founding members who have not yet accepted their invitation. */
export function pendingFounderIds(clubId: number): string[] {
  return db
    .select({ id: schema.clubMembers.userId })
    .from(schema.clubMembers)
    .where(
      and(
        eq(schema.clubMembers.clubId, clubId),
        eq(schema.clubMembers.accepted, 0),
      ),
    )
    .all()
    .map((r) => r.id);
}

/** Mark a founder as having accepted. Returns true if all founders are now in. */
export function acceptFounder(clubId: number, userId: string): boolean {
  db.update(schema.clubMembers)
    .set({ accepted: 1 })
    .where(
      and(
        eq(schema.clubMembers.clubId, clubId),
        eq(schema.clubMembers.userId, userId),
      ),
    )
    .run();
  return pendingFounderIds(clubId).length === 0;
}

/**
 * Add a user to an approved club and reconcile resources/access. Caller is
 * responsible for membership/cap checks. Shared by join + invite flows.
 */
export async function addClubMember(guild: Guild, club: Club, userId: string) {
  db.insert(schema.clubMembers)
    .values({ clubId: club.id, userId, accepted: 1 })
    .run();
  db.update(schema.clubs)
    .set({ lastActiveAt: nowSec() })
    .where(eq(schema.clubs.id, club.id))
    .run();
  await provisionForTier(guild, club);
  await syncDirectory(guild.client);
  await postMessageToClubSpace(guild, club.id, "clubs.member-joined", {
    user: `<@${userId}>`,
    club: club.name,
  });
}

const ANNOUNCE_TOKEN_TTL_SEC = 15 * 60;

/** Create a fresh one-time announce token for a club, valid 15 minutes. */
export function createAnnounceToken(clubId: number, userId: string): string {
  const token = crypto.randomUUID();
  db.insert(schema.clubAnnounceTokens)
    .values({
      token,
      clubId,
      userId,
      expiresAt: nowSec() + ANNOUNCE_TOKEN_TTL_SEC,
    })
    .run();
  return token;
}

type AnnounceTokenRow = typeof schema.clubAnnounceTokens.$inferSelect;

/** Look up a token's row without consuming it (for the GET info endpoint). */
export function peekAnnounceToken(
  token: string,
):
  | { row: AnnounceTokenRow; valid: true }
  | { row: AnnounceTokenRow; valid: false; reason: "used" | "expired" }
  | null {
  const row = db
    .select()
    .from(schema.clubAnnounceTokens)
    .where(eq(schema.clubAnnounceTokens.token, token))
    .get();
  if (!row) return null;
  if (row.usedAt !== null) return { row, valid: false, reason: "used" };
  if (row.expiresAt < nowSec()) return { row, valid: false, reason: "expired" };
  return { row, valid: true };
}

/** Atomically consume a token: valid only if unused and unexpired; marks it used. */
export function consumeAnnounceToken(token: string): AnnounceTokenRow | null {
  const now = nowSec();
  const result = db
    .update(schema.clubAnnounceTokens)
    .set({ usedAt: now })
    .where(
      and(
        eq(schema.clubAnnounceTokens.token, token),
        isNull(schema.clubAnnounceTokens.usedAt),
      ),
    )
    .returning()
    .get();
  if (!result || result.expiresAt < now) return null;
  return result;
}

/**
 * A single Components V2 text element identifying which club an announcement
 * came from, prepended to the DM copy only (the channel copy is already
 * unambiguous — it's posted in the club's own channel/thread).
 */
export function announceHeader(clubName: string): unknown {
  return { type: 10, content: `-# 📢 Announcement from ${clubName}` };
}

/**
 * Post an arbitrary Components V2 payload (from the web announce composer) to
 * a club's current text space and pin it. Unlike `postToClubSpace`, the
 * caller supplies the raw components array rather than a title+lines template.
 */
export async function postRawToClubSpaceAndPin(
  guild: Guild,
  clubId: number,
  components: unknown[],
): Promise<boolean> {
  const club = getClub(clubId);
  const channelId = club?.channelId ?? club?.threadId;
  if (!channelId) return false;
  const ch = await guild.channels.fetch(channelId).catch(() => null);
  if (!ch?.isTextBased() || !("send" in ch)) return false;
  const message = await (ch as TextChannel)
    .send({
      flags: MessageFlags.IsComponentsV2,
      components: components as never,
      allowedMentions: { parse: [] },
    })
    .catch(() => null);
  if (!message) return false;
  await message.pin().catch(() => {});
  return true;
}

/** DM an arbitrary Components V2 payload to every club member (no pinning). */
export async function dmRawToClubMembers(
  client: Client,
  clubId: number,
  components: unknown[],
) {
  for (const userId of clubMemberIds(clubId)) {
    const user = await client.users.fetch(userId).catch(() => null);
    await user
      ?.send({
        flags: MessageFlags.IsComponentsV2,
        components: components as never,
        allowedMentions: { parse: [] },
      })
      .catch(() => {});
  }
}

/** Post a Components V2 card to a club's current text space (channel or thread). */
export async function postToClubSpace(
  guild: Guild,
  clubId: number,
  accent: number,
  title: string,
  lines: string[],
) {
  await postPayloadToClubSpace(guild, clubId, v2(card({ accent, title, lines })));
}

/** Send a registry-rendered message (renderBotMessage) to a club's text space. */
export async function postMessageToClubSpace(
  guild: Guild,
  clubId: number,
  key: string,
  params: Record<string, string | number>,
) {
  await postPayloadToClubSpace(
    guild,
    clubId,
    await renderBotMessage(key, messageCtx(guild.client), params),
  );
}

async function postPayloadToClubSpace(guild: Guild, clubId: number, payload: object) {
  const club = getClub(clubId);
  const channelId = club?.channelId ?? club?.threadId;
  if (!channelId) return;
  const ch = await guild.channels.fetch(channelId).catch(() => null);
  if (ch?.isTextBased() && "send" in ch) {
    await (ch as TextChannel).send(payload as never).catch(() => {});
  }
}

/** DM every founding member of a club a Components V2 card. */
export async function notifyFounders(
  client: Client,
  clubId: number,
  opts: { accent?: number; title: string; lines: string[] },
) {
  await notifyFoundersPayload(client, clubId, v2(buildCard(opts)));
}

/** DM every founding member a registry-rendered (web-editable) message. */
export async function notifyFoundersMessage(
  client: Client,
  clubId: number,
  key: string,
  params: Record<string, string | number>,
) {
  await notifyFoundersPayload(
    client,
    clubId,
    await renderBotMessage(key, messageCtx(client), params),
  );
}

async function notifyFoundersPayload(client: Client, clubId: number, payload: object) {
  for (const userId of clubMemberIds(clubId)) {
    const user = await client.users.fetch(userId).catch(() => null);
    await user?.send(payload as never).catch(() => {});
  }
}

function buildCard(opts: { accent?: number; title: string; lines: string[] }) {
  const container = new ContainerBuilder().setAccentColor(
    opts.accent ?? Accent.club,
  );
  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(`## ${opts.title}`),
  );
  if (opts.lines.length)
    container.addTextDisplayComponents(
      new TextDisplayBuilder().setContent(opts.lines.join("\n")),
    );
  return container;
}

/**
 * All founders have consented: move the club to `pending` and post it to the
 * admin approval channel with Approve/Reject buttons.
 */
export async function submitForApproval(client: Client, clubId: number) {
  db.update(schema.clubs)
    .set({ status: "pending" })
    .where(eq(schema.clubs.id, clubId))
    .run();
  const club = getClub(clubId);
  if (!club) return;

  const channelId = getConfig().approvalChannelId;
  if (!channelId) {
    console.warn(
      "[clubs] approvalChannelId not configured; cannot post proposal",
    );
    return;
  }
  const channel = await client.channels.fetch(channelId).catch(() => null);
  if (!channel?.isTextBased() || !("send" in channel)) return;

  const founders = clubMemberIds(clubId);
  await (channel as TextChannel).send({
    ...v2(
      card({
        accent: Accent.club,
        title: `🆕 Club proposal: ${club.name}`,
        lines: [
          club.description,
          `**Owner:** <@${club.ownerId}>`,
          `**Founders:** ${founders.map((id) => `<@${id}>`).join(", ")}`,
        ],
        buttons: [
          new ButtonBuilder()
            .setCustomId(`club:approve:${club.id}`)
            .setLabel("Approve")
            .setStyle(ButtonStyle.Success),
          new ButtonBuilder()
            .setCustomId(`club:reject:${club.id}`)
            .setLabel("Reject")
            .setStyle(ButtonStyle.Danger),
        ],
      }),
    ),
    flags: MessageFlags.IsComponentsV2,
  });
}

/** Reject a pending club: notify the founders, then delete the proposal. */
export async function rejectClub(client: Client, clubId: number) {
  const club = getClub(clubId);
  if (!club) return;
  await notifyFoundersMessage(client, clubId, "clubs.rejected-dm", { club: club.name });
  db.delete(schema.clubs).where(eq(schema.clubs.id, clubId)).run();
}

/** A founder declined: notify everyone and discard the draft. */
export async function cancelDraft(
  client: Client,
  clubId: number,
  declinerId: string,
) {
  const club = getClub(clubId);
  if (!club) return;
  await notifyFoundersMessage(client, clubId, "clubs.cancelled-dm", {
    club: club.name,
    user: `<@${declinerId}>`,
  });
  db.delete(schema.clubs).where(eq(schema.clubs.id, clubId)).run();
}

async function getCategory(guild: Guild): Promise<CategoryChannel | null> {
  const id = getConfig().clubCategoryId;
  if (!id) return null;
  const ch = await guild.channels.fetch(id).catch(() => null);
  return ch?.type === ChannelType.GuildCategory
    ? (ch as CategoryChannel)
    : null;
}

async function getListingChannel(guild: Guild): Promise<TextChannel | null> {
  const id = getConfig().clubListingChannelId;
  if (!id) return null;
  const ch = await guild.channels.fetch(id).catch(() => null);
  return ch?.isTextBased() && "threads" in ch ? (ch as TextChannel) : null;
}

/**
 * Archive a club channel on downgrade: strip all member overwrites, deny
 * @everyone, and leave only the club-admin role with access. The channel and
 * its history are preserved (just locked down) rather than deleted.
 */
async function archiveChannel(guild: Guild, channelId: string) {
  const ch = await guild.channels.fetch(channelId).catch(() => null);
  if (!ch || !("permissionOverwrites" in ch)) return;
  const botId = guild.members.me?.id;
  for (const [id, ow] of ch.permissionOverwrites.cache) {
    if (ow.type === OverwriteType.Member && id !== botId) {
      await ow.delete().catch(() => {});
    }
  }
  await ch.permissionOverwrites
    .edit(guild.roles.everyone, { ViewChannel: false })
    .catch(() => {});
  const adminRoleId = getConfig().clubAdminRoleId;
  if (adminRoleId) {
    await ch.permissionOverwrites
      .edit(adminRoleId, { ViewChannel: true, Connect: true })
      .catch(() => {});
  }
  if (!ch.name.startsWith("🗄")) await ch.setName(`🗄${ch.name}`).catch(() => {});
}

/** Un-archive a previously archived channel/voice. Returns false if it's gone. */
async function restoreChannel(
  guild: Guild,
  channelId: string,
  name: string,
): Promise<boolean> {
  const ch = await guild.channels.fetch(channelId).catch(() => null);
  if (!ch || !("setName" in ch)) return false;
  await ch.setName(name).catch(() => {}); // permissions are re-applied by syncClubAccess
  return true;
}

/** Un-archive + unlock a previously retired thread. Returns false if it's gone. */
async function restoreThread(
  guild: Guild,
  threadId: string,
  name: string,
): Promise<boolean> {
  const th = await guild.channels.fetch(threadId).catch(() => null);
  if (!th?.isThread()) return false;
  await th.setArchived(false).catch(() => {});
  await th.setLocked(false).catch(() => {});
  await th.setName(name).catch(() => {});
  return true;
}

/**
 * Reconcile a club's provisioned Discord resources with its current member
 * tier. Tier 1 → private thread; tier 2 → category text channel; tier 3 → text
 * + voice channel. Resources for tiers a club has dropped out of are archived
 * (locked, not deleted), and tier changes are announced in the club's spaces.
 */
export async function provisionForTier(guild: Guild, club: Club) {
  const size = clubMemberIds(club.id).length;
  const tier = tierForSize(size);
  const oldTier = club.level;
  const updates: Partial<Club> = { level: tier };

  const listing = await getListingChannel(guild);
  const category = await getCategory(guild);

  const notify = async (
    channelId: string | null,
    accent: number,
    title: string,
    lines: string[],
  ) => {
    if (!channelId) return;
    const ch = await guild.channels.fetch(channelId).catch(() => null);
    if (ch?.isTextBased() && "send" in ch) {
      await (ch as TextChannel)
        .send(v2(card({ accent, title, lines: lines.filter(Boolean) })))
        .catch(() => {});
    }
  };

  // --- Phase 1: provide resources for the new tier, reusing archived ones. ---
  if (tier >= 2 && !club.channelId) {
    if (
      club.archivedChannelId &&
      (await restoreChannel(guild, club.archivedChannelId, club.name))
    ) {
      updates.channelId = club.archivedChannelId;
      updates.archivedChannelId = null;
    } else if (category) {
      const channel = await guild.channels.create({
        name: club.name,
        type: ChannelType.GuildText,
        parent: category.id,
        topic: club.description,
        permissionOverwrites: [
          {
            id: guild.roles.everyone.id,
            deny: [PermissionFlagsBits.ViewChannel],
          },
        ],
      });
      updates.channelId = channel.id;
      updates.archivedChannelId = null;
    }
  }
  if (tier >= 3 && !club.voiceChannelId) {
    if (
      club.archivedVoiceChannelId &&
      (await restoreChannel(
        guild,
        club.archivedVoiceChannelId,
        `${club.name} VC`,
      ))
    ) {
      updates.voiceChannelId = club.archivedVoiceChannelId;
      updates.archivedVoiceChannelId = null;
    } else if (category) {
      const voice = await guild.channels.create({
        name: `${club.name} VC`,
        type: ChannelType.GuildVoice,
        parent: category.id,
        permissionOverwrites: [
          {
            id: guild.roles.everyone.id,
            deny: [
              PermissionFlagsBits.ViewChannel,
              PermissionFlagsBits.Connect,
            ],
          },
        ],
      });
      updates.voiceChannelId = voice.id;
      updates.archivedVoiceChannelId = null;
    }
  }
  if (tier <= 1 && !club.threadId) {
    if (
      club.archivedThreadId &&
      (await restoreThread(guild, club.archivedThreadId, club.name))
    ) {
      updates.threadId = club.archivedThreadId;
      updates.archivedThreadId = null;
    } else if (listing) {
      const thread = await listing.threads.create({
        name: club.name,
        type: ChannelType.PrivateThread,
        invitable: false,
      });
      for (const userId of clubMemberIds(club.id)) {
        await thread.members.add(userId).catch(() => {});
      }
      updates.threadId = thread.id;
      updates.archivedThreadId = null;
    }
  }

  const channelId = updates.channelId ?? club.channelId;
  const voiceId = updates.voiceChannelId ?? club.voiceChannelId;
  const threadId = updates.threadId ?? club.threadId;

  // --- Phase 2: announce tier changes while the old spaces are still open. ---
  if (tier > oldTier && oldTier <= 1 && tier >= 2) {
    await notify(club.threadId, Accent.success, "📈 Club upgraded!", [
      `**${club.name}** is now a **${TIER_LABEL[tier]}**.`,
      channelId ? `Continue in your new channel: <#${channelId}>` : "",
    ]);
    await notify(channelId, Accent.success, `Welcome to ${club.name}! 🎉`, [
      `Your club is now a **${TIER_LABEL[tier]}**.`,
      voiceId ? `Voice channel: <#${voiceId}>` : "",
    ]);
  } else if (tier > oldTier && tier >= 3) {
    await notify(channelId, Accent.success, "📈 Club upgraded!", [
      `**${club.name}** is now a **${TIER_LABEL[tier]}** with a voice channel: <#${voiceId}>`,
    ]);
  } else if (tier < oldTier && tier <= 1) {
    await notify(club.channelId, Accent.warning, "📉 Club downgraded", [
      `**${club.name}** dropped to **${TIER_LABEL[tier] ?? "inactive"}**. This channel is being archived.`,
      threadId ? `Continue in your thread: <#${threadId}>` : "",
    ]);
    await notify(threadId, Accent.warning, "📉 Club downgraded", [
      `**${club.name}** has moved back to a private thread.`,
    ]);
  } else if (tier < oldTier && tier === 2) {
    await notify(channelId, Accent.warning, "📉 Club downgraded", [
      `**${club.name}** dropped to **${TIER_LABEL[tier]}**. The voice channel has been archived.`,
    ]);
  }

  // --- Phase 3: retire resources the new tier no longer uses (archived for reuse). ---
  if (tier >= 2 && club.threadId) {
    // Lock + archive the fledgling thread (preserve history).
    const thread = await guild.channels.fetch(club.threadId).catch(() => null);
    if (thread?.isThread()) {
      await thread.setLocked(true).catch(() => {});
      await thread.setArchived(true).catch(() => {});
    }
    updates.archivedThreadId = club.threadId;
    updates.threadId = null;
  }
  if (tier === 2 && club.voiceChannelId) {
    await archiveChannel(guild, club.voiceChannelId);
    updates.archivedVoiceChannelId = club.voiceChannelId;
    updates.voiceChannelId = null;
  }
  if (tier <= 1) {
    if (club.channelId) {
      await archiveChannel(guild, club.channelId);
      updates.archivedChannelId = club.channelId;
      updates.channelId = null;
    }
    if (club.voiceChannelId) {
      await archiveChannel(guild, club.voiceChannelId);
      updates.archivedVoiceChannelId = club.voiceChannelId;
      updates.voiceChannelId = null;
    }
  }

  const merged = db
    .update(schema.clubs)
    .set(updates)
    .where(eq(schema.clubs.id, club.id))
    .returning()
    .get();

  // Make sure every current member (founders + owner) has access to whatever
  // space the club has, and revoke access for anyone no longer a member.
  await syncClubAccess(guild, merged);
  return merged;
}

/**
 * Apply edited name/description to a club's channels: rename the text/voice
 * channel and thread, and set the channel topic to the description.
 */
export async function editClub(
  guild: Guild,
  clubId: number,
  changes: { name?: string; description?: string },
) {
  const club = getClub(clubId);
  if (!club) return null;
  const patch: Partial<Club> = {};
  if (changes.name) patch.name = changes.name;
  if (changes.description !== undefined)
    patch.description = changes.description;
  if (Object.keys(patch).length) {
    db.update(schema.clubs).set(patch).where(eq(schema.clubs.id, clubId)).run();
  }
  const updated = getClub(clubId)!;

  if (updated.channelId) {
    const ch = await guild.channels.fetch(updated.channelId).catch(() => null);
    if (ch?.type === ChannelType.GuildText) {
      await ch.setName(updated.name).catch(() => {});
      await ch.setTopic(updated.description).catch(() => {});
    }
  }
  if (updated.threadId) {
    const th = await guild.channels.fetch(updated.threadId).catch(() => null);
    if (th?.isThread()) await th.setName(updated.name).catch(() => {});
  }
  if (updated.voiceChannelId) {
    const vc = await guild.channels
      .fetch(updated.voiceChannelId)
      .catch(() => null);
    if (vc && "setName" in vc)
      await vc.setName(`${updated.name} VC`).catch(() => {});
  }
  await syncDirectory(guild.client);
  return updated;
}

/**
 * Reconcile channel/thread access with the club's membership: add every member
 * (the owner is a member) to the private thread and grant them channel/voice
 * permission overwrites; strip overwrites for users who have left.
 */
export async function syncClubAccess(guild: Guild, club: Club) {
  const members = clubMemberIds(club.id);
  const adminRoleId = getConfig().clubAdminRoleId;

  if (club.threadId) {
    const thread = await guild.channels.fetch(club.threadId).catch(() => null);
    if (thread?.isThread() && !thread.archived) {
      for (const id of members) await thread.members.add(id).catch(() => {});
      // Threads can't carry role overwrites, so add the admin role's members.
      const adminRole = adminRoleId ? guild.roles.cache.get(adminRoleId) : null;
      for (const m of adminRole?.members.values() ?? []) {
        await thread.members.add(m.id).catch(() => {});
      }
    }
  }

  const grantAccess = async (
    channelId: string | null,
    memberOpts: Record<string, boolean>,
    ownerOpts: Record<string, boolean>,
    adminOpts: Record<string, boolean>,
    everyoneOpts: Record<string, boolean>,
  ) => {
    if (!channelId) return;
    const ch = await guild.channels.fetch(channelId).catch(() => null);
    if (!ch || !("permissionOverwrites" in ch)) return;
    await ch.permissionOverwrites
      .edit(guild.roles.everyone, everyoneOpts)
      .catch(() => {});
    for (const id of members) {
      await ch.permissionOverwrites
        .edit(id, id === club.ownerId ? ownerOpts : memberOpts)
        .catch(() => {});
    }
    // The club-admin role gets oversight access to every club channel.
    if (adminRoleId) {
      await ch.permissionOverwrites
        .edit(adminRoleId, adminOpts)
        .catch(() => {});
    }
    // Remove stale member overwrites for users who have left the club.
    const botId = guild.members.me?.id;
    for (const [id, ow] of ch.permissionOverwrites.cache) {
      if (
        ow.type === OverwriteType.Member &&
        id !== botId &&
        !members.includes(id)
      ) {
        await ow.delete().catch(() => {});
      }
    }
  };

  // Text channel: the owner can pin/manage messages and create/manage threads;
  // regular members can view and chat but cannot create threads.
  await grantAccess(
    club.channelId,
    {
      ViewChannel: true,
      ManageMessages: false,
      ManageThreads: false,
      CreatePublicThreads: false,
      CreatePrivateThreads: false,
    },
    {
      ViewChannel: true,
      ManageMessages: true,
      ManageThreads: true,
      CreatePublicThreads: true,
      CreatePrivateThreads: true,
    },
    { ViewChannel: true, ManageMessages: true, ManageThreads: true },
    {
      ViewChannel: false,
      CreatePublicThreads: false,
      CreatePrivateThreads: false,
    },
  );

  // Voice channel: the owner can mute, deafen and disconnect (kick) members.
  await grantAccess(
    club.voiceChannelId,
    {
      ViewChannel: true,
      Connect: true,
      MuteMembers: false,
      DeafenMembers: false,
      MoveMembers: false,
    },
    {
      ViewChannel: true,
      Connect: true,
      MuteMembers: true,
      DeafenMembers: true,
      MoveMembers: true,
    },
    {
      ViewChannel: true,
      Connect: true,
      MuteMembers: true,
      DeafenMembers: true,
      MoveMembers: true,
    },
    { ViewChannel: false, Connect: false },
  );
}

/** Approve a pending club and provision its resources. */
export async function approveClub(guild: Guild, clubId: number) {
  db.update(schema.clubs)
    .set({ status: "approved", lastActiveAt: nowSec() })
    .where(eq(schema.clubs.id, clubId))
    .run();
  const club = db
    .select()
    .from(schema.clubs)
    .where(eq(schema.clubs.id, clubId))
    .get();
  if (!club) return null;
  const provisioned = await provisionForTier(guild, club);
  await syncDirectory(guild.client);
  await announceMessage(guild.client, "clubs.approved-announcement", {
    club: club.name,
    owner: `<@${club.ownerId}>`,
    description: club.description,
  });
  await notifyFoundersMessage(guild.client, clubId, "clubs.approved-dm", {
    club: club.name,
    space: provisioned?.threadId
      ? `Your club thread: <#${provisioned.threadId}>`
      : provisioned?.channelId
        ? `Your club channel: <#${provisioned.channelId}>`
        : "",
  });
  return provisioned;
}

/** Terminate a club: tear down its channels and mark it terminated. */
export async function terminateClub(guild: Guild, clubId: number) {
  const club = db
    .select()
    .from(schema.clubs)
    .where(eq(schema.clubs.id, clubId))
    .get();
  if (!club) return;
  for (const id of [
    club.threadId,
    club.channelId,
    club.voiceChannelId,
    club.archivedThreadId,
    club.archivedChannelId,
    club.archivedVoiceChannelId,
  ]) {
    if (!id) continue;
    const ch = await guild.channels.fetch(id).catch(() => null);
    if (ch) await ch.delete().catch(() => {});
  }
  db.update(schema.clubs)
    .set({
      status: "terminated",
      threadId: null,
      channelId: null,
      voiceChannelId: null,
      archivedThreadId: null,
      archivedChannelId: null,
      archivedVoiceChannelId: null,
    })
    .where(eq(schema.clubs.id, clubId))
    .run();
  await syncDirectory(guild.client);
  await announceMessage(guild.client, "clubs.terminated-announcement", {
    club: club.name,
  });
}

/** Rebuild (or create) the directory message in the listing channel. */
export async function syncDirectory(client: Client) {
  const cfg = getConfig();
  if (!cfg.clubListingChannelId) return;
  const channel = await client.channels
    .fetch(cfg.clubListingChannelId)
    .catch(() => null);
  if (!channel?.isTextBased() || !("send" in channel)) return;

  const clubs = approvedClubs();
  const container = new ContainerBuilder()
    .setAccentColor(Accent.club)
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent("## 📋 Club Directory"),
    );

  if (clubs.length === 0) {
    container.addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        "No clubs yet. Use `/club create` to start one!",
      ),
    );
  } else {
    for (const club of clubs) {
      const size = clubMemberIds(club.id).length;
      const ref = club.channelId
        ? `<#${club.channelId}>`
        : club.threadId
          ? `<#${club.threadId}>`
          : "_provisioning…_";
      const voice = club.voiceChannelId
        ? ` · 🔊 <#${club.voiceChannelId}>`
        : "";
      container.addSeparatorComponents(new SeparatorBuilder().setDivider(true));
      container.addTextDisplayComponents(
        new TextDisplayBuilder().setContent(
          `**${club.name}** — ${TIER_LABEL[club.level] ?? "Club"} (${size} members)\n` +
            `${ref}${voice}\n-# ${club.description || "No description"}`,
        ),
      );
    }
  }

  const payload = v2(container);
  const existingId = getConfig().clubDirectoryMessageId;
  if (existingId) {
    const msg = await (channel as TextChannel).messages
      .fetch(existingId)
      .catch(() => null);
    if (msg) {
      await msg.edit(payload).catch(() => {});
      return;
    }
  }
  const sent = await (channel as TextChannel).send(payload);
  db.update(schema.guildConfig)
    .set({ clubDirectoryMessageId: sent.id })
    .where(eq(schema.guildConfig.id, 1))
    .run();
}

/**
 * Daily payout: every member of every approved club earns credits equal to the
 * club's size, so larger and more active clubs reward their members more.
 */
export function runDailyPayout() {
  for (const club of approvedClubs()) {
    const members = clubMemberIds(club.id);
    for (const userId of members) addCredits(userId, members.length);
  }
}
