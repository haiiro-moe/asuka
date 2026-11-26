/**
 * Pages of the user tier of the activity section.
 *
 * @module
 */
import type { Page } from "../index.tsx";
import { ActivityPage } from "./ActivityPage.tsx";

/** The user tier's activity pages, in nav order. */
export const USER_PAGES: Page[] = [{ id: "activity", label: "activity", el: <ActivityPage /> }];
