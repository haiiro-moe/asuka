import {
  type Client,
  type Guild,
  type TextChannel,
  type GuildMember,
} from "discord.js";
import { eq, desc, and, inArray } from "drizzle-orm";
import { env } from "../../config/env.ts";
import { db, schema, getConfig } from "../../db/index.ts";
import { nowSec } from "../../core/util.ts";
import { getCreditRank } from "../profile/stats.ts";
import { ensureMember } from "../../core/members.ts";
import { levelProgress } from "../xp/leveling.ts";
import {
  v2,
  Accent,
  ContainerBuilder,
  TextDisplayBuilder,
  pngAttachment,
  type AttachmentBuilder,
} from "../../core/components.ts";
import { announce, announceMessage } from "../../core/announce.ts";
import {
  renderTitleBannerPng,
  renderElectionProfileCardPng,
  renderElectionResultsPng,
  renderWinnerCardPng,
  fetchImageDataUri,
} from "../../core/images/index.tsx";

/** Emoji members react with to vote for a candidate. */
export const VOTE_EMOJI = "🗳️";
/** Candidate registration window before voting begins. */
export const REGISTRATION_PERIOD_SEC = 7 * 86400;
/** Voting window length once voting begins. */
export const VOTING_PERIOD_SEC = 7 * 86400;
/** Max back-to-back terms; a former president can always run again after a break. */
export const MAX_CONSECUTIVE_TERMS = 2;
/** Minimum guild membership age to stand as a candidate. */
export const MIN_ACTIVE_SEC = 7 * 86400;
/** President theme changes are limited to once per week. */
export const THEME_COOLDOWN_SEC = 7 * 86400;

type Election = typeof schema.elections.$inferSelect;

/** The current election in either phase (registration or voting), if any. */
export function getOpenElection(): Election | undefined {
  return db
    .select()
    .from(schema.elections)
    .where(inArray(schema.elections.status, ["registration", "open"]))
    .orderBy(desc(schema.elections.startsAt))
    .get();
}

export function getCandidates(electionId: number) {
  return db
    .select()
    .from(schema.candidates)
    .where(eq(schema.candidates.electionId, electionId))
    .all();
}

/** Purge recent messages from the election channel. */
async function cleanChannel(channel: TextChannel) {
  let deleted: number;
  do {
    const batch = await channel.bulkDelete(100, true).catch(() => null);
    deleted = batch?.size ?? 0;
  } while (deleted >= 2);
}

async function getElectionChannel(client: Client): Promise<TextChannel | null> {
  const id = getConfig().electionChannelId;
  if (!id) return null;
  const ch = await client.channels.fetch(id).catch(() => null);
  return ch?.isTextBased() && "bulkDelete" in ch ? (ch as TextChannel) : null;
}

/**
 * Components V2 payload with an image title banner and markdown body lines.
 * When banner rendering fails, falls back to the markdown title instead.
 */
async function bannerMessage(opts: {
  banner: string;
  fallbackTitle: string;
  accent: number;
  lines: string[];
}) {
  const png = await renderTitleBannerPng(opts.banner);
  const container = new ContainerBuilder().setAccentColor(opts.accent);
  const files: AttachmentBuilder[] = [];
  if (png) {
    const { file, gallery } = pngAttachment(png, "banner.png");
    files.push(file);
    container.addMediaGalleryComponents(gallery);
  } else {
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(opts.fallbackTitle));
  }
  if (opts.lines.length) {
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(opts.lines.join("\n")));
  }
  return { ...v2(container), files };
}

/** Open a fresh election: clean the channel and announce the candidacy window. */
export async function openElection(client: Client): Promise<Election | null> {
  const cfg = getConfig();
  if (!cfg.electionsEnabled || !cfg.electionChannelId) return null;
  if (getOpenElection()) return null; // one at a time

  const channel = await getElectionChannel(client);
  if (channel) await cleanChannel(channel);

  // A new term begins: strip the president role from everyone and clear the
  // sitting-president record so nobody holds the office during the election.
  if (cfg.presidentRoleId) {
    const guild = await client.guilds.fetch(env.GUILD_ID).catch(() => null);
    const members = guild ? await guild.members.fetch().catch(() => null) : null;
    if (members) {
      for (const m of members.values()) {
        if (m.roles.cache.has(cfg.presidentRoleId)) {
          await m.roles.remove(cfg.presidentRoleId).catch(() => {});
        }
      }
    }
    db.update(schema.president).set({ userId: null }).where(eq(schema.president.id, 1)).run();
  }

  const votingStartsAt = nowSec() + REGISTRATION_PERIOD_SEC;
  const endsAt = votingStartsAt + VOTING_PERIOD_SEC;
  const election = db
    .insert(schema.elections)
    .values({ status: "registration", channelId: cfg.electionChannelId, votingStartsAt, endsAt })
    .returning()
    .get();

  if (channel) {
    await channel.send(
      await bannerMessage({
        banner: "ELECTION OPEN",
        fallbackTitle: "## 🗳️ Student Council Election is OPEN",
        accent: Accent.election,
        lines: [
          `Use **/election apply** to stand as a candidate.`,
          `Registration closes and voting begins <t:${votingStartsAt}:R>.`,
          `Voting closes <t:${endsAt}:R>.`,
        ],
      }),
    );
  }
  return election;
}

