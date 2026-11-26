/**
 * Shapes returned by the admin-tier activity views (`queries/admin.ts`,
 * served under `/api/activity/admin/`). Admins see names, so these carry user
 * ids. Pure types: the web app imports this file.
 */

/** How often one moderation action was taken. */
export interface ActionCount {
  /** The `mod_log` action, e.g. `warn` or `timeout`. */
  action: string;
  /** Times it was taken in the period. */
  count: number;
}

/** Moderation over time: `GET /api/activity/admin/moderation`. */
export interface ModerationSeries {
  /**
   * Start of the first bucket of `weekly`, in unix seconds (UTC). Bucket `i`
   * covers `start + i * 7 days` up to the next one. For a bounded period it is
   * the period's start. For `all` it is the 7-day boundary (counted from the
   * epoch) at or before the earliest message, mod-log or credits row, or the
   * week before the current one when there is no data.
   */
  start: number;
  /** Moderation actions per 7-day bucket, oldest first; empty weeks are 0. */
  weekly: number[];
  /** Actions in the period by kind, most frequent first. */
  byAction: ActionCount[];
}

/** A member who was warned, timed out, kicked or banned more than once. */
export interface OffenderRow {
  /** The member. */
  userId: string;
  /** Warnings plus timeouts, kicks and bans in the period. */
  count: number;
}

/** A member who joined in the period and how their first week went. */
export interface NewcomerRow {
  /** The member. */
  userId: string;
  /** Their first join in the period, in unix seconds. */
  joinedAt: number;
  /** True when someone else replied to a message they sent in their first week, within that week. */
  gotReplyInWeek: boolean;
  /** Messages they sent in the seven days after joining. */
  messagesInWeek: number;
}

/** A member who was active before and has gone quiet. */
export interface DriftRow {
  /** The member. */
  userId: string;
  /** Their last message or voice activity, in unix seconds. */
  lastActiveAt: number;
}

/** Health of one text channel. Threads count under their parent channel. */
export interface ChannelHealthRow {
  /** The channel. */
  channelId: string;
  /** Messages sent in the period. */
  messages: number;
  /** Share of those messages nobody else replied to, 0 to 100, one decimal. */
  unansweredPct: number;
  /** Median seconds from a message to its first reply; null when none was answered. */
  medianReplySec: number | null;
}

/** Social Credits moved in one 7-day bucket. */
export interface EconomyWeek {
  /** Credits earned (sum of positive changes). */
  in: number;
  /** Credits spent, as a positive number (sum of negative changes, negated). */
  out: number;
}

/** A member ranked by credits earned minus credits spent. */
export interface EarnerRow {
  /** The member. */
  userId: string;
  /** Sum of their balance changes in the period. */
  net: number;
}

/** The Social Credits economy: `GET /api/activity/admin/economy`. */
export interface Economy {
  /** Credits earned in the period. */
  creditsIn: number;
  /** Credits spent in the period, as a positive number. */
  creditsOut: number;
  /**
   * Start of the first bucket of `weekly`, in unix seconds (UTC). Always the
   * same as {@link ModerationSeries.start} for the same period, so the two
   * series line up; see it for the rule.
   */
  start: number;
  /** Earned and spent per 7-day bucket, oldest first; empty weeks are zeros. */
  weekly: EconomyWeek[];
  /** Members with the highest positive net, at most 10. */
  topEarners: EarnerRow[];
  /** Store purchases made in the period. */
  storeSales: number;
}

/** One approved club and its message activity. */
export interface ClubRow {
  /** The club id. */
  id: number;
  /** The club name. */
  name: string;
  /** Messages in the club's channels and threads in the period. */
  messages: number;
  /** True when the club is older than `QUIET_DAYS` and nobody wrote in it for `QUIET_DAYS` days. */
  dead: boolean;
}

/** One event that ran in the period and how many signed up. */
export interface EventRow {
  /** The event id. */
  id: number;
  /** The event title. */
  title: string;
  /** Members on its participant list. */
  attendees: number;
}

/** Clubs and events: `GET /api/activity/admin/clubs-events`. */
export interface ClubsAndEvents {
  /** Approved clubs, busiest first. */
  clubs: ClubRow[];
  /** Events that ran in the period, best attended first. */
  events: EventRow[];
}

/** One slash command's usage. */
export interface CommandUsageRow {
  /** The command name, without the slash. */
  name: string;
  /** Runs in the period. */
  uses: number;
  /** Runs that failed. */
  failures: number;
}

/** Which interactions a relationship weight counts. */
export type RelationKind = "replies" | "mentions" | "voice";

/**
 * Two members and how strongly they are linked. Symmetric: `a` is the
 * smaller id, and both directions are summed into one pair.
 */
export interface RelationPair {
  /** One member (the smaller id). */
  a: string;
  /** The other member. */
  b: string;
  /** Replies or mentions between them, or seconds spent together in voice. */
  weight: number;
}

/** A member someone interacts with, and how much. */
export interface CloseRow {
  /** The other member. */
  userId: string;
  /** Replies and mentions between the two, both directions. */
  weight: number;
}

/** One member's profile: `GET /api/activity/admin/inspect/:userId`. */
export interface MemberInspect {
  /** Messages they sent. */
  sent: number;
  /** Replies and mentions they got from others. */
  received: number;
  /** Distinct members they replied to, mentioned, or got a reply or mention from. */
  ties: number;
  /** The UTC hour (0 to 23) they sent most messages in; null without messages. */
  busiestHour: number | null;
  /** Their strongest ties, at most 5. */
  closest: CloseRow[];
}
