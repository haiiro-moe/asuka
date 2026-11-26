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
  /**
   * Hours the member spent in voice, rounded to one decimal; null while voice
   * is not ready (see {@link WrappedData.voiceReady}), never a made-up zero.
   */
  voiceHours: number | null;
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
  /**
   * Whether voice figures were shown when the snapshot was taken: the voice log
   * held at least two whole months (`voice-ready.ts`). When false,
   * `voiceHours` and the club's `voiceRank` are null, the soulmate was chosen
   * without voice, and no voice title was awarded. Pages skip the voice slide.
   */
  voiceReady: boolean;
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
  /** Rank by seconds in the club's voice and text channels; null while voice is not ready. */
  voiceRank: number | null;
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
  /**
   * Whether voice figures were shown when the snapshot was taken (two whole
   * months of voice data). When false, `voiceHours` and `bestPair.voiceHours`
   * are null and the best pair was chosen by replies only.
   */
  voiceReady: boolean;
  /** Messages sent that year. */
  messages: number;
  /** Members who sent at least one message. */
  speakers: number;
  /** Hours spent in voice by everyone, one decimal; null while voice is not ready. */
  voiceHours: number | null;
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
  /**
   * The pair with the most replies and voice time together (replies only while
   * voice is not ready, and then `voiceHours` is null); null unless both opted in.
   */
  bestPair: { aId: string; aName: string | null; bId: string; bName: string | null; replies: number; voiceHours: number | null } | null;
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
  /** True for an admin's private preview (the story page shows a preview ribbon). */
  preview: boolean;
  /** Whether voice figures may be shown (copied from `data.voiceReady`). */
  voiceReady: boolean;
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
  /**
   * Members whose snapshot could not be built; processing carried on without
   * them and still ended `processed`. 0 when none (and when no run exists).
   */
  buildFailed?: number;
  /**
   * What went wrong in the latest step, for the dashboard: the first member
   * whose snapshot failed, that the live member list could not be fetched (the
   * membership table was used instead), or why a step stopped (the send's
   * circuit breaker, say). Null when nothing did. A send step clears it.
   */
  error?: string | null;
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

/**
 * What `POST /api/activity/wrapped/resend/:userId` did. `sent` and `failed`
 * (200) are the outcome of a DM attempt; the others (404 for `no-link`, 409
 * otherwise) refused without sending: the member has no link, has left, has not
 * opted in, was already sent the link, or a send is running for the year.
 */
export type WrappedResendResult = "sent" | "failed" | "no-link" | "left" | "not-opted-in" | "already-sent" | "sending";

/** `POST /api/activity/wrapped/resend/:userId`. */
export interface WrappedResendResponse {
  result: WrappedResendResult;
}

/** `POST /api/activity/wrapped/announce`. 200 when posted, 409 otherwise. */
export interface WrappedAnnounceResponse {
  /** `no-channel`: no announcement channel is set; `failed`: it could not be reached or the post failed (retry). */
  result: "posted" | "already-announced" | "not-processed" | "no-channel" | "failed";
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
  /** True for an admin's private preview link (the story page shows a preview ribbon). */
  preview: boolean;
  /** Whether voice figures may be shown (copied from `data.voiceReady`). */
  voiceReady: boolean;
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

/**
 * `GET /api/activity/wrapped/failed`: the members whose Wrapped DM failed, so
 * an admin can resend them. Only failed links of members who are still opted
 * in; never skipped, pending or sent ones.
 */
export interface WrappedFailedList {
  /** The year the list is for. */
  year: number;
  /** One item per failed DM, ordered by user id, at most 200. */
  items: { userId: string; state: "failed" }[];
  /** More failed DMs exist than `items` holds. */
  truncated: boolean;
}

/** What an admin's private preview run is doing. */
export type PreviewRunState =
  /** The admin has no preview. */
  | "idle"
  /** Building the sampled (or, with `all`, every) member's snapshot and the server snapshot. */
  | "processing"
  /** Built; the preview DMs to the admin are about to start. */
  | "processed"
  /** DMing the previews to the admin. */
  | "sending"
  /** Finished (check `dmFailed`). */
  | "done"
  /** Stopped by an error. */
  | "failed"
  /** Was processing or sending but has not updated for 120 seconds. */
  | "interrupted";

/** One sampled member of a preview. */
export interface PreviewMember {
  /** The member. */
  userId: string;
  /** Their display name when the preview was built; null when unknown. */
  displayName: string | null;
  /** True when they have not opted in, so the real run would not DM them. */
  wouldSkip: boolean;
  /** False when they had no activity that year (no link was made). */
  hasLink: boolean;
}

/**
 * An admin's private Wrapped preview, as `GET /api/activity/wrapped/preview`
 * returns it to its owner (and to nobody else).
 */
export interface PreviewStatus {
  /** The preview run's id; null when there is none. */
  id: number | null;
  /** What it is doing. */
  status: PreviewRunState;
  /** The year previewed; null when there is none. */
  year: number | null;
  /** Members to process (the sample, or everyone with `all`). */
  total: number;
  /** Members processed so far. */
  done: number;
  /** Whether every member was processed (the dry run). */
  all: boolean;
  /** The sampled members, in DM order. */
  sampled: PreviewMember[];
  /** Processed members who have not opted in (the real run would skip them). */
  wouldSkip: number;
  /** True when the preview could not be DM'd to the admin (closed DMs). */
  dmFailed: boolean;
  /** The sampled members' private links. */
  links: { userId: string; token: string }[];
  /** The private server story's token; null until built. */
  serverToken: string | null;
  /** When the preview and its links expire (14 days after the start); null when there is none. */
  expiresAt: number | null;
  /** What went wrong, in plain words; null when nothing did. */
  error: string | null;
  /** When the preview started; null when there is none. */
  startedAt: number | null;
  /** When it finished; null while it runs or when there is none. */
  finishedAt: number | null;
}

/** `POST /api/activity/wrapped/preview`. 202 when started, 409 already running, 400 invalid. */
export interface PreviewStartResponse {
  result: "started" | "already-running" | "invalid";
  /** Why the request was invalid; absent otherwise. */
  error?: string;
  status: PreviewStatus;
}

/** `POST /api/activity/wrapped/preview/discard`. */
export interface PreviewDiscardResponse {
  /** `discarded`; `nothing` when the admin has no preview; `running` while it is processing or sending. */
  result: "discarded" | "nothing" | "running";
}
