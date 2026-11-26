import { eq, desc } from "drizzle-orm";
import { db, schema, getConfig } from "../db/index.ts";
import type { ApiRoute } from "../core/plugin.ts";
import {
  approveClub,
  terminateClub,
  clubMemberIds,
  clubActivityScore,
  approvedClubs,
  getClub,
  TIER_LABEL,
} from "../plugins/clubs/service.ts";
import {
  openElection,
  closeElection,
  getOpenElection,
  getThemeStatus,
  applyTheme,
  getPresidencyHistory,
  getPresidencyHistoryForUser,
} from "../plugins/elections/service.ts";
import {
  getCreditRank,
  getMemberClubs,
  levelProgress,
} from "../plugins/profile/stats.ts";
import { messageRoutes } from "./message-routes.ts";

/** Columns the dashboard is allowed to update on the singleton config row. */
const EDITABLE_CONFIG = new Set<string>([
  "starboardChannelId",
  "clubListingChannelId",
  "clubCategoryId",
  "electionChannelId",
  "modLogChannelId",
  "levelUpChannelId",
  "announcementChannelId",
  "approvalChannelId",
  "eventsChannelId",
  "presidentRoleId",
  "clubCreateMinRoleId",
  "presidentApplyMinRoleId",
  "clubAdminRoleId",
  "starboardEmoji",
  "starboardThreshold",
  "starboardCreditMin",
  "starboardCreditMax",
  "xpMessageMin",
  "xpMessageMax",
  "xpMessageCooldownSec",
  "xpVoicePerMinute",
  "creditRewardMin",
  "creditRewardMax",
  "creditWindowMin",
  "creditWindowMax",
  "serverNameTemplate",
  "moderationEnabled",
  "autoreplyEnabled",
  "starboardEnabled",
  "xpEnabled",
  "economyEnabled",
  "clubsEnabled",
  "electionsEnabled",
  "eventsEnabled",
  "linkFixerEnabled",
  "linkFixerDisabledPlatforms",
  "activityEnabled",
  "activityExcludedChannelIds",
]);

const getConfigRoute: ApiRoute = {
  method: "GET",
  path: "/api/config",
  access: "admin",
  handle: () => Response.json(getConfig()),
};

const updateConfigRoute: ApiRoute = {
  method: "PUT",
  path: "/api/config",
  access: "admin",
  async handle(req) {
    const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body) return Response.json({ error: "invalid body" }, { status: 400 });
    const patch: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(body)) {
      if (EDITABLE_CONFIG.has(key)) patch[key] = value;
    }
    if (Object.keys(patch).length === 0) {
      return Response.json({ error: "no editable fields" }, { status: 400 });
    }
    patch.updatedAt = Math.floor(Date.now() / 1000);
    db.update(schema.guildConfig).set(patch).where(eq(schema.guildConfig.id, 1)).run();
    return Response.json(getConfig());
  },
};

const leaderboardRoute: ApiRoute = {
  method: "GET",
  path: "/api/leaderboard",
  access: "user",
  handle: () =>
    Response.json(
      db
        .select()
        .from(schema.members)
        .orderBy(desc(schema.members.socialCredits), desc(schema.members.xp))
        .limit(100)
        .all(),
    ),
};

const clubsRoute: ApiRoute = {
  method: "GET",
  path: "/api/clubs",
  access: "user",
  handle: () =>
    Response.json(
      db
        .select()
        .from(schema.clubs)
        .all()
        .map((c) => ({
          ...c,
          memberCount: clubMemberIds(c.id).length,
          activityScore: clubActivityScore(c.id),
        })),
    ),
};

/** Detail view for the club modal: membership, activity, dates. */
const clubDetailRoute: ApiRoute = {
  method: "GET",
  path: "/api/clubs/:id",
  access: "user",
  handle(_req, ctx) {
    const club = getClub(Number(ctx.params.id));
    if (!club) return Response.json({ error: "not found" }, { status: 404 });
    return Response.json({
      id: club.id,
      name: club.name,
      description: club.description,
      status: club.status,
      level: club.level,
      tierLabel: TIER_LABEL[club.level] ?? "Club",
      ownerId: club.ownerId,
      createdAt: club.createdAt,
      lastActiveAt: club.lastActiveAt,
      activityScore: clubActivityScore(club.id),
      memberIds: clubMemberIds(club.id),
    });
  },
};

