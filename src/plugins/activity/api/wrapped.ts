import { renderWrappedCardPng, renderWrappedServerCardPng } from "../../../core/images/index.tsx";
import type { ApiContext, ApiRoute, BotContext } from "../../../core/plugin.ts";
import type {
  WrappedAnnounceResponse,
  WrappedData,
  WrappedLinkResponse,
  WrappedResumeResponse,
  WrappedRunStartResponse,
  WrappedSendResponse,
  WrappedFailedList,
  PreviewDiscardResponse,
  PreviewStartResponse,
  ServerWrappedResponse,
} from "../types/wrapped.ts";
import {
  buildServerWrapped,
  getOrCreateServerToken,
  getServerRow,
  getServerWrappedByToken,
  serverWrappedDeps,
  serverWrappedUrl,
  storeServerWrapped,
} from "../wrapped/server.ts";
import { ensureWrappedLink, getLinkByToken, linkUrl, listFailedDms, peekLinkByToken } from "../wrapped/links.ts";
import { currentUtcYear, optedInCount } from "../wrapped/optin.ts";
import {
  getWrappedStatus,
  postAnnouncement,
  resendWrappedDm,
  resumeWrappedRun,
  startWrappedRun,
  startWrappedSend,
} from "../wrapped/run.ts";
import { closeSignups, getSignupState, postSignupMessage, reopenSignups } from "../wrapped/signup.ts";
import { discardWrappedPreview, getPreviewStatus, startWrappedPreview } from "../wrapped/preview.ts";

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

/**
 * A channel's plain name and, for a thread, its parent channel's name. Taken
 * from the cache, else fetched (an archived thread is often not cached).
 *
 * @returns Nulls when the id is null or the channel is unknown.
 */
async function channelNames(
  ctx: BotContext,
  channelId: string | null,
): Promise<{ name: string | null; parentName: string | null }> {
  if (!channelId) return { name: null, parentName: null };
  const cached = ctx.client.guilds.cache.get(ctx.guildId)?.channels.cache.get(channelId);
  const channel = cached ?? (await ctx.client.channels.fetch(channelId).catch(() => null));
  if (!channel || !("name" in channel)) return { name: null, parentName: null };
  const isThread = typeof channel.isThread === "function" && channel.isThread();
  return { name: channel.name ?? null, parentName: isThread ? (channel.parent?.name ?? null) : null };
}

/** The public response for a link: the snapshot plus display names resolved now. */
async function linkResponse(ctx: BotContext, userId: string, data: WrappedData, preview: boolean): Promise<WrappedLinkResponse> {
  const [self, soulmate, repliedTo, channel] = await Promise.all([
    memberInfo(ctx, userId),
    data.soulmateId ? memberInfo(ctx, data.soulmateId) : null,
    data.mostRepliedToId ? memberInfo(ctx, data.mostRepliedToId) : null,
    channelNames(ctx, data.topChannelId),
  ]);
  return {
    data,
    preview,
    voiceReady: data.voiceReady === true,
    displayName: self.name ?? "you",
    soulmateName: soulmate?.name ?? null,
    mostRepliedToName: repliedTo?.name ?? null,
    topChannelName: channel.name,
    topChannelParentName: channel.parentName,
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
 * `POST /api/activity/wrapped/run` (admin): start processing a year (body
 * `{ year?: number }`, default the current UTC year). Processing sends no DM to
 * members and posts no announcement. Responds 202 or 409
 * {@link WrappedRunStartResponse}.
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
    const result = startWrappedRun(ctx, { year, startedBy: ctx.session!.userId });
    const out: WrappedRunStartResponse = { result, status: getWrappedStatus() };
    return Response.json(out, { status: result === "started" ? 202 : 409 });
  },
};

/**
 * `POST /api/activity/wrapped/send` (admin): DM opted-in members their links
 * (body `{ announce?: boolean }`, default true: announce the server Wrapped
 * when the DMs finish). Responds 202 or 409 {@link WrappedSendResponse}.
 */
const postSend: ApiRoute = {
  method: "POST",
  path: "/api/activity/wrapped/send",
  access: "admin",
  async handle(req, ctx: ApiContext) {
    const body = await jsonBody(req);
    if (!body) return error(400, "body must be a JSON object");
    if (body.announce !== undefined && typeof body.announce !== "boolean") return error(400, "announce must be a boolean");
    const result = startWrappedSend(ctx, { startedBy: ctx.session!.userId, announce: body.announce as boolean | undefined });
    const out: WrappedSendResponse = { result, status: getWrappedStatus() };
    return Response.json(out, { status: result === "started" ? 202 : 409 });
  },
};

