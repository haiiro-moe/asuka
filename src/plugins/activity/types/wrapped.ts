/**
 * Wrapped types shared by the server and the web app.
 *
 * This file holds types only (no imports, no runtime code), so the web app's
 * tsconfig can import it without compiling any server module. See
 * docs/activity/wrapped.md.
 *
 * @packageDocumentation
 */

/** One emoji in a member's Wrapped, with how often they used it. */
export interface WrappedEmoji {
  /** The emoji key: the unicode emoji itself, or `custom:<id>` for a custom emoji. */
  emoji: string;
  /** The custom emoji's name; null for a unicode emoji. */
  name: string | null;
  /** Uses in message text plus reactions the member added, that year. */
  count: number;
}

/**
 * A member's year, as the snapshot stored on their Wrapped link.
 *
 * Every number is the member's own. The two friend fields name another member
 * by id only; no number about that member is kept. The year is a UTC calendar
 * year, and excluded channels are left out.
 */
export interface WrappedData {
  /** The UTC calendar year. */
  year: number;
  /** Messages the member sent. */
  messages: number;
  /** Hours the member spent in voice, rounded to one decimal. */
  voiceHours: number;
  /** Up to three emoji, most used first: text use and reactions merged. */
  topEmoji: WrappedEmoji[];
  /** The UTC hour (0-23) the member sent the most messages in; null without messages. */
  busiestHour: number | null;
  /**
   * The UTC weekday the member sent the most messages on, as a lowercase name
   * (`monday` to `sunday`); null without messages.
   */
  busiestDay: string | null;
  /** The member they replied to, mentioned and sat in voice with the most; null when none. */
  closestFriendId: string | null;
  /** The member they replied to the most; null when they replied to no one. */
  mostRepliedToId: string | null;
  /** The channel they wrote the most in (a thread counts as a channel of its own); null without messages. */
  topChannelId: string | null;
  /** The member's current level, when the snapshot was taken. */
  xpLevel: number;
}

/** What a Wrapped run is doing. */
export type WrappedRunState =
  /** No run has ever been started. */
  | "idle"
  /** Building each member's snapshot and link. */
  | "processing"
  /** DMing the links of opted-in members. */
  | "sending"
  /** Finished. */
  | "done"
  /** Stopped by an error. */
  | "failed"
  /** Was processing or sending but has not updated for 120 seconds (the bot restarted, say). */
  | "interrupted";

/**
 * The latest Wrapped run and its progress, as `GET /api/activity/wrapped/run`
 * returns it and the dashboard polls it.
 */
export interface WrappedRunStatus {
  /** The run's id; null when no run exists. */
  id: number | null;
  /** The year the run covers; null when no run exists. */
  year: number | null;
  /** What the run is doing. */
  status: WrappedRunState;
  /** Members the run covers (members with activity that year who have not left). */
  total: number;
  /** Members whose snapshot and link have been made. */
  processed: number;
  /** DMs delivered by this run. */
  sent: number;
  /** DMs this run could not deliver (closed DMs, say). */
  failed: number;
  /** Links of that year whose member had not opted in, so no DM was sent. */
  skipped: number;
  /** Members opted in to the DM right now. */
  optedIn: number;
  /** When the run started, unix seconds; null when no run exists. */
  startedAt: number | null;
  /** When the run ended, unix seconds; null while it runs or when no run exists. */
  finishedAt: number | null;
}

/**
 * What the public `GET /api/activity/wrapped/t/:token` route returns: the
 * snapshot plus the display names the story page shows. Names are resolved
 * when the link is opened and fall back to null when the member is unknown.
 */
export interface WrappedLinkResponse {
  /** The link holder's snapshot. */
  data: WrappedData;
  /** The link holder's display name. */
  displayName: string;
  /** Display name of {@link WrappedData.closestFriendId}; null when none or unknown. */
  closestFriendName: string | null;
  /** Display name of {@link WrappedData.mostRepliedToId}; null when none or unknown. */
  mostRepliedToName: string | null;
  /** Plain name of {@link WrappedData.topChannelId} (a thread's own name); null when none or unknown. */
  topChannelName: string | null;
  /** Name of the thread's parent channel when {@link WrappedData.topChannelId} is a thread; null for a normal channel or when unknown. */
  topChannelParentName: string | null;
}
