/**
 * President-tier activity routes: aggregate numbers only, never names.
 *
 * | Route | Answers with |
 * |---|---|
 * | `GET /api/activity/president/connection` | `PresidentConnection` |
 * | `GET /api/activity/president/weekly` | `PresidentWeeklySeries` |
 * | `GET /api/activity/president/groups` | `PresidentGroupSizes` |
 * | `GET /api/activity/president/engagement` | `PresidentEngagement` |
 * | `GET /api/activity/president/clubs` | `PresidentClubEventHealth` |
 *
 * All take `?period=week` or `?period=term` (`week` when it is missing) and
 * answer 400 with `{ error }` for anything else.
 *
 * The only code this file may load is the president query module (and the
 * group detection). It must never import the admin or user queries, the
 * database or the tables: whatever a handler returns is built by a function
 * that cannot return a name or an id. A test reads this file and fails on any
 * other import. See docs/activity/queries-president.md.
 */
import type { ApiRoute } from "../../../core/plugin.ts";
import {
  clubEventHealth,
  connection,
  engagement,
  groupSizes,
  presidentPeriod,
  weeklySeries,
} from "../queries/president.ts";

/** A president query: a fixed period in, a plain object of numbers out. */
type PresidentQuery = (period: ReturnType<typeof presidentPeriod>) => object;

/**
 * Build one president route.
 *
 * The handler never lets an error out. An error's text can quote what the
 * failing code was working on, ids included, and an uncaught one is shown to
 * the caller as it is when the server runs in development mode. So the cause
 * goes to the server log and the president gets a fixed message.
 *
 * @param name - Last segment of the path.
 * @param query - The query that answers it.
 * @param now - The clock, or undefined to use the real one.
 * @returns The route. It answers 400 when `?period=` is not `week` or `term`,
 *   without repeating the value it was given, and 500 with
 *   `{ error: "internal error" }` when anything else goes wrong.
 */
function presidentRoute(name: string, query: PresidentQuery, now: (() => number) | undefined): ApiRoute {
  return {
    method: "GET",
    path: `/api/activity/president/${name}`,
    access: "president",
    handle(req) {
      try {
        const value = new URL(req.url).searchParams.get("period");
        let period;
        try {
          period = presidentPeriod(value, now?.());
        } catch (error) {
          if (error instanceof RangeError) return Response.json({ error: error.message }, { status: 400 });
          throw error;
        }
        return Response.json(query(period));
      } catch (error) {
        console.error(`[activity] president ${name} query failed:`, error);
        return Response.json({ error: "internal error" }, { status: 500 });
      }
    },
  };
}

/**
 * Build the president-tier routes around a clock.
 *
 * The clock only decides which UTC day it is: both periods end at 00:00 UTC of
 * that day, so two requests on the same day are answered for the same period.
 *
 * @param now - Returns the current time in unix seconds. Leave it out to use
 *   the real clock; tests pass a fixed one.
 * @returns The five routes, all `access: "president"`.
 */
export function createPresidentRoutes(now?: () => number): ApiRoute[] {
  return [
    presidentRoute("connection", connection, now),
    presidentRoute("weekly", weeklySeries, now),
    presidentRoute("groups", groupSizes, now),
    presidentRoute("engagement", engagement, now),
    presidentRoute("clubs", clubEventHealth, now),
  ];
}

/** The president-tier activity routes, on the real clock. Collected by `../api.ts`. */
export const presidentRoutes: ApiRoute[] = createPresidentRoutes();
