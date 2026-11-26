import type { ApiRoute } from "../../core/plugin.ts";
import { adminRoutes } from "./api/admin.ts";
import { backfillRoutes } from "./api/backfill.ts";
import { presidentRoutes } from "./api/president.ts";
import { userRoutes } from "./api/user.ts";
import { wrappedRoutes } from "./api/wrapped.ts";

/**
 * Every HTTP route of the activity plugin: the per-tier route lists in
 * `./api/`, concatenated. Each list is owned by one lane, so a lane adds
 * routes in its own file and never edits this one.
 */
export const activityRoutes: ApiRoute[] = [
  ...userRoutes,
  ...presidentRoutes,
  ...adminRoutes,
  ...backfillRoutes,
  ...wrappedRoutes,
];
