import type { ApiRoute } from "../../../core/plugin.ts";

/**
 * Everyone-tier activity routes (`access: "user"`): the views any signed-in member may see.
 * Empty until that lane lands; the name is fixed so `../api.ts` can already
 * collect it.
 */
export const userRoutes: ApiRoute[] = [];
