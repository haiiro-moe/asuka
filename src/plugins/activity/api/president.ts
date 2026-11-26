import type { ApiRoute } from "../../../core/plugin.ts";

/**
 * President-tier activity routes: aggregate numbers only, never names.
 * Empty until that lane lands; the name is fixed so `../api.ts` can already
 * collect it.
 */
export const presidentRoutes: ApiRoute[] = [];
