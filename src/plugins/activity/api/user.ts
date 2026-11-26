import type { ApiContext, ApiRoute } from "../../../core/plugin.ts";
import { parsePeriodParam } from "../time.ts";
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
 */
function view(name: string, run: (p: Period, ctx: ApiContext) => unknown): ApiRoute {
  return {
    method: "GET",
    path: `/api/activity/user/${name}`,
    access: "user",
    handle(req, ctx) {
      let period: Period;
      try {
        period = parsePeriodParam(new URL(req.url).searchParams.get("period"));
      } catch (err) {
        if (err instanceof RangeError) return Response.json({ error: err.message }, { status: 400 });
        throw err;
      }
      return Response.json(run(period, ctx));
    },
  };
}

/**
 * Everyone-tier activity routes (`access: "user"`), all `GET` with `?period=`
 * (`7d|week|30d|term|year|all`): rhythm, emoji, emoji-trend, emoji-graveyard,
 * reacted, channels, voice, sharing and awards. Members are named only in
 * `awards`. See docs/activity/queries-user.md.
 */
export const userRoutes: ApiRoute[] = [
  view("rhythm", (p) => rhythm(p)),
  view("emoji", (p) => emojiLeaderboard(p)),
  view("emoji-trend", (p) => emojiTrend(p)),
  view("emoji-graveyard", (_p, ctx) => {
    const guild = ctx.client.guilds.cache.get(ctx.guildId);
    return emojiGraveyard(guild ? [...guild.emojis.cache.keys()] : []);
  }),
  view("reacted", (p) => mostReacted(p)),
  view("channels", (p) => channelFavourites(p)),
  view("voice", (p) => voiceFavourites(p)),
  view("sharing", (p) => sharing(p)),
  view("awards", (p) => awards(p)),
];
