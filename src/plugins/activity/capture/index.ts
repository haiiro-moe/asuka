/**
 * Live capture: the gateway listeners and the voice heartbeat of the activity
 * plugin. The handlers live in `listeners.ts`; this file binds them to their
 * events. See docs/activity/capture.md.
 */
import { Events } from "discord.js";
import { defineListener } from "../../../core/plugin.ts";
import type { Listener, Schedule } from "../../../core/plugin.ts";
import { nowSec } from "../../../core/util.ts";
import { getConfig } from "../../../db/index.ts";
import { closeDanglingVoiceSegments, touchVoiceSegments } from "../record.ts";
import {
  onMemberAdd,
  onMemberRemove,
  onMessageCreate,
  onReactionAdd,
  onReactionRemove,
  onReady,
  onVoiceStateUpdate,
} from "./listeners.ts";

/**
 * Gateway listeners that record activity facts live: messages (with their
 * mentions and emoji), reactions added and removed, joins and leaves, voice
 * segments, and the voice resume on `ClientReady`. Slash commands and Social
 * Credits are recorded by hooks in core code (`capture/hooks.ts`).
 */
export const captureListeners: Listener[] = [
  defineListener({ event: Events.MessageCreate, handle: onMessageCreate }),
  defineListener({ event: Events.MessageReactionAdd, handle: (ctx, reaction, user) => onReactionAdd(ctx, reaction, user) }),
  defineListener({
    event: Events.MessageReactionRemove,
    handle: (ctx, reaction, user) => onReactionRemove(ctx, reaction, user),
  }),
  defineListener({ event: Events.GuildMemberAdd, handle: onMemberAdd }),
  defineListener({ event: Events.GuildMemberRemove, handle: onMemberRemove }),
  defineListener({ event: Events.VoiceStateUpdate, handle: onVoiceStateUpdate }),
  defineListener({ event: Events.ClientReady, once: true, handle: (ctx) => onReady(ctx) }),
];

/**
 * The voice heartbeat, once a minute.
 *
 * While activity is enabled it stamps `lastSeenAt` on every open segment, so a
 * restart can close them at the last minute the bot saw them. While it is
 * disabled it closes the open segments at their last heartbeat instead, so the
 * disabled time is never counted when recording is turned back on.
 */
function voiceHeartbeat(): void {
  try {
    if (getConfig().activityEnabled) touchVoiceSegments(nowSec());
    else closeDanglingVoiceSegments();
  } catch (err) {
    console.error("[activity] voice heartbeat failed:", err);
  }
}

/** Scheduled jobs of live capture: the voice heartbeat. */
export const captureSchedules: Schedule[] = [
  { name: "voice-activity-heartbeat", cron: "* * * * *", run: voiceHeartbeat },
];
