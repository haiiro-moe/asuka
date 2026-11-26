/**
 * Response types of the president-tier activity routes
 * (`GET /api/activity/president/*`).
 *
 * This file holds types only and imports nothing, so the web app can import it
 * without pulling in server code.
 *
 * Every value is a number, a list of numbers or `null`. There is no id and no
 * name in any of them. `null` means **hidden**: the number exists but is too
 * small to show without pointing at one or two members. Draw it as "off",
 * never as 0. A real 0 is sent as 0. See docs/activity/queries-president.md.
 */

/**
 * The periods a president view can be asked for, as the `?period=` value.
 *
 * - `week`: the seven full UTC days before today.
 * - `term`: from the start of the current presidency term up to today 00:00
 *   UTC (the 90 days before today when no term is on record).
 *
 * Both end at today 00:00 UTC, so the numbers change once a day.
 */
export type PresidentPeriodName = "week" | "term";

/** `GET /api/activity/president/connection`: how connected the members are. */
export interface PresidentConnection {
  /**
   * Members who are part of a group of three or more (the groups of
   * {@link PresidentGroupSizes.sizes}, added up). 0 when there is no such group.
   */
  connected: number | null;
  /**
   * Members active in the period: {@link PresidentConnection.connected} plus
   * {@link PresidentGroupSizes.other}. Hidden whenever `other` is hidden,
   * because the difference to `connected` would give `other` away.
   */
  total: number | null;
  /**
   * How many groups of three or more there are: the length of
   * {@link PresidentGroupSizes.sizes}. It counts groups, not members, so it is
   * shown at 1 and 2 as well and is not `null` today.
   */
  groups: number | null;
  /**
   * Bridges: pairs of members who are tied to each other across two of those
   * groups. Hidden at 1 and 2.
   */
  bridges: number | null;
  /**
   * Members who have gone quiet: active earlier, nothing for the last 30 days
   * before the period ends. Hidden at 1 and 2. The same for both periods.
   */
  quiet: number | null;
}

/**
 * `GET /api/activity/president/weekly`: activity per UTC week.
 *
 * Both lists have one entry for every UTC calendar week (Monday 00:00 to
 * Monday 00:00) the period touches, oldest first. The first and the last week
 * can be partial: only the part inside the period is counted. The last entry
 * is the week that holds yesterday.
 */
export interface PresidentWeeklySeries {
  /** Replies from one member to another, per week. */
  replies: number[];
  /** Hours members spent connected to voice, added up over members, per week. One decimal. */
  voiceHours: number[];
}

/** `GET /api/activity/president/groups`: how large the groups are. */
export interface PresidentGroupSizes {
  /** Member count of every group of three or more, largest first. */
  sizes: number[];
  /**
   * Active members outside those groups (pairs, and members tied to nobody),
   * added up. Hidden when that is 1 or 2; 0 when there are none.
   */
  other: number | null;
}

/** `GET /api/activity/president/engagement`: how much is going on. */
export interface PresidentEngagement {
  /** Messages written in the period. */
  messages: number;
  /**
   * Members who wrote a message or were in voice in the period. Always the
   * same value as {@link PresidentConnection.total}, hidden when that is.
   */
  activeMembers: number | null;
  /** Hours members spent connected to voice, added up over members. One decimal. */
  voiceHours: number;
}

/** `GET /api/activity/president/clubs`: club and event health. */
export interface PresidentClubEventHealth {
  /**
   * Approved clubs with a message or voice time in their channels in the
   * period. Hidden together with {@link PresidentClubEventHealth.clubsQuiet} when either is 1 or 2.
   */
  clubsActive: number | null;
  /** Approved clubs with nothing in their channels in the period. */
  clubsQuiet: number | null;
  /** Event occurrences that started in the period. */
  eventsHeld: number;
  /**
   * Members signed up per held occurrence, on average. One decimal. Hidden
   * when it is above 0 and under 3; 0 when nothing was held or nobody signed up.
   */
  avgAttendance: number | null;
}