/** Everything the member profile page shows: stats + live Discord roles. */
const memberProfileRoute: ApiRoute = {
  method: "GET",
  path: "/api/members/:id",
  access: "user",
  async handle(_req, ctx) {
    const userId = ctx.params.id!;
    const row = db
      .select()
      .from(schema.members)
      .where(eq(schema.members.userId, userId))
      .get();
    const guild = await ctx.client.guilds.fetch(ctx.guildId).catch(() => null);
    const guildMember = guild ? await guild.members.fetch(userId).catch(() => null) : null;
    if (!row && !guildMember) {
      return Response.json({ error: "not found" }, { status: 404 });
    }

    const user = guildMember?.user ?? (await ctx.client.users.fetch(userId).catch(() => null));
    const xp = row?.xp ?? 0;
    const progress = levelProgress(xp);
    const roles = guildMember
      ? [...guildMember.roles.cache.values()]
          .filter((r) => r.id !== guild!.roles.everyone.id)
          .sort((a, b) => b.position - a.position)
          .map((r) => ({
            id: r.id,
            name: r.name,
            color: r.hexColor === "#000000" ? null : r.hexColor,
          }))
      : [];

    return Response.json({
      userId,
      displayName: guildMember?.displayName ?? user?.displayName ?? userId,
      avatarUrl:
        guildMember?.displayAvatarURL({ extension: "png", size: 256 }) ??
        user?.displayAvatarURL({ extension: "png", size: 256 }) ??
        null,
      inGuild: guildMember !== null,
      guildJoinedAt: guildMember?.joinedTimestamp
        ? Math.floor(guildMember.joinedTimestamp / 1000)
        : null,
      level: progress.level,
      xp,
      xpCurrent: progress.current,
      xpNeeded: progress.needed,
      credits: row?.socialCredits ?? 0,
      messageCount: row?.messageCount ?? 0,
      trackedSince: row?.joinedAt ?? null,
      rank: row ? getCreditRank(userId) : 0,
      roles,
      clubs: getMemberClubs(userId),
      presidency: getPresidencyHistoryForUser(userId),
    });
  },
};

const approveClubRoute: ApiRoute = {
  method: "POST",
  path: "/api/clubs/:id/approve",
  access: "president",
  async handle(_req, ctx) {
    const guild = await ctx.client.guilds.fetch(ctx.guildId);
    const club = await approveClub(guild, Number(ctx.params.id));
    return Response.json(club ?? { error: "not found" }, { status: club ? 200 : 404 });
  },
};

const terminateClubRoute: ApiRoute = {
  method: "POST",
  path: "/api/clubs/:id/terminate",
  access: "president",
  async handle(_req, ctx) {
    const guild = await ctx.client.guilds.fetch(ctx.guildId);
    await terminateClub(guild, Number(ctx.params.id));
    return Response.json({ ok: true });
  },
};

const electionsRoute: ApiRoute = {
  method: "GET",
  path: "/api/elections",
  access: "admin",
  handle: () => {
    const open = getOpenElection();
    const all = db
      .select()
      .from(schema.elections)
      .orderBy(desc(schema.elections.startsAt))
      .limit(20)
      .all();
    const candidates = open
      ? db
          .select()
          .from(schema.candidates)
          .where(eq(schema.candidates.electionId, open.id))
          .all()
      : [];
    return Response.json({ open, all, candidates });
  },
};

const startElectionRoute: ApiRoute = {
  method: "POST",
  path: "/api/elections/start",
  access: "admin",
  async handle(_req, ctx) {
    const election = await openElection(ctx.client);
    return Response.json(election ?? { error: "already open or unconfigured" }, {
      status: election ? 200 : 409,
    });
  },
};

const closeElectionRoute: ApiRoute = {
  method: "POST",
  path: "/api/elections/:id/close",
  access: "admin",
  async handle(_req, ctx) {
    const guild = await ctx.client.guilds.fetch(ctx.guildId);
    const winner = await closeElection(guild, Number(ctx.params.id));
    return Response.json({ winner });
  },
};

const modlogRoute: ApiRoute = {
  method: "GET",
  path: "/api/modlog",
  access: "admin",
  handle: () =>
    Response.json(
      db.select().from(schema.modLog).orderBy(desc(schema.modLog.createdAt)).limit(100).all(),
    ),
};