/**
 * `POST /api/activity/wrapped/announce` (admin): post the server Wrapped link
 * to the announcement channel for the latest run's year (once per year).
 * Responds 200 when posted, 502 when the post failed (retry), 409 otherwise,
 * with a {@link WrappedAnnounceResponse}.
 */
const postAnnounce: ApiRoute = {
  method: "POST",
  path: "/api/activity/wrapped/announce",
  access: "admin",
  async handle(_req, ctx) {
    const result = await postAnnouncement(ctx, getWrappedStatus().year ?? currentUtcYear());
    const out: WrappedAnnounceResponse = { result };
    return Response.json(out, { status: result === "posted" ? 200 : result === "failed" ? 502 : 409 });
  },
};

/** `POST /api/activity/wrapped/run/resume` (admin): continue an interrupted run. 202 or 409 {@link WrappedResumeResponse}. */
const resumeRun: ApiRoute = {
  method: "POST",
  path: "/api/activity/wrapped/run/resume",
  access: "admin",
  handle(_req, ctx) {
    const result = resumeWrappedRun(ctx);
    const out: WrappedResumeResponse = { result, status: getWrappedStatus() };
    return Response.json(out, { status: result === "resumed" ? 202 : 409 });
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

/** `GET /api/activity/wrapped/signup` (admin): the sign-up state, {@link WrappedSignupState}. */
const getSignup: ApiRoute = {
  method: "GET",
  path: "/api/activity/wrapped/signup",
  access: "admin",
  handle: () => Response.json(getSignupState()),
};

/**
 * `POST /api/activity/wrapped/signup-message` (admin): post the sign-up message
 * to the announcement channel (body `{ year?: number; buttons?: boolean }`,
 * defaults: the current UTC year, with buttons). Responds the new
 * {@link WrappedSignupState}; 400 when no announcement channel is set or reachable.
 */
const postSignup: ApiRoute = {
  method: "POST",
  path: "/api/activity/wrapped/signup-message",
  access: "admin",
  async handle(req, ctx) {
    const body = await jsonBody(req);
    if (!body) return error(400, "body must be a JSON object");
    const year = body.year === undefined ? currentUtcYear() : parseYear(body.year);
    if (year === null) return error(400, `year must be a whole number from ${MIN_YEAR} to ${MAX_YEAR}`);
    if (body.buttons !== undefined && typeof body.buttons !== "boolean") return error(400, "buttons must be a boolean");
    const result = await postSignupMessage(ctx, { year, buttons: body.buttons !== false });
    if (result === "no-channel") return error(400, "no announcement channel is set, or it cannot be reached");
    return Response.json(getSignupState(year));
  },
};

/** `POST /api/activity/wrapped/signup/close` (admin): close sign-ups (buttons disabled). Responds the {@link WrappedSignupState}. */
const closeSignup: ApiRoute = {
  method: "POST",
  path: "/api/activity/wrapped/signup/close",
  access: "admin",
  async handle(_req, ctx) {
    const { year } = getSignupState();
    await closeSignups(ctx, year);
    return Response.json(getSignupState(year));
  },
};

/** `POST /api/activity/wrapped/signup/reopen` (admin): reopen sign-ups. Responds the {@link WrappedSignupState}. */
const reopenSignup: ApiRoute = {
  method: "POST",
  path: "/api/activity/wrapped/signup/reopen",
  access: "admin",
  async handle(_req, ctx) {
    const { year } = getSignupState();
    await reopenSignups(ctx, year);
    return Response.json(getSignupState(year));
  },
};

/**
 * `GET /api/activity/wrapped/failed?year=` (admin): the {@link WrappedFailedList}
 * of members whose DM failed and who are still opted in, for resending. Year
 * defaults to the latest run's, else the current UTC year; 400 for a bad year.
 */
const getFailed: ApiRoute = {
  method: "GET",
  path: "/api/activity/wrapped/failed",
  access: "admin",
  handle(req) {
    const year = yearParam(req);
    if (year === null) return error(400, "bad year");
    const out: WrappedFailedList = listFailedDms(year);
    return Response.json(out);
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
    return Response.json(await linkResponse(ctx, link.userId, link.data, link.preview));
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
    if (!png) return Response.json(await linkResponse(ctx, link.userId, link.data, link.preview));
    return new Response(new Uint8Array(png), {
      headers: { "content-type": "image/png", "cache-control": "private, max-age=300" },
    });
  },
};

/**
 * `GET /api/activity/wrapped/server-link?year=` (admin): `{ url }` of the server
 * Wrapped, building its snapshot first when the year has none (to preview it).
 * 404 when nothing happened that year.
 */
const getServerLink: ApiRoute = {
  method: "GET",
  path: "/api/activity/wrapped/server-link",
  access: "admin",
  async handle(req, ctx) {
    const year = yearParam(req);
    if (year === null) return error(400, "bad year");
    if (!getServerRow(year)?.data) {
      const data = buildServerWrapped(year, await serverWrappedDeps(ctx));
      if (!data) return error(404, "nothing happened that year");
      storeServerWrapped(year, data);
    }
    return Response.json({ url: serverWrappedUrl(getOrCreateServerToken(year)) });
  },
};

/**
 * `GET /api/activity/wrapped/s/:token` (public; the token is the authorisation):
 * the server's {@link ServerWrappedResponse}, or 404 for an unknown or truncated
 * token. No member's personal snapshot is part of it.
 */
const getServerByToken: ApiRoute = {
  method: "GET",
  path: "/api/activity/wrapped/s/:token",
  access: "public",
  handle(_req, ctx) {
    const found = getServerWrappedByToken(ctx.params.token ?? "");
    if (!found) return error(404, "not found");
    const out: ServerWrappedResponse = { data: found.data, preview: found.preview, voiceReady: found.data.voiceReady === true };
    return Response.json(out);
  },
};

/**
 * `GET /api/activity/wrapped/s/:token/card.png` (public): the server Wrapped card
 * as a PNG. 404 JSON for an unknown token; the {@link ServerWrappedResponse} JSON
 * when the card cannot be rendered.
 */
const getServerCard: ApiRoute = {
  method: "GET",
  path: "/api/activity/wrapped/s/:token/card.png",
  access: "public",
  async handle(_req, ctx) {
    const found = getServerWrappedByToken(ctx.params.token ?? "");
    if (!found) return error(404, "not found");
    const png = await renderWrappedServerCardPng(found.data);
    if (!png) {
      return Response.json({
        data: found.data,
        preview: found.preview,
        voiceReady: found.data.voiceReady === true,
      } satisfies ServerWrappedResponse);
    }
    return new Response(new Uint8Array(png), {
      headers: { "content-type": "image/png", "cache-control": "public, max-age=300" },
    });
  },
};

/**
 * `POST /api/activity/wrapped/preview` (admin): start the session admin's private
 * preview (body `{ year?: number; members?: string[]; all?: boolean }`). The
 * owner is always the session's user, never a body field. Responds 202, 409
 * (already running) or 400 (invalid) {@link PreviewStartResponse}.
 */
const postPreview: ApiRoute = {
  method: "POST",
  path: "/api/activity/wrapped/preview",
  access: "admin",
  async handle(req, ctx: ApiContext) {
    const owner = ctx.session!.userId;
    const body = await jsonBody(req);
    if (!body) return error(400, "body must be a JSON object");
    const year = body.year === undefined ? currentUtcYear() : parseYear(body.year);
    if (year === null) return error(400, `year must be a whole number from ${MIN_YEAR} to ${MAX_YEAR}`);
    if (body.all !== undefined && typeof body.all !== "boolean") return error(400, "all must be a boolean");
    const members = body.members === undefined ? undefined : (body.members as string[]);
    const { result, error: reason } = startWrappedPreview(ctx, {
      ownerUserId: owner,
      year,
      members,
      all: body.all as boolean | undefined,
    });
    const out: PreviewStartResponse = { result, ...(reason ? { error: reason } : {}), status: getPreviewStatus(owner) };
    return Response.json(out, { status: result === "started" ? 202 : result === "invalid" ? 400 : 409 });
  },
};

/** `GET /api/activity/wrapped/preview` (admin): the session admin's own {@link PreviewStatus} (`idle` when none). */
const getPreview: ApiRoute = {
  method: "GET",
  path: "/api/activity/wrapped/preview",
  access: "admin",
  handle: (_req, ctx) => Response.json(getPreviewStatus(ctx.session!.userId)),
};

/** `POST /api/activity/wrapped/preview/discard` (admin): discard the session admin's preview, {@link PreviewDiscardResponse}. */
const discardPreview: ApiRoute = {
  method: "POST",
  path: "/api/activity/wrapped/preview/discard",
  access: "admin",
  handle(_req, ctx) {
    const out: PreviewDiscardResponse = { result: discardWrappedPreview(ctx.session!.userId) };
    return Response.json(out, { status: out.result === "running" ? 409 : 200 });
  },
};

/**
 * Wrapped routes: run control and progress for admins, and the personal link's
 * public data and card. Nothing here starts a run except `POST .../run`.
 */
export const wrappedRoutes: ApiRoute[] = [
  getRun,
  postRun,
  postSend,
  postAnnounce,
  resumeRun,
  resend,
  getSignup,
  postSignup,
  closeSignup,
  reopenSignup,
  getOptins,
  getFailed,
  getLink,
  getByToken,
  getCard,
  getServerLink,
  getServerByToken,
  getServerCard,
  postPreview,
  getPreview,
  discardPreview,
];
