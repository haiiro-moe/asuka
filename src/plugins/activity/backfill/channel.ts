/**
 * Server-only types of the history backfill: the page fetcher and the channel
 * it reads. They mention `RawMessage`, so they stay out of `types.ts`, which
 * the web app imports.
 */
import type { RawMessage } from "../facts.ts";
import type { FetchReactionPage } from "./types.ts";

/**
 * One page of a channel's history, newest message first. Empty once the start
 * of the channel has been passed. `before` is the id of the oldest message of
 * the previous page, or null for the first page.
 */
export type FetchPage = (before: string | null) => Promise<RawMessage[]>;

/** A channel or thread the backfill reads. */
export interface BackfillChannel {
  /** The channel or thread id. */
  id: string;
  /** Display name, such as `#general`; shown as the run's current channel. */
  name: string;
  /** The parent channel when this is a thread; null otherwise. */
  parentId: string | null;
  /** Reads the message history, page by page. */
  fetchPage: FetchPage;
  /** Reads the history with its reactions, for the optional reaction pass. */
  fetchReactionPage: FetchReactionPage;
}
