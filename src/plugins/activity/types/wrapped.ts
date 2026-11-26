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
 * Every number is the member's own. The soulmate and most-replied-to fields name another member
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
  /**
   * The member's soulmate: who they replied to, mentioned and sat in voice
   * with the most; null when none.
   */
  soulmateId: string | null;
  /** The member they replied to the most; null when they replied to no one. */
  mostRepliedToId: string | null;
  /** The channel they wrote the most in (a thread counts as a channel of its own); null without messages. */
  topChannelId: string | null;
  /** The member's current level, when the snapshot was taken. */
  xpLevel: number;
  /** The club the member owns with the most messages that year; null when they own none. */
  club: WrappedClub | null;
  /** Their presidency that year; null when they did not hold the chair that year. */
  presidency: WrappedPresidency | null;
  /** Titles they won that year (rank 1, ties shared); empty for none. */
  titles: WrappedTitle[];
}

/** The club a member owns, with its year and its ranks among all approved clubs. */
export interface WrappedClub {
  /** The club's id. */
  clubId: number;
  /** The club's name. */
  name: string;
  /** Accepted members right now. */
  members: number;
  /** Messages in the club's channel and thread that year. */
  messages: number;
  /** Rank by messages among all approved clubs (1 = first; ties share). */
  messagesRank: number;
  /** Rank by members. */
  membersRank: number;
  /** Rank by seconds in the club's voice and text channels. */
  voiceRank: number;
  /** How many approved clubs there are. */
  clubs: number;
}

/** A member's presidency in one year. */
export interface WrappedPresidency {
  /** Terms they held that overlap the year. */
  terms: number;
  /** Whole UTC days of those terms inside the year (an ongoing term counts to now). */
  daysInOffice: number;
  /** Votes they got in the election of their latest term that year; null when unknown. */
  votes: number | null;
  /** Their share of that election's votes, whole percent; null when unknown. */
  votePercent: number | null;
  /** Messages they sent while in office that year. */
  messagesInOffice: number;
  /** `messagesInOffice` per day in office, one decimal. */
  perDay: number;
  /**
   * How much busier (positive) or quieter (negative) the server was per day
   * during their terms than over the whole year, whole percent.
   */
  serverActivityPercent: number;
  /** Their most used emoji key while in office; null when none. */
  topEmojiInOffice: string | null;
}

/** A title a member won: first place at something that year. */
export interface WrappedTitle {
  /** Stable key, e.g. `night-owl`, `club-most-members`, `president`. */
  key: string;
  /** Lowercase label, e.g. `night owl`. */
  label: string;
  /** Short lowercase phrase, e.g. `1st of 43, most after midnight`. */
  detail: string;
}

/**
 * The whole server's year: the public server Wrapped at `/wrapped/s/<token>`.
 * Only three kinds of people are named: the best pair (only when both opted
 * in), the best club's founder and the president.
 */
export interface ServerWrapped {
  /** The UTC calendar year. */
  year: number;
  /** Messages sent that year. */
  messages: number;
  /** Members who sent at least one message. */
  speakers: number;
  /** Hours spent in voice by everyone, one decimal. */
  voiceHours: number;
  /** Up to three emoji, most used first (text and reactions merged). */
  topEmoji: { emoji: string; name: string | null; count: number }[];
  /** The guild's custom emoji nobody used that year. */
  unusedCustomEmoji: number;
  /** Up to five channels by messages; a thread is a channel of its own, with its parent's name. */
  topChannels: { channelId: string; name: string | null; parentName: string | null; count: number }[];
  /** UTC hour with the most messages; null without messages. */
  busiestHour: number | null;
  /** UTC weekday with the most messages, lowercase; null without messages. */
  busiestWeekday: string | null;
  /** The pair with the most replies and voice time together; null unless both opted in. */
  bestPair: { aId: string; aName: string | null; bId: string; bName: string | null; replies: number; voiceHours: number } | null;
  /** The approved club with the most messages; null when no club wrote anything. */
  bestClub: { name: string; founderName: string | null; members: number; messages: number } | null;
  /** Whoever held the chair longest that year; null when nobody did. */
  president: {
    name: string | null;
    terms: number;
    daysInOffice: number;
    serverActivityPercent: number;
    /** Elections that started that year. */
    elections: number;
    /** Distinct members who stood in those elections. */
    candidates: number;
  } | null;
}

/** What the public `GET /api/activity/wrapped/s/:token` route returns. */
export interface ServerWrappedResponse {
  /** The server's snapshot. */
  data: ServerWrapped;
}

/** What a Wrapped run is doing. */
export type WrappedRunState =
  /** No run has ever been started. */
  | "idle"
  /** Building each member's snapshot and link, and the server snapshot. */
  | "processing"
  /** Processing is done and nothing has been sent: ready for the send step. */
  | "processed"
  /** DMing the links of opted-in members (the send step). */
  | "sending"
  /** The send step finished. */
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
  /** Whether the latest send step posts the server Wrapped announcement when its DMs finish. */
  announce: boolean;
  /** When the server Wrapped of the run's year was announced, unix seconds; null when it has not been. */
  announcedAt: number | null;
}

/** `POST /api/activity/wrapped/run` (processing only). 202 when started, 409 otherwise. */
export interface WrappedRunStartResponse {
  result: "started" | "already-running";
  status: WrappedRunStatus;
}

/** `POST /api/activity/wrapped/send`. 202 when started, 409 otherwise. */
export interface WrappedSendResponse {
  result: "started" | "already-running" | "not-processed";
  status: WrappedRunStatus;
}

/** `POST /api/activity/wrapped/run/resume`. 202 when resumed, 409 otherwise. */
export interface WrappedResumeResponse {
  result: "resumed" | "nothing-to-resume";
  status: WrappedRunStatus;
}

/** `POST /api/activity/wrapped/announce`. 200 when posted, 409 otherwise. */
export interface WrappedAnnounceResponse {
  result: "posted" | "already-announced" | "not-processed" | "no-channel";
}

/** `GET /api/activity/wrapped/signup`: the sign-up message of the current year and the opt-in count. */
export interface WrappedSignupState {
  /** The year the state is for. */
  year: number;
  /** A sign-up message has been posted for that year. */
  posted: boolean;
  /** It was posted with the opt-in and opt-out buttons. */
  buttons: boolean;
  /** Sign-ups are closed: the buttons are disabled and opting in or out changes nothing. */
  closed: boolean;
  /** Members opted in right now. */
  optedIn: number;
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
  /** Display name of {@link WrappedData.soulmateId}; null when none or unknown. */
  soulmateName: string | null;
  /** Display name of {@link WrappedData.mostRepliedToId}; null when none or unknown. */
  mostRepliedToName: string | null;
  /** Plain name of {@link WrappedData.topChannelId} (a thread's own name); null when none or unknown. */
  topChannelName: string | null;
  /** Name of the thread's parent channel when {@link WrappedData.topChannelId} is a thread; null for a normal channel or when unknown. */
  topChannelParentName: string | null;
}
