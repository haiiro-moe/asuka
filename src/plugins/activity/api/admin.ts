import type { ApiContext, ApiRoute } from "../../../core/plugin.ts";
import {
  RELATION_KINDS,
  botUsage,
  channelHealth,
  clubsAndEvents,
  drift,
  economy,
  memberInspect,
  moderationSeries,
  newcomers,
  relations,
  repeatOffenders,
} from "../queries/admin.ts";
import { parsePeriodParam } from "../time.ts";
import { voiceReady } from "../voice-ready.ts";
import type { Period } from "../time.ts";
import type { ChannelHealthRow, NamedChannelHealthRow, RelationKind } from "../types/admin.ts";

/** Resolves a channel or thread id to its display name; null when unknown or gone. */
export type ChannelNameLookup = (channelId: string) => string | null;

/**
 * A {@link ChannelNameLookup} over the locked guild's channel cache
 * (`ctx.client.guilds.cache.get(ctx.guildId)?.channels.cache`). Threads the
 * bot has seen are in that cache too. Nothing is fetched from Discord.
 *
 * @param ctx - The route context.
 */
export function cachedChannelNames(ctx: ApiContext): ChannelNameLookup {
  const cache = ctx.client.guilds.cache.get(ctx.guildId)?.channels.cache;
  return (channelId) => cache?.get(channelId)?.name ?? null;
}

/**
 * Add display names to channel-health rows. Kept apart from the query so the
 * query stays free of discord.js and tests can pass a fake lookup.
 *
 * @param rows - Rows from `channelHealth`.
 * @param lookup - Resolves an id to a name.
 * @returns The rows with `name` and `parentName` (null for a normal channel or an unknown id).
 */
export function withChannelNames(rows: ChannelHealthRow[], lookup: ChannelNameLookup): NamedChannelHealthRow[] {
  return rows.map((r) => ({
    ...r,
    name: lookup(r.channelId),
    parentName: r.parentChannelId == null ? null : lookup(r.parentChannelId),
  }));
}

/** A 400 answer with a JSON `{ error }` body. */
function badRequest(error: string): Response {
  return Response.json({ error }, { status: 400 });
}

/** A Discord user id: digits only. */
const USER_ID = /^\d{1,25}$/;

/**
 * Build an admin GET route under `/api/activity/admin/` that reads `?period=`.
 *
 * The period goes through `parsePeriodParam` (absent means 30 days); an unknown
 * value is answered with 400. The view's result is sent as JSON, or, when it
 * returns a `Response`, as is.
 *
 * @param path - The path after `/api/activity/admin/`, may contain `:params`.
 * @param view - Computes the answer for the period.
 */
function adminView(
  path: string,
  view: (p: Period, url: URL, ctx: ApiContext) => unknown,
): ApiRoute {
  return {
    method: "GET",
    path: `/api/activity/admin/${path}`,
    access: "admin",
    handle(req, ctx) {
      const url = new URL(req.url);
      let p: Period;
      try {
        p = parsePeriodParam(url.searchParams.get("period"));
      } catch (e) {
        if (e instanceof RangeError) return badRequest(e.message);
        throw e;
      }
      const result = view(p, url, ctx);
      return result instanceof Response ? result : Response.json(result);
    },
  };
}

/**
 * Admin-tier activity routes: every view, with names (user ids).
 *
 * All are `GET`, `access: "admin"`, and take `?period=7d|week|30d|term|year|all`
 * (default `30d`). `relations` also takes `?kind=replies|mentions|voice`
 * (default `replies`), `channels` adds `name` and `parentName` from the guild's
 * channel cache ({@link withChannelNames}), and `inspect/:userId` answers 400
 * for an id that is not all digits. Shapes are in `../types/admin.ts`; see
 * docs/activity/queries-admin.md.
 */
export const adminRoutes: ApiRoute[] = [
  adminView("moderation", (p) => moderationSeries(p)),
  adminView("offenders", (p) => repeatOffenders(p)),
  adminView("newcomers", (p) => newcomers(p)),
  adminView("drift", (p) => drift(p, voiceReady())),
  adminView("channels", (p, _url, ctx) => withChannelNames(channelHealth(p), cachedChannelNames(ctx))),
  adminView("economy", (p) => economy(p)),
  adminView("clubs-events", (p) => clubsAndEvents(p)),
  adminView("bot", (p) => botUsage(p)),
  adminView("relations", (p, url) => {
    const kind = url.searchParams.get("kind") ?? "replies";
    if (!(RELATION_KINDS as readonly string[]).includes(kind)) return badRequest(`unknown kind: ${kind}`);
    return relations(p, kind as RelationKind, kind === "voice" ? voiceReady() : undefined);
  }),
  adminView("inspect/:userId", (p, _url, ctx) => {
    const userId = ctx.params.userId ?? "";
    if (!USER_ID.test(userId)) return badRequest("userId must be a numeric id");
    return memberInspect(userId, p);
  }),
];
