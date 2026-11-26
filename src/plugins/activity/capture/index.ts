/**
 * Live capture: the gateway listeners and the voice heartbeat of the activity
 * plugin. The handlers live in `listeners.ts`; this file binds them to their
 * events. See docs/activity/capture.md.
 */
import { Events } from "discord.js";
import { defineListener } from "../../../core/plugin.ts";
import type { Listener, Schedule } from "../../../core/plugin.ts";
import {
  onMemberAdd,
  onMemberRemove,
  onMessageCreate,
  onReactionAdd,
  onReactionRemove,
  onReady,
  onVoiceStateUpdate,
  voiceHeartbeat,
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
 * Scheduled jobs of live capture: the voice heartbeat, once a minute. It
 * reconciles open segments with the live voice states and stamps `lastSeenAt`
 * (see `voiceHeartbeat` in `listeners.ts`).
 */
export const captureSchedules: Schedule[] = [
  { name: "voice-activity-heartbeat", cron: "* * * * *", run: (ctx) => voiceHeartbeat(ctx) },
];
