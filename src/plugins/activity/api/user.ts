import type { ApiContext, ApiRoute } from "../../../core/plugin.ts";
import { parsePeriodParam } from "../time.ts";
import { voiceReadiness, voiceReady } from "../voice-ready.ts";
import type { ChannelRow, GraveyardEmoji, NamedChannelRow, NamedReactedRow, ReactedRow } from "../types/user.ts";
import { userMemo } from "./memo.ts";
import type { Period } from "../time.ts";
import {
  awards,
  channelFavourites,
  emojiGraveyard,
  emojiLeaderboard,
  emojiTrend,
  mostReacted,
  rhythm,
  sharing,
  voiceFavourites,
} from "../queries/user.ts";

/**
 * Build a `GET /api/activity/user/<name>` route that reads `?period=` and
 * answers with the query's result as JSON. An unknown period is a 400 with
 * `{ error }`.
 *
 * With `memo`, the query's result is kept per (route, period, ten-minute
 * window, `memo.extra`) in `memo.ts`, so repeated page loads run it once per
 * window; `decorate` (names from the guild cache) runs on every call. None of
 * these views depends on who asks, so none is keyed by user id.
 */
function view<T>(
  name: string,
  run: (p: Period, ctx: ApiContext) => T,
  opts: { memo?: { extra?: (ctx: ApiContext) => string }; decorate?: (result: T, ctx: ApiContext) => unknown } = {},
): ApiRoute {
  return {
    method: "GET",
    path: `/api/activity/user/${name}`,
    access: "user",
    handle(req, ctx) {
      const raw = new URL(req.url).searchParams.get("period");
      let period: Period;
      try {
        period = parsePeriodParam(raw);
      } catch (err) {
        if (err instanceof RangeError) return Response.json({ error: err.message }, { status: 400 });
        throw err;
      }
      const memo = opts.memo;
      const result = memo
        ? userMemo({ route: name, period: raw ?? "", extra: memo.extra?.(ctx) }, () => run(period, ctx))
        : run(period, ctx);
      return Response.json(opts.decorate ? opts.decorate(result, ctx) : result);
    },
  };
}

/** Memo key part for the views that read voice: whether voice is ready. */
const voiceKey = { extra: () => String(voiceReady()) };

/** The guild's custom emoji, from the cache. */
function guildEmojis(ctx: ApiContext): Map<string, { name: string | null }> {
  const cache = ctx.client.guilds.cache.get(ctx.guildId)?.emojis.cache;
  return new Map([...(cache?.values() ?? [])].map((e) => [e.id, { name: e.name ?? null }]));
}

/**
 * Add the channel and thread-parent names to most-reacted rows.
 *
 * @param rows - Rows from `mostReacted`.
 * @param nameOf - Looks a channel id up; null when it is unknown or gone.
 */
export function nameReacted(rows: ReactedRow[], nameOf: (id: string) => string | null): NamedReactedRow[] {
  return rows.map((r) => ({
    ...r,
    channelName: nameOf(r.channelId),
    parentChannelName: r.parentChannelId ? nameOf(r.parentChannelId) : null,
  }));
}

/**
 * Add display names to channel rows.
 *
 * @param rows - Rows from `channelFavourites` or `voiceFavourites`.
 * @param nameOf - Looks a channel id up; null when it is unknown or gone.
 */
export function nameChannels(rows: ChannelRow[], nameOf: (id: string) => string | null): NamedChannelRow[] {
  return rows.map((r) => ({
    ...r,
    name: nameOf(r.channelId),
    parentName: r.parentChannelId ? nameOf(r.parentChannelId) : null,
  }));
}

/** A name lookup over the guild's channel cache. */
function channelNamer(ctx: ApiContext): (id: string) => string | null {
  const channels = ctx.client.guilds.cache.get(ctx.guildId)?.channels.cache;
  return (id) => channels?.get(id)?.name ?? null;
}

/**
 * Everyone-tier activity routes (`access: "user"`), all `GET` with `?period=`
 * (`7d|week|30d|term|year|all`): rhythm, emoji, emoji-trend, emoji-graveyard,
 * reacted, channels, voice, sharing and awards, plus `voice-status` (no period).
 * Voice views are withheld until the voice log holds two whole months (see
 * `../voice-ready.ts`). Members are named only in
 * `awards`. The heavy views are memoised for ten minutes (`memo.ts`); channel
 * and emoji names are added on every call. See docs/activity/queries-user.md.
 */
export const userRoutes: ApiRoute[] = [
  view("rhythm", (p) => rhythm(p, voiceReady()), { memo: voiceKey }),
  view("emoji", (p) => emojiLeaderboard(p), { memo: {} }),
  view("emoji-trend", (p) => emojiTrend(p), { memo: {} }),
  view("emoji-graveyard", (_p, ctx) => emojiGraveyard([...guildEmojis(ctx).keys()]), {
    // The result depends on the guild's emoji, not on the period.
    memo: { extra: (ctx) => String(Bun.hash([...guildEmojis(ctx).keys()].sort().join(","))) },
    decorate: (rows, ctx): GraveyardEmoji[] => {
      const emojis = guildEmojis(ctx);
      return rows.map((r) => ({ id: r.id, name: emojis.get(r.id)?.name ?? null }));
    },
  }),
  view("reacted", (p) => mostReacted(p), { memo: {}, decorate: (rows, ctx) => nameReacted(rows, channelNamer(ctx)) }),
  view("channels", (p) => channelFavourites(p), { memo: {}, decorate: (rows, ctx) => nameChannels(rows, channelNamer(ctx)) }),
  view("voice", (p) => voiceFavourites(p, voiceReady()), { memo: voiceKey, decorate: (rows, ctx) => nameChannels(rows, channelNamer(ctx)) }),
  view("sharing", (p) => sharing(p), { memo: {} }),
  view("awards", (p) => awards(p, voiceReady()), { memo: voiceKey }),
  {
    method: "GET",
    path: "/api/activity/user/voice-status",
    access: "user",
    handle() {
      const { ready, readyAt } = voiceReadiness();
      return Response.json({ ready, readyAt });
    },
  },
];
