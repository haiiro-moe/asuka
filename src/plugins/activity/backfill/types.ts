/**
 * Pure types of the history backfill. This file has no imports from the
 * server, so the web dashboard can import the status shape without pulling the
 * runner (and its database and Discord dependencies) into the browser bundle.
 */
import type { RawMessage } from "../facts.ts";

/** Progress of the history backfill, as `GET /api/activity/backfill` reports it. */
export interface BackfillStatus {
  /**
   * `idle`: nothing has been scanned yet. `running`: a run is live.
   * `stopped`: some channels are unfinished and no run is live (stopped by an
   * admin, interrupted by a restart, or left over after channel errors).
   * `done`: every channel has been read to its start. `failed`: the last run
   * could not even list the channels.
   */
  status: "idle" | "running" | "stopped" | "done" | "failed";
  /** Channels and threads whose message pass has finished. */
  channelsDone: number;
  /** Channels and threads known to the backfill so far. */
  channelsTotal: number;
  /** Messages scanned across all channels, over every run. */
  scanned: number;
  /** Id of the channel being read right now; null when no run is live. */
  current: string | null;
  /** When the last run in this process started, in unix seconds; null after a restart. */
  startedAt: number | null;
  /** Seconds the last run in this process has been going (or went); 0 without one. */
  elapsedSec: number;
  /** Whether the reaction pass is on for the run (or was, for a past one). */
  reactions: boolean;
  /** Channels that failed with an unexpected error in the last run in this process. */
  errors: number;
}

/**
 * One page of a channel's history, newest message first. Empty once the start
 * of the channel has been passed. `before` is the id of the oldest message of
 * the previous page, or null for the first page.
 */
export type FetchPage = (before: string | null) => Promise<RawMessage[]>;

/** One reaction on a message, as the reaction pass reads it. */
export interface RawReaction {
  /** The emoji key, as `ParsedEmoji.emoji`: the unicode emoji (no U+FE0F) or `custom:<id>`. */
  emoji: string;
  /** The custom emoji's name; null for a unicode emoji. */
  name: string | null;
  /** Everyone who reacted with it. */
  users: () => Promise<{ id: string; bot: boolean }[]>;
}

/** A message that carries reactions, as the reaction pass reads it. */
export interface ReactionMessage {
  /** The message id. */
  id: string;
  /** The message author's id. */
  authorId: string;
  /** Whether the author is a bot. */
  authorBot: boolean;
  /** When the message was sent, in unix milliseconds. */
  createdTimestamp: number;
  /** Its reactions; empty when it has none. */
  reactions: RawReaction[];
}

/** One page of messages for the reaction pass, newest first, empty once exhausted. */
export type FetchReactionPage = (before: string | null) => Promise<ReactionMessage[]>;

/** A channel or thread the backfill reads. */
export interface BackfillChannel {
  /** The channel or thread id. */
  id: string;
  /** The parent channel when this is a thread; null otherwise. */
  parentId: string | null;
  /** Reads the message history, page by page. */
  fetchPage: FetchPage;
  /** Reads the history with its reactions, for the optional reaction pass. */
  fetchReactionPage: FetchReactionPage;
}
