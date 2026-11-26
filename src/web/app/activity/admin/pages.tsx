/**
 * Pages of the admin tier of the activity section: the diagnostics page (`activity-admin`). See
 * docs/activity/web-admin.md.
 *
 * @module
 */
import type { Page } from "../index.tsx";
import { DiagnosticsPage } from "./DiagnosticsPage.tsx";

/** The admin tier's activity pages, in nav order. */
export const ADMIN_PAGES: Page[] = [{ id: "activity-admin", label: "diagnostics", el: <DiagnosticsPage />, minRole: "admin" }];