/**
 * End the registration window: seed the vote reactions on every candidate
 * card and announce that voting is underway.
 */
export async function startVoting(client: Client, election: Election): Promise<void> {
  db.update(schema.elections)
    .set({ status: "open" })
    .where(eq(schema.elections.id, election.id))
    .run();

  const channel = await getElectionChannel(client);
  if (!channel) return;

  for (const candidate of getCandidates(election.id)) {
    if (!candidate.messageId) continue;
    const msg = await channel.messages.fetch(candidate.messageId).catch(() => null);
    await msg?.react(VOTE_EMOJI).catch(() => {});
  }

  await channel.send(
    await bannerMessage({
      banner: "VOTING OPEN",
      fallbackTitle: "## 🗳️ Voting is OPEN",
      accent: Accent.election,
      lines: [
        `Candidate registration has closed.`,
        `React with ${VOTE_EMOJI} on a candidate to vote.`,
        `Voting closes <t:${election.endsAt}:R>.`,
      ],
    }),
  );
}

/**
 * How many of the most recent closed elections this user won in an unbroken
 * run. A closed election won by someone else — or by nobody — breaks the run.
 */
export function consecutiveTermsFor(userId: string): number {
  const closed = db
    .select()
    .from(schema.elections)
    .where(eq(schema.elections.status, "closed"))
    .orderBy(desc(schema.elections.startsAt))
    .all();
  let streak = 0;
  for (const e of closed) {
    if (e.winnerId !== userId) break;
    streak++;
  }
  return streak;
}

/** Eligibility result for standing as a candidate. */
export function checkEligibility(member: GuildMember): string | null {
  const cfg = getConfig();
  if (cfg.presidentApplyMinRoleId) {
    const role = member.guild.roles.cache.get(cfg.presidentApplyMinRoleId);
    if (role && member.roles.highest.comparePositionTo(role) < 0) {
      return "You don't meet the minimum role requirement to run.";
    }
  }
  // Dev mode skips the membership-age gate so candidacy can be tested freshly.
  const joined = member.joinedTimestamp ? Math.floor(member.joinedTimestamp / 1000) : 0;
  if (!env.DEV && nowSec() - joined < MIN_ACTIVE_SEC) {
    return "You must be a member for at least a week before applying.";
  }
  if (consecutiveTermsFor(member.id) >= MAX_CONSECUTIVE_TERMS) {
    return `You've already served ${MAX_CONSECUTIVE_TERMS} back-to-back terms — sit this election out and you can run again next time.`;
  }
  return null;
}

/**
 * Build a candidate's election profile card: full image card (motto, vision,
 * stats, avatar) with the vote notice as text; text-only when rendering fails.
 */
export async function candidateProfile(
  member: GuildMember,
  motto: string,
  role: string,
  votingStartsAt?: number | null,
  sabotaged = false,
) {
  const m = ensureMember(member.id);
  const prog = levelProgress(m.xp);
  const rank = getCreditRank(member.id);

  const avatarDataUri = await fetchImageDataUri(
    member.displayAvatarURL({ extension: "png", size: 256, forceStatic: true }),
  );
  const png = await renderElectionProfileCardPng({
    displayName: member.displayName,
    avatarDataUri,
    rank,
    level: prog.level,
    credits: m.socialCredits,
    motto,
    vision: role,
    isCandidate: true,
    subtitle: "CANDIDATE",
    sabotaged,
  });

  const voteNotice =
    votingStartsAt && votingStartsAt > nowSec()
      ? `-# Voting opens <t:${votingStartsAt}:R> — react with ${VOTE_EMOJI} then!`
      : `-# React with ${VOTE_EMOJI} to vote!`;
  if (png) {
    const { file, gallery } = pngAttachment(png, `candidate-${member.id}.png`);
    const container = new ContainerBuilder()
      .setAccentColor(Accent.election)
      .addMediaGalleryComponents(gallery)
      .addTextDisplayComponents(new TextDisplayBuilder().setContent(voteNotice));
    return { ...v2(container), files: [file] };
  }

  return v2(
    new ContainerBuilder()
      .setAccentColor(Accent.election)
      .addTextDisplayComponents(
        new TextDisplayBuilder().setContent(`## 🗳️ Candidate: ${member.displayName}`),
        new TextDisplayBuilder().setContent(
          [
            `**Motto:** ${sabotaged ? "~~SABOTAGED~~" : motto}`,
            `**If elected:** ${sabotaged ? "~~SABOTAGED~~" : role}`,
            `**Leaderboard rank:** #${rank} · **Level:** ${prog.level} · **Credits:** ${m.socialCredits}`,
            "",
            voteNotice,
          ].join("\n"),
        ),
      ),
  );
}

