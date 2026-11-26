import type { ApiRoute } from "../../../core/plugin.ts";

/**
 * Admin routes that start the history backfill and report its progress.
 * Empty until that lane lands; the name is fixed so `../api.ts` can already
 * collect it.
 */
export const backfillRoutes: ApiRoute[] = [];
