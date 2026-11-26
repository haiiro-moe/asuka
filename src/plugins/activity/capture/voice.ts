/**
 * Voice capture: turning voice state changes into voice segments.
 *
 * A segment is one stretch of a member in one channel with the same flags
 * (`VoiceSnapshot`). {@link planVoice} decides, as pure logic, what a change
 * does to the member's open segment; {@link applyVoice} reads the open segment
 * from `activity_voice` and carries the plan out through the write API.
 * See docs/activity/capture.md.
 */
import type { VoiceState } from "discord.js";
import { and, desc, eq, isNull } from "drizzle-orm";
import { db, schema } from "../../../db/index.ts";
import { isExcluded } from "../exclusion.ts";
import { closeVoiceSegment, openVoiceSegment } from "../record.ts";
import type { VoiceSnapshot } from "../record.ts";

/** A member's open voice segment: the state it records and when it started. */
export interface OpenVoiceSegment extends VoiceSnapshot {
  /** When the segment started, in unix seconds. */
  startedAt: number;
}

/**
 * One step of a voice plan: close the member's open segment, or open a new one
 * with the given state.
 */
export type VoiceAction = { kind: "close" } | { kind: "open"; snapshot: VoiceSnapshot };

/** True when two snapshots are the same channel with the same flags. */
function sameState(a: VoiceSnapshot, b: VoiceSnapshot): boolean {
  return (
    a.channelId === b.channelId &&
    a.muted === b.muted &&
    a.deafened === b.deafened &&
    a.streaming === b.streaming &&
    a.video === b.video
  );
}

/**
 * Plan what a voice state change does to a member's segments.
 *
 * @param prev - The member's open segment; null when none is open.
 * @param next - The member's new state; null when they are no longer in a
 *   recorded channel (they left, or moved to an excluded channel).
 * @returns The actions to run in order: nothing when the state is unchanged,
 *   `open` on a join, `close` on a leave, and `close` then `open` when the
 *   channel or any flag changed.
 *
 * @example
 * ```ts
 * planVoice(null, a);                 // [{ kind: "open", snapshot: a }]
 * planVoice(open, { ...a, muted: true }); // [{ kind: "close" }, { kind: "open", ... }]
 * ```
 */
export function planVoice(prev: OpenVoiceSegment | null, next: VoiceSnapshot | null): VoiceAction[] {
  if (prev === null) return next === null ? [] : [{ kind: "open", snapshot: next }];
  if (next === null) return [{ kind: "close" }];
  if (sameState(prev, next)) return [];
  return [{ kind: "close" }, { kind: "open", snapshot: next }];
}

/**
 * The recordable state of a discord.js voice state.
 *
 * Self and server mute both count as muted, self and server deafen both as
 * deafened. A flag discord.js does not know (null) counts as off. Reads the
 * excluded-channel list, so call it only after `initDb()` has run.
 *
 * @param state - A member's voice state.
 * @returns The snapshot, or null when the member is not in a channel or the
 *   channel is excluded.
 */
export function snapshotOf(state: VoiceState): VoiceSnapshot | null {
  const channelId = state.channelId;
  if (!channelId || isExcluded(channelId)) return null;
  return {
    channelId,
    muted: state.selfMute === true || state.serverMute === true,
    deafened: state.selfDeaf === true || state.serverDeaf === true,
    streaming: state.streaming === true,
    video: state.selfVideo === true,
  };
}

/**
 * A member's open segment, as recorded in `activity_voice`.
 *
 * @param userId - The member.
 * @returns The open segment, or null when none is open. If there were ever more
 *   than one, the latest is returned.
 */
export function openSegmentOf(userId: string): OpenVoiceSegment | null {
  const row = db
    .select()
    .from(schema.activityVoice)
    .where(and(eq(schema.activityVoice.userId, userId), isNull(schema.activityVoice.endedAt)))
    .orderBy(desc(schema.activityVoice.startedAt), desc(schema.activityVoice.id))
    .get();
  if (!row) return null;
  return {
    channelId: row.channelId,
    muted: row.muted === 1,
    deafened: row.deafened === 1,
    streaming: row.streaming === 1,
    video: row.video === 1,
    startedAt: row.startedAt,
  };
}

/**
 * Bring a member's segments in line with their new voice state.
 *
 * The previous state is read from the open segment in the database, not from
 * the gateway's old state, so a missed event is corrected by the next one.
 *
 * @param userId - The member.
 * @param next - Their new state, from {@link snapshotOf}.
 * @param ts - When the change happened, in unix seconds.
 */
export function applyVoice(userId: string, next: VoiceSnapshot | null, ts: number): void {
  for (const action of planVoice(openSegmentOf(userId), next)) {
    if (action.kind === "close") closeVoiceSegment(userId, ts);
    else openVoiceSegment(userId, action.snapshot, ts);
  }
}
