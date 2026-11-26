/**
 * The write API of the activity log.
 *
 * Every row in the event tables (`activity_messages`, `activity_mentions`,
 * `activity_emoji`, `activity_reactions`, `activity_voice`,
 * `activity_membership`, `activity_commands`, `activity_credits`) is written
 * through the functions here. Live capture, the history backfill and the seed
 * script call them; nothing else inserts into those tables.
 *
 * All of them are synchronous and return as soon as the row is written. Writing
 * the same message or reaction twice is not an error: the unique keys make the
 * second write a no-op, which is what lets capture and the backfill overlap.
 *
 * They read the guild config, so call them only after `initDb()` has run
 * (inside a handler, never at module top level). They do not look at
 * `guild_config.activityEnabled`: the caller decides whether to record at all.
 * See docs/activity/foundation.md.
 */
import { and, eq, isNull, sql } from "drizzle-orm";
import { nowSec } from "../../core/util.ts";
import { db, schema } from "../../db/index.ts";
import { isExcluded } from "./exclusion.ts";
import type { MessageFacts } from "./facts.ts";

/**
 * Record one message: its row, one row per mentioned user and one row per
 * distinct emoji, in a single transaction, so a message is stored whole or not
 * at all.
 *
 * @param f - The facts, from `extractMessageFacts`.
 * @returns True when the message was written. False, with nothing written, when
 *   the message is already recorded (same `messageId`) or its channel, or the
 *   parent channel of its thread, is excluded.
 */
export function recordMessage(f: MessageFacts): boolean {
  if (isExcluded(f.channelId, f.parentChannelId)) return false;

  const mentioned = [...new Set(f.mentionedUserIds)];

  return db.transaction((tx) => {
    const inserted = tx
      .insert(schema.activityMessages)
      .values({
        messageId: f.messageId,
        userId: f.userId,
        channelId: f.channelId,
        parentChannelId: f.parentChannelId,
        ts: f.ts,
        replyToUserId: f.replyToUserId,
        replyToMessageId: f.replyToMessageId,
        mentionCount: mentioned.length,
        attachmentKinds: f.attachmentKinds.join(","),
        linkDomains: f.linkDomains.join(","),
        stickerCount: f.stickerCount,
        length: f.length,
        source: f.source,
      })
      .onConflictDoNothing()
      .returning({ id: schema.activityMessages.id })
      .all();
    // Already recorded: its mention and emoji rows were written with it.
    if (inserted.length === 0) return false;

    if (mentioned.length > 0) {
      tx.insert(schema.activityMentions)
        .values(
          mentioned.map((toUserId) => ({
            messageId: f.messageId,
            ts: f.ts,
            fromUserId: f.userId,
            toUserId,
            channelId: f.channelId,
          })),
        )
        .onConflictDoNothing()
        .run();
    }

    if (f.emoji.length > 0) {
      tx.insert(schema.activityEmoji)
        .values(
          f.emoji.map((e) => ({
            messageId: f.messageId,
            ts: f.ts,
            userId: f.userId,
            channelId: f.channelId,
            emoji: e.emoji,
            name: e.name,
            count: e.count,
          })),
        )
        .onConflictDoNothing()
        .run();
    }

    return true;
  });
}

/**
 * Record a reaction being added.
 *
 * There is one row per (`messageId`, `userId`, `emoji`). Adding a reaction that
 * is already recorded keeps that row: `removedAt` is cleared, so re-adding after
 * a removal makes the reaction count again, and `addedAt` stays the time of the
 * first add. A message author that was unknown before is filled in.
 *
 * Nothing is written when `channelId` is excluded. For a reaction in a thread
 * the caller must also check the parent channel (`isExcluded(threadId,
 * parentId)`), which this function is not given.
 *
 * @param r - The reaction.
 * @param r.messageId - The message reacted to.
 * @param r.userId - The member who reacted.
 * @param r.emoji - The emoji key, as `ParsedEmoji.emoji`: the unicode emoji
 *   itself (without U+FE0F) or `custom:<id>`.
 * @param r.name - The custom emoji's name; null for a unicode emoji.
 * @param r.channelId - The channel, or the thread, the message is in.
 * @param r.messageAuthorId - Author of the message reacted to; null when unknown.
 * @param r.ts - When the reaction was added, in unix seconds.
 */
export function recordReactionAdd(r: {
  messageId: string;
  userId: string;
  emoji: string;
  name: string | null;
  channelId: string;
  messageAuthorId: string | null;
  ts: number;
}): void {
  if (isExcluded(r.channelId)) return;

  db.insert(schema.activityReactions)
    .values({
      messageId: r.messageId,
      userId: r.userId,
      emoji: r.emoji,
      name: r.name,
      channelId: r.channelId,
      messageAuthorId: r.messageAuthorId,
      addedAt: r.ts,
      removedAt: null,
    })
    .onConflictDoUpdate({
      target: [
        schema.activityReactions.messageId,
        schema.activityReactions.userId,
        schema.activityReactions.emoji,
      ],
      set: {
        removedAt: null,
        messageAuthorId: sql`coalesce(${schema.activityReactions.messageAuthorId}, excluded.message_author_id)`,
      },
    })
    .run();
}

