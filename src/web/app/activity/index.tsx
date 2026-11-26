/**
 * The activity section of the dashboard: the page registry the shell spreads into `PAGES`. Each tier
 * (user, president, admin) lists its pages in its own `pages.tsx`. The Wrapped story is not a dashboard
 * page; it is the standalone route `/wrapped/:token`.
 *
 * Page ids and roles are fixed: `activity` (user), `activity-president` (president),
 * `activity-admin` (admin).
 *
 * @module
 */
import type { ReactElement } from "react";
import { USER_PAGES } from "./user/pages.tsx";
import { PRESIDENT_PAGES } from "./president/pages.tsx";
import { ADMIN_PAGES } from "./admin/pages.tsx";

/** A dashboard page, the same shape as an entry of `PAGES`. */
export interface Page {
  id: string;
  label: string;
  el: ReactElement;
  /** Minimum dashboard role that sees this page (default: every member). */
  minRole?: "president" | "admin";
}

/** Every activity page, user tier first, then president, then admin. */
export const ACTIVITY_PAGES: Page[] = [...USER_PAGES, ...PRESIDENT_PAGES, ...ADMIN_PAGES];

export * from "./charts.tsx";
export * from "./scale.ts";
export * from "./useActivity.ts";
