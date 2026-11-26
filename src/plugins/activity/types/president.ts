/**
 * Response types of the president-tier activity routes
 * (`GET /api/activity/president/*`).
 *
 * This file holds types only and imports nothing, so the web app can import it
 * without pulling in server code.
 *
 * Every value is a number, a list of numbers or `null`. There is no id and no
 * name in any of them. `null` means **hidden**: the number exists, but showing
 * it would point at one or two members, on its own or held against another
 * number the president can see (the same number of the other period, or the
 * parts it is the sum of). Draw it as "off", never as 0. A real 0 is sent as 0.
 *
 * The two voice figures are the exception: there `null` means that the voice
 * log is not old enough to be used yet (two whole months, see
 * `voice-ready.ts`). Say when voice stats unlock instead of showing a 0; the
 * date is in `GET /api/activity/user/voice-status`. Until then no other number
 * here uses voice either: active members, groups, "gone quiet" and club
 * activity come from messages alone.
 *
 * See docs/activity/queries-president.md.
 */

/**
 * The periods a president view can be asked for, as the `?period=` value.
 *
 * - `week`: the seven full UTC days before today.
 * - `term`: from the start of the current presidency term up to today 00:00
 *   UTC (the 90 days before today when no term is on record).
 *
 * Both end at today 00:00 UTC, so the numbers change once a day, and one of
 * the two always lies inside the other. The shorter one (usually the week) is
 * shown as it is. In the longer one, a number that is 1 or 2 away from the
 * shorter one's is hidden.
 */
export type PresidentPeriodName = "week" | "term";

/** `GET /api/activity/president/connection`: how connected the members are. */
export interface PresidentConnection {
  /**
   * Members in a group of three or more. A pair, or a member tied to nobody,
   * is never shown as such: they only ever count into
   * {@link PresidentGroupSizes.other} and {@link PresidentConnection.total}.
   * 0 when there is no such group. Hidden when a group is left out of
   * {@link PresidentGroupSizes.sizes}; otherwise it is those sizes added up.
   */
  connected: number | null;
  /**
   * Members active in the period: {@link PresidentConnection.connected} plus
   * {@link PresidentGroupSizes.other}. Hidden exactly when `other` is hidden,
   * because the difference to `connected` would give `other` away.
   */
  total: number | null;
  /**
   * How many groups of three or more there are. It counts groups, not members,
   * so it is shown at 1 and 2 as well and is not `null` today. It is the
   * length of {@link PresidentGroupSizes.sizes}, except in the longer period
   * when a group is left out of that list: then it is larger by the groups
   * left out.
   */
  groups: number | null;
  /**
   * Bridges: pairs of members who are tied to each other across two of those
   * groups. Hidden at 1 and 2, and in the longer period when 1 or 2 away from
   * the shorter period's.
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
  /**
   * Hours members spent connected to voice, added up over members, per week.
   * One decimal. `null`, not a list of zeros, while the voice log is too young
   * to be used.
   */
  voiceHours: number[] | null;
}

/** `GET /api/activity/president/groups`: how large the groups are. */
export interface PresidentGroupSizes {
  /**
   * Member count of the groups of three or more, largest first. For the
   * shorter period that is every group. For the longer period a group is left
   * out when its size is 1 or 2 away from a size listed for the shorter
   * period, unless the shorter period lists a group of exactly its size (and
   * all are left out when their sum is 1 or 2 away from the shorter period's
   * `connected`). A group that is left out is counted nowhere else.
   */
  sizes: number[];
  /**
   * Active members outside the groups of three or more (pairs, and members
   * tied to nobody), added up. 0 when there are none. Hidden when it is 1 or
   * 2, and in the longer period also when a group is left out of `sizes`, when
   * the shorter period hides its own, or when it or the total is 1 or 2 away
   * from the shorter period's.
   */
  other: number | null;
}

/** `GET /api/activity/president/engagement`: how much is going on. */
export interface PresidentEngagement {
  /** Messages written in the period. */
  messages: number;
  /**
   * Members who wrote a message or were in voice in the period (who wrote a
   * message, while the voice log is too young to be used). Always the same
   * value as {@link PresidentConnection.total}, hidden when that is.
   */
  activeMembers: number | null;
  /**
   * Hours members spent connected to voice, added up over members. One
   * decimal. `null`, not 0, while the voice log is too young to be used.
   */
  voiceHours: number | null;
}

/** `GET /api/activity/president/clubs`: club and event health. */
export interface PresidentClubEventHealth {
  /**
   * Approved clubs with a message or voice time in their channels in the
   * period. Hidden together with {@link PresidentClubEventHealth.clubsQuiet}
   * when either is 1 or 2, and in the longer period when either is 1 or 2 away
   * from the shorter period's.
   */
  clubsActive: number | null;
  /** Approved clubs with nothing in their channels in the period. */
  clubsQuiet: number | null;
  /** Event occurrences that started in the period. */
  eventsHeld: number;
  /**
   * Members signed up per held occurrence, on average. One decimal. Hidden
   * when it is above 0 and under 3, and in the longer period when the
   * occurrences outside the shorter period have such an average; 0 when
   * nothing was held or nobody signed up.
   */
  avgAttendance: number | null;
}
