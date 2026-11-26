import type { Listener, Schedule } from "../../../core/plugin.ts";

/**
 * Gateway listeners that record activity facts live (messages, emoji,
 * reactions, voice, membership, commands). Empty until the capture lane lands.
 */
export const captureListeners: Listener[] = [];

/**
 * Scheduled jobs of the capture side, such as keeping open voice sessions'
 * `lastSeenAt` fresh. Empty until the capture lane lands.
 */
export const captureSchedules: Schedule[] = [];
