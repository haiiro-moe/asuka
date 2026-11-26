import type { TextChannel } from "discord.js";
import { getConfig } from "../../../db/index.ts";
import { renderWrappedCardPng } from "../../../core/images/index.tsx";
import type { ApiContext, ApiRoute, BotContext } from "../../../core/plugin.ts";
import type { WrappedData, WrappedLinkResponse } from "../types/wrapped.ts";
import { ensureWrappedLink, getLinkByToken, linkUrl, peekLinkByToken } from "../wrapped/links.ts";
import { currentUtcYear, optedInCount, signupMessage } from "../wrapped/optin.ts";
import { getWrappedStatus, resendWrappedDm, resumeWrappedRun, startWrappedRun } from "../wrapped/run.ts";

/** Lowest and highest year a run or link may be asked for. */
const MIN_YEAR = 2015;
const MAX_YEAR = 2100;

/** A 4xx JSON error. */
function error(status: number, message: string): Response {
  return Response.json({ error: message }, { status });
}

/** Parse a year value; null when it is not a whole number in range. */
function parseYear(value: unknown): number | null {
  const year = typeof value === "string" && value.trim() !== "" ? Number(value) : value;
  if (typeof year !== "number" || !Number.isInteger(year) || year < MIN_YEAR || year > MAX_YEAR) return null;
  return year;
}

/** The `?year=` of a request, else the latest run's year, else the current UTC year. Null when malformed. */
function yearParam(req: Request): number | null {
  const raw = new URL(req.url).searchParams.get("year");
  if (raw === null) return getWrappedStatus().year ?? currentUtcYear();
  return parseYear(raw);
}

