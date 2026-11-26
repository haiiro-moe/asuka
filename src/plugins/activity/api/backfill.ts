import type { ApiRoute } from "../../../core/plugin.ts";
import { getBackfillStatus, startBackfill, stopBackfill } from "../backfill/runner.ts";

/**
 * Admin routes that start, stop and report on the history backfill.
 *
 * - `POST /api/activity/backfill` with `{ reactions?: boolean }` starts the run
 *   (or resumes a stopped one) and replies at once with `{ status, progress }`,
 *   where `status` is `started` or `already-running`. The run is not awaited.
 * - `POST /api/activity/backfill/stop` asks the live run to stop; replies `{ status }`
 *   with `stopping` or `not-running`.
 * - `GET /api/activity/backfill` replies with the `BackfillStatus`.
 */
export const backfillRoutes: ApiRoute[] = [
  {
    method: "POST",
    path: "/api/activity/backfill",
    access: "admin",
    async handle(req, ctx) {
      const body = (await req.json().catch(() => null)) as { reactions?: unknown } | null;
      const status = startBackfill(ctx, { reactions: body?.reactions === true });
      return Response.json({ status, progress: getBackfillStatus() });
    },
  },
  {
    method: "POST",
    path: "/api/activity/backfill/stop",
    access: "admin",
    handle() {
      return Response.json({ status: stopBackfill() });
    },
  },
  {
    method: "GET",
    path: "/api/activity/backfill",
    access: "admin",
    handle() {
      return Response.json(getBackfillStatus());
    },
  },
];
