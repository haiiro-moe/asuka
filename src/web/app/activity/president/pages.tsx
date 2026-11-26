/**
 * Pages of the president tier of the activity section.
 *
 * @module
 */
import type { Page } from "../index.tsx";
import { ConnectionPage } from "./ConnectionPage.tsx";

/** The president tier's activity pages, in nav order. */
export const PRESIDENT_PAGES: Page[] = [
  { id: "activity-president", label: "connection", el: <ConnectionPage />, minRole: "president" },
];