const warningsRoute: ApiRoute = {
  method: "GET",
  path: "/api/warnings",
  access: "admin",
  handle: () =>
    Response.json(
      db.select().from(schema.warnings).orderBy(desc(schema.warnings.createdAt)).limit(100).all(),
    ),
};

/** Current president + theme cooldown state (President panel). */
const presidentRoute: ApiRoute = {
  method: "GET",
  path: "/api/president",
  access: "president",
  handle: () => Response.json(getThemeStatus()),
};

/** Apply a weekly server theme change (name template and/or icon URL). */
const themeRoute: ApiRoute = {
  method: "POST",
  path: "/api/theme",
  access: "president",
  async handle(req, ctx) {
    const body = (await req.json().catch(() => null)) as
      | { name?: string; iconUrl?: string }
      | null;
    if (!body) return Response.json({ error: "invalid body" }, { status: 400 });
    const guild = await ctx.client.guilds.fetch(ctx.guildId);
    const result = await applyTheme(guild, {
      name: body.name,
      iconUrl: body.iconUrl,
      actorId: ctx.session!.userId,
    });
    return "error" in result
      ? Response.json(result, { status: 400 })
      : Response.json(result);
  },
};

/** Full presidency history (President panel + dedicated history tab). */
const presidencyHistoryRoute: ApiRoute = {
  method: "GET",
  path: "/api/presidency-history",
  access: "user",
  handle: () => Response.json(getPresidencyHistory()),
};

/** Resolve a batch of user ids to their display names (nickname → global → id). */
const usernamesRoute: ApiRoute = {
  method: "POST",
  path: "/api/usernames",
  access: "user",
  async handle(req, ctx) {
    const body = (await req.json().catch(() => null)) as { ids?: unknown } | null;
    const ids = Array.isArray(body?.ids)
      ? (body!.ids as unknown[]).filter((x): x is string => typeof x === "string").slice(0, 200)
      : [];
    const guild = await ctx.client.guilds.fetch(ctx.guildId).catch(() => null);
    const out: Record<string, string> = {};
    for (const id of ids) {
      const member =
        guild?.members.cache.get(id) ?? (await guild?.members.fetch(id).catch(() => null));
      if (member) {
        out[id] = member.displayName;
        continue;
      }
      const user = await ctx.client.users.fetch(id).catch(() => null);
      out[id] = user?.displayName ?? id;
    }
    return Response.json(out);
  },
};

/** Summary for the dashboard landing page, visible to every member. */
const statsRoute: ApiRoute = {
  method: "GET",
  path: "/api/stats",
  access: "user",
  handle: () => {
    const members = db.select().from(schema.members).all();
    const clubs = db.select().from(schema.clubs).all();
    const open = getOpenElection();
    const candidates = open
      ? db
          .select()
          .from(schema.candidates)
          .where(eq(schema.candidates.electionId, open.id))
          .all().length
      : 0;
    const theme = getThemeStatus();
    const topMembers = [...members]
      .sort((a, b) => b.socialCredits - a.socialCredits || b.xp - a.xp)
      .slice(0, 5)
      .map((m) => ({ userId: m.userId, socialCredits: m.socialCredits, level: m.level, xp: m.xp }));
    return Response.json({
      members: members.length,
      totalMessages: members.reduce((sum, m) => sum + m.messageCount, 0),
      totalXp: members.reduce((sum, m) => sum + m.xp, 0),
      totalCredits: members.reduce((sum, m) => sum + m.socialCredits, 0),
      clubs: approvedClubs().length,
      pendingClubs: clubs.filter((c) => c.status === "pending").length,
      starboardPosts: db.select().from(schema.starboardPosts).all().length,
      election: open ? { ...open, candidates } : null,
      president: theme.userId ? { userId: theme.userId, termStart: theme.termStart } : null,
      topMembers,
    });
  },
};

export const dashboardRoutes: ApiRoute[] = [
  getConfigRoute,
  updateConfigRoute,
  leaderboardRoute,
  clubsRoute,
  clubDetailRoute,
  memberProfileRoute,
  approveClubRoute,
  terminateClubRoute,
  electionsRoute,
  startElectionRoute,
  closeElectionRoute,
  modlogRoute,
  warningsRoute,
  presidentRoute,
  themeRoute,
  presidencyHistoryRoute,
  usernamesRoute,
  statsRoute,
  ...messageRoutes,
];