/**
 * Record a reaction being removed. The row is kept and stamped with
 * `removedAt`, so it no longer counts.
 *
 * Nothing happens when the reaction was never recorded (it was added before
 * capture started) or is already marked removed.
 *
 * @param messageId - The message the reaction was on.
 * @param userId - The member who had reacted.
 * @param emoji - The emoji key, as `ParsedEmoji.emoji`.
 * @param ts - When the reaction was removed, in unix seconds.
 */
export function recordReactionRemove(messageId: string, userId: string, emoji: string, ts: number): void {
  db.update(schema.activityReactions)
    .set({ removedAt: ts })
    .where(
      and(
        eq(schema.activityReactions.messageId, messageId),
        eq(schema.activityReactions.userId, userId),
        eq(schema.activityReactions.emoji, emoji),
        isNull(schema.activityReactions.removedAt),
      ),
    )
    .run();
}

/**
 * Record a member joining or leaving the guild.
 *
 * @param userId - The member.
 * @param kind - `join` or `leave`.
 * @param ts - When it happened, in unix seconds.
 */
export function recordMembership(userId: string, kind: "join" | "leave", ts: number): void {
  db.insert(schema.activityMembership).values({ userId, kind, ts }).run();
}

/**
 * A member's voice state at one moment. A voice segment is the time a member
 * spends in one channel with these flags unchanged: when any of them changes,
 * the segment is closed and a new one is opened.
 */
export interface VoiceSnapshot {
  /** The voice channel the member is connected to. */
  channelId: string;
  /** Muted, by the member or by the server. */
  muted: boolean;
  /** Deafened, by the member or by the server. */
  deafened: boolean;
  /** Sharing their screen. */
  streaming: boolean;
  /** Camera on. */
  video: boolean;
}

/**
 * Open a voice segment for a member.
 *
 * A member has at most one open segment. If one is still open it is closed at
 * `ts` first, so a member's segments never overlap, whatever the caller missed.
 * Nothing is opened when the channel is excluded.
 *
 * @param userId - The member.
 * @param s - The member's voice state for this segment.
 * @param ts - When the segment starts, in unix seconds.
 */
export function openVoiceSegment(userId: string, s: VoiceSnapshot, ts: number): void {
  const excluded = isExcluded(s.channelId);

  db.transaction((tx) => {
    tx.update(schema.activityVoice)
      .set({ endedAt: ts, lastSeenAt: ts })
      .where(and(eq(schema.activityVoice.userId, userId), isNull(schema.activityVoice.endedAt)))
      .run();
    if (excluded) return;

    tx.insert(schema.activityVoice)
      .values({
        userId,
        channelId: s.channelId,
        startedAt: ts,
        endedAt: null,
        lastSeenAt: ts,
        muted: s.muted ? 1 : 0,
        deafened: s.deafened ? 1 : 0,
        streaming: s.streaming ? 1 : 0,
        video: s.video ? 1 : 0,
      })
      .run();
  });
}

/**
 * Close a member's open voice segment. Nothing happens when none is open.
 *
 * @param userId - The member.
 * @param ts - When the segment ends, in unix seconds.
 */
export function closeVoiceSegment(userId: string, ts: number): void {
  db.update(schema.activityVoice)
    .set({ endedAt: ts, lastSeenAt: ts })
    .where(and(eq(schema.activityVoice.userId, userId), isNull(schema.activityVoice.endedAt)))
    .run();
}

/**
 * Heartbeat: mark every open voice segment as still live at `ts`.
 *
 * Called on a schedule. `lastSeenAt` is what {@link closeDanglingVoiceSegments}
 * falls back on when the bot stops without seeing the member leave.
 *
 * @param ts - The current time, in unix seconds.
 */
export function touchVoiceSegments(ts: number): void {
  db.update(schema.activityVoice)
    .set({ lastSeenAt: ts })
    .where(isNull(schema.activityVoice.endedAt))
    .run();
}

/**
 * Close every voice segment that is still open, each at its own `lastSeenAt`.
 *
 * Call it once on boot, before reopening segments for the members who are
 * connected: a segment left open by a restart ends at the last heartbeat, not at
 * the time the bot came back.
 *
 * @returns How many segments were closed.
 */
export function closeDanglingVoiceSegments(): number {
  const closed = db
    .update(schema.activityVoice)
    .set({ endedAt: sql`${schema.activityVoice.lastSeenAt}` })
    .where(isNull(schema.activityVoice.endedAt))
    .returning({ id: schema.activityVoice.id })
    .all();
  return closed.length;
}

/**
 * Record one slash command run.
 *
 * @param userId - The member who ran it.
 * @param name - The command name, without the leading slash.
 * @param ok - True when the command completed, false when it failed.
 * @param ts - When it ran, in unix seconds. Defaults to the current time.
 */
export function recordCommand(userId: string, name: string, ok: boolean, ts: number = nowSec()): void {
  db.insert(schema.activityCommands)
    .values({ userId, name, ok: ok ? 1 : 0, ts })
    .run();
}

/**
 * Record one change to a member's Social Credits balance.
 *
 * @param userId - The member.
 * @param delta - The signed change: positive for credits earned, negative for credits spent.
 * @param balanceAfter - The member's balance after the change.
 * @param ts - When it happened, in unix seconds. Defaults to the current time.
 */
export function recordCredit(userId: string, delta: number, balanceAfter: number, ts: number = nowSec()): void {
  db.insert(schema.activityCredits).values({ userId, delta, balanceAfter, ts }).run();
}