/** Read a JSON object body; an empty body is `{}`, anything else that is not an object is null. */
async function jsonBody(req: Request): Promise<Record<string, unknown> | null> {
  const text = await req.text().catch(() => "");
  if (text.trim() === "") return {};
  try {
    const body = JSON.parse(text) as unknown;
    return body && typeof body === "object" && !Array.isArray(body) ? (body as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** A member's display name and PNG avatar URL, from the guild or the user cache; nulls when unknown. */
async function memberInfo(ctx: BotContext, userId: string): Promise<{ name: string | null; avatarUrl: string | null }> {
  const guild = ctx.client.guilds.cache.get(ctx.guildId);
  const member = await guild?.members.fetch(userId).catch(() => null);
  if (member) {
    return { name: member.displayName, avatarUrl: member.displayAvatarURL({ extension: "png", forceStatic: true, size: 256 }) };
  }
  const user = await ctx.client.users.fetch(userId).catch(() => null);
  if (!user) return { name: null, avatarUrl: null };
  const avatarUrl =
    typeof user.displayAvatarURL === "function" ? user.displayAvatarURL({ extension: "png", forceStatic: true, size: 256 }) : null;
  return { name: user.displayName ?? user.username ?? null, avatarUrl };
}

/** A channel's name from the guild cache; null when unknown. */
function channelName(ctx: BotContext, channelId: string | null): string | null {
  if (!channelId) return null;
  const channel = ctx.client.guilds.cache.get(ctx.guildId)?.channels.cache.get(channelId);
  return channel?.name ?? null;
}

/** The public response for a link: the snapshot plus display names resolved now. */
async function linkResponse(ctx: BotContext, userId: string, data: WrappedData): Promise<WrappedLinkResponse> {
  const [self, friend, repliedTo] = await Promise.all([
    memberInfo(ctx, userId),
    data.closestFriendId ? memberInfo(ctx, data.closestFriendId) : null,
    data.mostRepliedToId ? memberInfo(ctx, data.mostRepliedToId) : null,
  ]);
  return {
    data,
    displayName: self.name ?? "you",
    closestFriendName: friend?.name ?? null,
    mostRepliedToName: repliedTo?.name ?? null,
    topChannelName: channelName(ctx, data.topChannelId),
  };
}

/** `GET /api/activity/wrapped/run` (admin): the latest run's status. */
const getRun: ApiRoute = {
  method: "GET",
  path: "/api/activity/wrapped/run",
  access: "admin",
  handle: () => Response.json(getWrappedStatus()),
};

/**
 * `POST /api/activity/wrapped/run` (admin): start a run. Body
 * `{ year?: number; sendDms?: boolean }`, defaulting to the current UTC year and
 * `true`. Responds 202 `{ result: "started", status }`, or 409
 * `{ result: "already-running", status }`.
 */
const postRun: ApiRoute = {
  method: "POST",
  path: "/api/activity/wrapped/run",
  access: "admin",
  async handle(req, ctx: ApiContext) {
    const body = await jsonBody(req);
    if (!body) return error(400, "body must be a JSON object");
    const year = body.year === undefined ? currentUtcYear() : parseYear(body.year);
    if (year === null) return error(400, `year must be a whole number from ${MIN_YEAR} to ${MAX_YEAR}`);
    if (body.sendDms !== undefined && typeof body.sendDms !== "boolean") return error(400, "sendDms must be a boolean");
    const sendDms = (body.sendDms as boolean | undefined) ?? true;
    const result = startWrappedRun(ctx, { year, startedBy: ctx.session!.userId, sendDms });
    return Response.json({ result, status: getWrappedStatus() }, { status: result === "started" ? 202 : 409 });
  },
};

/**
 * `POST /api/activity/wrapped/run/resume` (admin): continue an interrupted run.
 * Responds 202 `{ result: "resumed", status }` or 409 `{ result: "nothing-to-resume", status }`.
 */
const resumeRun: ApiRoute = {
  method: "POST",
  path: "/api/activity/wrapped/run/resume",
  access: "admin",
  handle(_req, ctx) {
    const result = resumeWrappedRun(ctx);
    return Response.json({ result, status: getWrappedStatus() }, { status: result === "resumed" ? 202 : 409 });
  },
};

/**
 * `POST /api/activity/wrapped/resend/:userId?year=` (admin): DM one member their
 * link, even if they have not opted in, because an admin asked for that member.
 * Year defaults to the latest run's. Responds `{ result: "sent" | "failed" }`,
 * or 404 `{ result: "no-link" }`.
 */
const resend: ApiRoute = {
  method: "POST",
  path: "/api/activity/wrapped/resend/:userId",
  access: "admin",
  async handle(req, ctx) {
    const year = yearParam(req);
    if (year === null) return error(400, "bad year");
    const result = await resendWrappedDm(ctx, ctx.params.userId!, year);
    return Response.json({ result }, { status: result === "no-link" ? 404 : 200 });
  },
};

/**
 * `POST /api/activity/wrapped/signup-message` (admin): post the sign-up message
 * (opt-in and opt-out buttons) to the announcement channel. 400 when no
 * announcement channel is set or it cannot be reached.
 */
const postSignup: ApiRoute = {
  method: "POST",
  path: "/api/activity/wrapped/signup-message",
  access: "admin",
  async handle(_req, ctx) {
    const channelId = getConfig().announcementChannelId;
    if (!channelId) return error(400, "no announcement channel is set");
    const channel = await ctx.client.channels.fetch(channelId).catch(() => null);
    if (!channel?.isTextBased() || !("send" in channel)) return error(400, "the announcement channel cannot be reached");
    const year = getWrappedStatus().year ?? currentUtcYear();
    await (channel as TextChannel).send(await signupMessage(ctx.client, year));
    return Response.json({ ok: true });
  },
};

/** `GET /api/activity/wrapped/optins` (admin): `{ count }` of members opted in to the DM. */
const getOptins: ApiRoute = {
  method: "GET",
  path: "/api/activity/wrapped/optins",
  access: "admin",
  handle: () => Response.json({ count: optedInCount() }),
};

/**
 * `GET /api/activity/wrapped/link/:userId?year=` (admin): `{ url }` of a member's
 * link, making the snapshot first when they have none (to preview it before
 * anything is sent). 404 when the member has no activity that year.
 */
const getLink: ApiRoute = {
  method: "GET",
  path: "/api/activity/wrapped/link/:userId",
  access: "admin",
  handle(req, ctx) {
    const year = yearParam(req);
    if (year === null) return error(400, "bad year");
    const token = ensureWrappedLink(ctx.params.userId!, year);
    if (!token) return error(404, "no activity that year");
    return Response.json({ url: linkUrl(token) });
  },
};

/**
 * `GET /api/activity/wrapped/t/:token` (public; the token is the authorisation):
 * the link holder's {@link WrappedLinkResponse}, counting the open, or 404 for an
 * unknown or truncated token.
 */
const getByToken: ApiRoute = {
  method: "GET",
  path: "/api/activity/wrapped/t/:token",
  access: "public",
  async handle(_req, ctx) {
    const link = getLinkByToken(ctx.params.token ?? "");
    if (!link) return error(404, "not found");
    return Response.json(await linkResponse(ctx, link.userId, link.data));
  },
};

/**
 * `GET /api/activity/wrapped/t/:token/card.png` (public): the holder's shareable
 * card as a PNG (not counted as an open). 404 JSON for an unknown token; when
 * the card cannot be rendered, the {@link WrappedLinkResponse} JSON instead.
 */
const getCard: ApiRoute = {
  method: "GET",
  path: "/api/activity/wrapped/t/:token/card.png",
  access: "public",
  async handle(_req, ctx) {
    const link = peekLinkByToken(ctx.params.token ?? "");
    if (!link) return error(404, "not found");
    const self = await memberInfo(ctx, link.userId);
    const png = await renderWrappedCardPng(link.data, self.name ?? "you", self.avatarUrl);
    if (!png) return Response.json(await linkResponse(ctx, link.userId, link.data));
    return new Response(new Uint8Array(png), {
      headers: { "content-type": "image/png", "cache-control": "private, max-age=300" },
    });
  },
};

/**
 * Wrapped routes: run control and progress for admins, and the personal link's
 * public data and card. Nothing here starts a run except `POST .../run`.
 */
export const wrappedRoutes: ApiRoute[] = [
  getRun,
  postRun,
  resumeRun,
  resend,
  postSignup,
  getOptins,
  getLink,
  getByToken,
  getCard,
];