/**
 * Re-render a candidate's posted profile card in place (e.g. when a silence
 * sabotage lands or lapses). Passing `attachments: []` drops the previous
 * upload so the old image doesn't linger next to the new one.
 */
export async function refreshCandidateCard(
  client: Client,
  electionId: number,
  userId: string,
  sabotaged: boolean,
): Promise<boolean> {
  const election = db
    .select()
    .from(schema.elections)
    .where(eq(schema.elections.id, electionId))
    .get();
  if (!election) return false;
  const candidate = db
    .select()
    .from(schema.candidates)
    .where(
      and(eq(schema.candidates.electionId, electionId), eq(schema.candidates.userId, userId)),
    )
    .get();
  if (!candidate?.messageId) return false;

  const channel = await getElectionChannel(client);
  if (!channel) return false;
  const msg = await channel.messages.fetch(candidate.messageId).catch(() => null);
  if (!msg) return false;

  const guild = await client.guilds.fetch(env.GUILD_ID).catch(() => null);
  const member = guild ? await guild.members.fetch(userId).catch(() => null) : null;
  if (!member) return false;

  const payload = await candidateProfile(
    member,
    candidate.motto,
    candidate.roleDescription,
    election.status === "registration" ? election.votingStartsAt : null,
    sabotaged,
  );
  await msg.edit({ ...payload, attachments: [] }).catch(() => {});
  return true;
}

/** Register a candidacy and post the profile, returning an error string or null. */
export async function applyCandidate(
  client: Client,
  member: GuildMember,
  motto: string,
  roleDescription: string,
): Promise<string | null> {
  const election = getOpenElection();
  if (!election) return "There is no open election right now.";
  if (election.status !== "registration") {
    return "Candidate registration has closed — voting is already underway.";
  }

  const existing = db
    .select()
    .from(schema.candidates)
    .where(
      and(
        eq(schema.candidates.electionId, election.id),
        eq(schema.candidates.userId, member.id),
      ),
    )
    .get();
  if (existing) return "You are already a candidate in this election.";

  const channel = await getElectionChannel(client);
  if (!channel) return "The election channel is not configured.";

  // The vote reaction is seeded by `startVoting` once registration ends.
  const msg = await channel.send(
    await candidateProfile(member, motto, roleDescription, election.votingStartsAt),
  );

  db.insert(schema.candidates)
    .values({
      electionId: election.id,
      userId: member.id,
      motto,
      roleDescription,
      messageId: msg.id,
    })
    .run();
  return null;
}

/**
 * The sitting president's winning candidacy (motto, vision, vote count).
 * Defined until the next election opens — `openElection` clears the president
 * record at that moment, so the saved election profile expires with the term.
 */
export function getPresidentCandidacy(userId: string) {
  const pres = db.select().from(schema.president).where(eq(schema.president.id, 1)).get();
  if (!pres?.userId || pres.userId !== userId) return undefined;
  const election = db
    .select()
    .from(schema.elections)
    .where(
      and(eq(schema.elections.status, "closed"), eq(schema.elections.winnerId, userId)),
    )
    .orderBy(desc(schema.elections.endsAt))
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

/** Current president record + theme cooldown state, for command and web use. */
export function getThemeStatus() {
  const cfg = getConfig();
  const pres = db.select().from(schema.president).where(eq(schema.president.id, 1)).get();
  const remaining = Math.max(
    0,
    THEME_COOLDOWN_SEC - (nowSec() - (pres?.lastThemeChangeAt ?? 0)),
  );
  return {
    userId: pres?.userId ?? null,
    termStart: pres?.termStart ?? null,
    lastThemeChangeAt: pres?.lastThemeChangeAt ?? 0,
    cooldownRemaining: remaining,
    template: cfg.serverNameTemplate,
  };
}

/**
 * Apply a weekly server theme change (name via the `%s` template and/or icon).
 * Enforces the once-per-week cooldown. Returns the applied changes or an error.
 */
export async function applyTheme(
  guild: Guild,
  opts: {
    name?: string | null;
    iconUrl?: string | null;
    actorId?: string;
    /**
     * Store-bought one-time theme access: skips the presidential weekly
     * cooldown and doesn't consume it either.
     */
    bypassCooldown?: boolean;
  },
): Promise<{ applied: string[] } | { error: string }> {
  const cfg = getConfig();
  const status = getThemeStatus();
  if (!opts.bypassCooldown && status.cooldownRemaining > 0) {
    return { error: `Theme is on cooldown for ${status.cooldownRemaining}s.` };
  }
  if (!opts.name && !opts.iconUrl) {
    return { error: "Provide a name and/or an icon." };
  }

  const applied: string[] = [];
  if (opts.name) {
    const newName = cfg.serverNameTemplate.replace("%s", opts.name);
    await guild.setName(newName);
    applied.push(`Name → ${newName}`);
  }
  if (opts.iconUrl) {
    // Fetch the icon ourselves (through remapInternalHost) rather than handing
    // the raw URL to guild.setIcon, which would have discord.js fetch it
    // directly and skip the LAN rewrite.
    const iconDataUri = await fetchImageDataUri(opts.iconUrl);
    if (!iconDataUri) return { error: "Could not fetch the icon image." };
    await guild.setIcon(iconDataUri);
    applied.push("Server icon updated");
  }

  if (!opts.bypassCooldown) {
    db.update(schema.president)
      .set({ lastThemeChangeAt: nowSec() })
      .where(eq(schema.president.id, 1))
      .run();
  }

  await announceMessage(guild.client, "elections.theme-updated", {
    actor: opts.actorId ? `<@${opts.actorId}>` : "the Student Council",
    changes: applied.join("\n"),
  });
  return { applied };
}

/** One completed term in office, derived from the elections table. */
export interface PresidencyTerm {
  userId: string;
  electionId: number;
  termStart: number;
  /** null while this term is still ongoing. */
  termEnd: number | null;
  votes: number;
}

/**
 * Full presidency history, oldest first. There is no dedicated history table —
 * every election is kept forever, and since only one election is ever open at
 * a time, each winner's term runs from the moment their election closed
 * (`elections.endsAt`, set in `closeElection`) until the next election opens
 * (that next election's `startsAt`, set in `openElection` at the same moment
 * the previous president's role is stripped).
 */
export function getPresidencyHistory(): PresidencyTerm[] {
  const all = db.select().from(schema.elections).orderBy(schema.elections.startsAt).all();
  const terms: PresidencyTerm[] = [];
  for (let i = 0; i < all.length; i++) {
    const e = all[i]!;
    if (!e.winnerId || e.endsAt == null) continue;
    const won = db
      .select()
      .from(schema.candidates)
      .where(
        and(eq(schema.candidates.electionId, e.id), eq(schema.candidates.userId, e.winnerId)),
      )
      .get();
    terms.push({
      userId: e.winnerId,
      electionId: e.id,
      termStart: e.endsAt,
      termEnd: all[i + 1]?.startsAt ?? null,
      votes: won?.voteCount ?? 0,
    });
  }
  return terms;
}

/** A single user's presidency history, oldest first. */
export function getPresidencyHistoryForUser(userId: string): PresidencyTerm[] {
  return getPresidencyHistory().filter((t) => t.userId === userId);
}

/** Tally votes, crown the winner, clean up, and close the election. */
export async function closeElection(guild: Guild, electionId: number) {
  const cfg = getConfig();
  const channel = await getElectionChannel(guild.client);
  const candidates = getCandidates(electionId);

  // Tally the vote-emoji reactions on each candidate's message.
  let winner: { userId: string; votes: number } | null = null;
  const tally: { userId: string; votes: number }[] = [];
  for (const candidate of candidates) {
    let votes = 0;
    if (channel && candidate.messageId) {
      const msg = await channel.messages.fetch(candidate.messageId).catch(() => null);
      const reaction = msg?.reactions.cache.find(
        (r) => r.emoji.name === VOTE_EMOJI,
      );
      votes = reaction ? Math.max(0, (reaction.count ?? 1) - 1) : 0; // minus the bot
    }
    db.update(schema.candidates)
      .set({ voteCount: votes })
      .where(eq(schema.candidates.id, candidate.id))
      .run();
    tally.push({ userId: candidate.userId, votes });
    if (!winner || votes > winner.votes) winner = { userId: candidate.userId, votes };
  }
  tally.sort((a, b) => b.votes - a.votes);

  db.update(schema.elections)
    .set({ status: "closed", winnerId: winner?.userId ?? null, endsAt: nowSec() })
    .where(eq(schema.elections.id, electionId))
    .run();

  // Assign the president role.
  if (winner && cfg.presidentRoleId) {
    const prev = db.select().from(schema.president).where(eq(schema.president.id, 1)).get();
    if (prev?.userId) {
      const prevMember = await guild.members.fetch(prev.userId).catch(() => null);
      await prevMember?.roles.remove(cfg.presidentRoleId).catch(() => {});
    }
    const newPres = await guild.members.fetch(winner.userId).catch(() => null);
    await newPres?.roles.add(cfg.presidentRoleId).catch(() => {});
  }
  if (winner) {
    db.update(schema.president)
      .set({ userId: winner.userId, termStart: nowSec(), lastThemeChangeAt: 0 })
      .where(eq(schema.president.id, 1))
      .run();
  }

  const winnerMember = winner
    ? await guild.members.fetch(winner.userId).catch(() => null)
    : null;
  const winnerName = winnerMember?.displayName ?? winner?.userId ?? "";
  const winnerAvatar = winnerMember
    ? await fetchImageDataUri(
        winnerMember.displayAvatarURL({ extension: "png", size: 256, forceStatic: true }),
      )
    : null;

  if (winner) {
    const png = await renderWinnerCardPng({
      displayName: winnerName,
      avatarDataUri: winnerAvatar,
      votes: winner.votes,
      title: "NEW PRESIDENT",
      message: `${winnerName} won the election with ${winner.votes} vote${winner.votes === 1 ? "" : "s"}!`,
    });
    await announce(guild.client, {
      accent: Accent.success,
      title: "🎉 New Student Council President",
      // Image-only when the card rendered; text fallback otherwise.
      lines: png
        ? []
        : [
            `Congratulations <@${winner.userId}> on winning the election with **${winner.votes}** vote(s)!`,
          ],
      image: png ? { buffer: png, name: "new-president.png" } : undefined,
    });
  }

  // Clean the channel and post the full results card (text-only on render failure).
  if (channel) {
    await cleanChannel(channel);
    const rows = await Promise.all(
      tally.map(async (t) => {
        const m = await guild.members.fetch(t.userId).catch(() => null);
        return { name: m?.displayName ?? t.userId, votes: t.votes };
      }),
    );
    const png = await renderElectionResultsPng({
      winner: winner ? { name: winnerName, avatarDataUri: winnerAvatar, votes: winner.votes } : null,
      rows,
      totalVotes: tally.reduce((sum, t) => sum + t.votes, 0),
    });
    if (png) {
      const { file, gallery } = pngAttachment(png, "election-results.png");
      await channel.send({
        ...v2(
          new ContainerBuilder().setAccentColor(Accent.success).addMediaGalleryComponents(gallery),
        ),
        files: [file],
      });
    } else {
      await channel.send(
        v2(
          new ContainerBuilder()
            .setAccentColor(Accent.success)
            .addTextDisplayComponents(
              new TextDisplayBuilder().setContent("## 🎉 Election results"),
              new TextDisplayBuilder().setContent(
                winner
                  ? `Congratulations <@${winner.userId}> — our new Student Council President with **${winner.votes}** vote(s)!`
                  : "No candidates stood. No president was elected.",
              ),
            ),
        ),
      );
    }
  }

  // DM the winner a celebration card.
  if (winner) {
    const user = await guild.client.users.fetch(winner.userId).catch(() => null);
    if (user) {
      const png = await renderWinnerCardPng({
        displayName: winnerName,
        avatarDataUri: winnerAvatar,
        votes: winner.votes,
      });
      const lines = [
        "You are the new **Student Council President**! 🎉",
        "You can now set the weekly server theme with **/theme**.",
      ];
      const container = new ContainerBuilder().setAccentColor(Accent.success);
      let files: AttachmentBuilder[] = [];
      if (png) {
        const { file, gallery } = pngAttachment(png, "winner.png");
        files = [file];
        container.addMediaGalleryComponents(gallery);
      } else {
        container.addTextDisplayComponents(
          new TextDisplayBuilder().setContent("## 🎉 Congratulations!"),
        );
      }
      container.addTextDisplayComponents(new TextDisplayBuilder().setContent(lines.join("\n")));
      // DMs can be closed — never let that fail the election close.
      await user
        .send({ ...v2(container), files })
        .catch((err) => console.error("[elections] winner DM failed:", err));
    }
  }
  return winner;
}
