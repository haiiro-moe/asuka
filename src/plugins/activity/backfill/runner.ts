/**
 * The history backfill: reads a channel's message history page by page and
 * records it through the same write API live capture uses, so the activity log
 * covers the time before capture started.
 *
 * Properties the rest of the system relies on:
 *
 * - **Idempotent.** Messages go through `extractMessageFacts(raw, "backfill")`
 *   and `recordMessage`, which ignore a message id that is already stored.
 *   Running it twice, or alongside live capture, never double counts.
 * - **Resumable.** The cursor (`activity_backfill.beforeId`) is saved after every
 *   page. A run that is stopped, crashes or is cut short by a restart carries
 *   on from the last saved page.
 * - **Derived status.** {@link getBackfillStatus} reads the `activity_backfill`
 *   rows plus the in-memory run, so it is right after a restart too.
 * - **Background.** {@link startBackfill} returns at once; the run is never
 *   awaited by a route. One run at a time.
 *
 * Voice time cannot be backfilled: Discord keeps no history of it. See
 * docs/activity/backfill.md.
 */
import { and, eq, isNull } from "drizzle-orm";
import type { BotContext } from "../../../core/plugin.ts";
import { nowSec } from "../../../core/util.ts";
import { db, schema } from "../../../db/index.ts";
import { isExcluded } from "../exclusion.ts";
import { extractMessageFacts } from "../facts.ts";
import { recordMessage, recordReactionAdd } from "../record.ts";
import { listBackfillChannels } from "./discord.ts";
import type { BackfillChannel, FetchPage } from "./channel.ts";
import type { BackfillStatus, FetchReactionPage } from "./types.ts";

export type { BackfillChannel, FetchPage } from "./channel.ts";
export type { BackfillStatus, FetchReactionPage, RawReaction, ReactionMessage } from "./types.ts";

/** Default pause between two pages, in milliseconds, to stay well inside Discord's rate limits. */
const DEFAULT_PAGE_DELAY_MS = 250;

/**
 * Discord error codes that mean "this channel cannot be read": 50001 missing
 * access, 50013 missing permissions, 10003 unknown channel (deleted mid-run).
 * The channel is marked done and the run goes on.
 */
const SKIPPABLE_CODES = new Set([50001, 50013, 10003]);

/** Options of {@link backfillChannel} and {@link backfillReactions}. */
export interface BackfillOptions {
  /** Pause between pages in milliseconds. Defaults to 250. */
  pageDelayMs?: number;
  /** Stop after this many pages; the channel is then left unfinished. Unlimited by default. */
  maxPages?: number;
  /** Replaces the real sleep; for tests. */
  sleep?: (ms: number) => Promise<void>;
  /** Checked before each page; when it returns true the channel stops, cursor kept. */
  shouldStop?: () => boolean;
}

/** Seams of {@link startBackfill}; production code uses the defaults. */
export interface BackfillDeps {
  /** Lists the channels to read. Defaults to the locked guild's text channels and threads. */
  listChannels?: (ctx: BotContext) => Promise<BackfillChannel[]>;
  /** Replaces the real sleep; for tests. */
  sleep?: (ms: number) => Promise<void>;
  /** Pause between pages in milliseconds. Defaults to 250. */
  pageDelayMs?: number;
}

const realSleep = (ms: number): Promise<void> => Bun.sleep(ms).then(() => undefined);

/** Read the cursor row of a channel. */
function readRow(channelId: string) {
  return db.select().from(schema.activityBackfill).where(eq(schema.activityBackfill.channelId, channelId)).get();
}

/** Create the cursor row of a channel when it has none. */
function ensureRow(channelId: string): void {
  db.insert(schema.activityBackfill).values({ channelId }).onConflictDoNothing().run();
}

/**
 * Mark a channel's message pass finished. With `reactions` (pass it only when
 * the run was started with the reaction pass) its reaction pass is marked too;
 * without it `reactionsDoneAt` is left alone.
 */
function markDone(channelId: string, reactions = false): void {
  const ts = nowSec();
  ensureRow(channelId);
  db.update(schema.activityBackfill)
    .set({ doneAt: ts, updatedAt: ts })
    .where(and(eq(schema.activityBackfill.channelId, channelId), isNull(schema.activityBackfill.doneAt)))
    .run();
  if (reactions) {
    db.update(schema.activityBackfill)
      .set({ reactionsDoneAt: ts, updatedAt: ts })
      .where(and(eq(schema.activityBackfill.channelId, channelId), isNull(schema.activityBackfill.reactionsDoneAt)))
      .run();
  }
}

/**
 * Read one channel's history and record it, resuming from the saved cursor.
 *
 * Pages are fetched newest to oldest. After each page the cursor is saved as
 * the oldest message id of that page, then the function sleeps `pageDelayMs`
 * before the next one. An empty page means the start of the channel was
 * reached, and the channel is marked done.
 *
 * An excluded channel (or a thread under an excluded parent) is marked done
 * without calling `fetchPage`; so is a channel that is already done. When
 * `fetchPage` throws, the error propagates and the cursor stays at the end of
 * the last page that was saved, so calling again resumes from there.
 *
 * @param channelId - The channel or thread id; the key of its cursor row.
 * @param parentId - The parent channel when this is a thread, else null.
 * @param fetchPage - Reads one page of messages, newest first.
 * @param opts - Pacing and stop options.
 * @returns How many messages this call scanned, and whether the channel is now done.
 */
export async function backfillChannel(
  channelId: string,
  parentId: string | null,
  fetchPage: FetchPage,
  opts: BackfillOptions = {},
): Promise<{ scanned: number; done: boolean }> {
  const sleep = opts.sleep ?? realSleep;
  const delay = opts.pageDelayMs ?? DEFAULT_PAGE_DELAY_MS;

  if (isExcluded(channelId, parentId)) {
    markDone(channelId);
    return { scanned: 0, done: true };
  }
  ensureRow(channelId);
  const saved = readRow(channelId)!;
  if (saved.doneAt !== null) return { scanned: 0, done: true };

  let before = saved.beforeId;
  let total = saved.scanned;
  let scanned = 0;
  let pages = 0;

  for (;;) {
    if (opts.shouldStop?.()) return { scanned, done: false };
    if (opts.maxPages !== undefined && pages >= opts.maxPages) return { scanned, done: false };

    const page = await fetchPage(before);
    if (page.length === 0) {
      markDone(channelId);
      return { scanned, done: true };
    }
    pages++;

    for (const raw of page) {
      const facts = extractMessageFacts(raw, "backfill");
      if (facts) recordMessage(facts);
    }
    scanned += page.length;
    total += page.length;
    before = page[page.length - 1]!.id;
    db.update(schema.activityBackfill)
      .set({ beforeId: before, scanned: total, updatedAt: nowSec() })
      .where(eq(schema.activityBackfill.channelId, channelId))
      .run();

    if (opts.maxPages !== undefined && pages >= opts.maxPages) continue;
    await sleep(delay);
  }
}

/** The emoji and reaction rows one page of messages needs, written to the log. */
async function recordReactionPage(
  channelId: string,
  parentId: string | null,
  page: Awaited<ReturnType<FetchReactionPage>>,
): Promise<void> {
  for (const message of page) {
    for (const reaction of message.reactions) {
      const users = await reaction.users();
      for (const user of users) {
        if (user.bot) continue;
        recordReactionAdd({
          messageId: message.id,
          userId: user.id,
          emoji: reaction.emoji,
          name: reaction.name,
          channelId,
          parentChannelId: parentId,
          messageAuthorId: message.authorBot ? null : message.authorId,
          // Discord does not say when a reaction was added; the message's time is the closest honest stamp.
          ts: Math.floor(message.createdTimestamp / 1000),
        });
      }
    }
  }
}

/**
 * The optional reaction pass for one channel: walk its history again and write
 * a reaction row for every (message, member, emoji), then set `reactionsDoneAt`.
 *
 * Bot reactors are skipped, and a message whose author is a bot is recorded
 * with `messageAuthorId: null`. Writes are idempotent, so a pass that was cut
 * short is simply run again from the start (the reaction pass keeps no cursor).
 * An excluded channel is marked done without fetching.
 *
 * Reactions have no timestamp in Discord's API, so each is stamped with the
 * time of its message.
 *
 * @param channelId - The channel or thread id.
 * @param parentId - The parent channel when this is a thread, else null.
 * @param fetchPage - Reads one page of messages with their reactions, newest first.
 * @param opts - Pacing and stop options.
 * @returns True when the pass finished and `reactionsDoneAt` is set.
 */
export async function backfillReactions(
  channelId: string,
  parentId: string | null,
  fetchPage: FetchReactionPage,
  opts: BackfillOptions = {},
): Promise<boolean> {
  const sleep = opts.sleep ?? realSleep;
  const delay = opts.pageDelayMs ?? DEFAULT_PAGE_DELAY_MS;
  const finish = () => {
    ensureRow(channelId);
    const ts = nowSec();
    db.update(schema.activityBackfill)
      .set({ reactionsDoneAt: ts, updatedAt: ts })
      .where(eq(schema.activityBackfill.channelId, channelId))
      .run();
    return true;
  };

  if (isExcluded(channelId, parentId)) return finish();

  let before: string | null = null;
  for (;;) {
    if (opts.shouldStop?.()) return false;
    const page = await fetchPage(before);
    if (page.length === 0) return finish();
    await recordReactionPage(channelId, parentId, page);
    before = page[page.length - 1]!.id;
    await sleep(delay);
  }
}

/** The run of this process: live while `endedAt` is null. */
interface Run {
  startedAt: number;
  endedAt: number | null;
  reactions: boolean;
  current: string | null;
  errors: number;
  stopRequested: boolean;
  fatal: boolean;
  promise: Promise<void>;
}

let run: Run | null = null;

/** The Discord error code carried by a thrown value, if any. */
function errorCode(e: unknown): number | null {
  const code = (e as { code?: unknown } | null)?.code;
  return typeof code === "number" ? code : null;
}

/** Read one channel (and, when asked, its reactions) inside a run; never throws. */
async function runChannel(r: Run, ch: BackfillChannel, deps: BackfillDeps): Promise<void> {
  const opts: BackfillOptions = {
    sleep: deps.sleep,
    pageDelayMs: deps.pageDelayMs,
    shouldStop: () => r.stopRequested,
  };
  r.current = ch.name;
  try {
    const { done } = await backfillChannel(ch.id, ch.parentId, ch.fetchPage, opts);
    if (done && r.reactions && readRow(ch.id)?.reactionsDoneAt == null) {
      await backfillReactions(ch.id, ch.parentId, ch.fetchReactionPage, opts);
    }
  } catch (e) {
    const code = errorCode(e);
    if (code !== null && SKIPPABLE_CODES.has(code)) markDone(ch.id, r.reactions);
    else {
      r.errors++;
      console.error(`[activity] backfill of channel ${ch.id} failed`, e);
    }
  }
}

/** The body of a run. */
async function execute(r: Run, ctx: BotContext, deps: BackfillDeps): Promise<void> {
  try {
    const channels = await (deps.listChannels ?? listBackfillChannels)(ctx);
    for (const ch of channels) ensureRow(ch.id);
    // A row for a channel that is no longer listed (deleted, or lost since an
    // earlier run) can never be read again; close it so it cannot pin the status.
    const listed = new Set(channels.map((ch) => ch.id));
    for (const { channelId } of db.select({ channelId: schema.activityBackfill.channelId }).from(schema.activityBackfill).all()) {
      if (!listed.has(channelId)) markDone(channelId, r.reactions);
    }
    for (const ch of channels) {
      if (r.stopRequested) break;
      await runChannel(r, ch, deps);
    }
  } catch (e) {
    r.fatal = true;
    console.error("[activity] backfill failed", e);
  } finally {
    r.current = null;
    r.endedAt = nowSec();
  }
}

/**
 * Start the backfill in the background. It reads every channel and thread of
 * the locked guild that is not done yet, resuming from the saved cursors, so
 * calling it again after a stop (or a restart) continues the work.
 *
 * Returns at once; the run is never awaited by the caller. Only one run lives
 * at a time.
 *
 * @param ctx - The bot context (client and guild id).
 * @param opts - `reactions`: also run the reaction pass for each channel.
 * @param deps - Test seams; leave out in production.
 * @returns `started`, or `already-running` when a run is live.
 */
export function startBackfill(
  ctx: BotContext,
  opts: { reactions: boolean },
  deps: BackfillDeps = {},
): "started" | "already-running" {
  if (run && run.endedAt === null) return "already-running";
  const r: Run = {
    startedAt: nowSec(),
    endedAt: null,
    reactions: opts.reactions,
    current: null,
    errors: 0,
    stopRequested: false,
    fatal: false,
    promise: Promise.resolve(),
  };
  run = r;
  r.promise = execute(r, ctx, deps);
  return "started";
}

/**
 * Ask the live run to stop. It finishes the page it is on and keeps every
 * cursor, so {@link startBackfill} resumes where it left off.
 *
 * @returns `stopping`, or `not-running` when no run is live.
 */
export function stopBackfill(): "stopping" | "not-running" {
  if (!run || run.endedAt !== null) return "not-running";
  run.stopRequested = true;
  return "stopping";
}

/**
 * Forget the in-memory run, as a restart would, so {@link getBackfillStatus}
 * reads from the rows alone. For tests only; it does not stop a live run.
 */
export function resetBackfillRun(): void {
  run = null;
}

/**
 * Resolves once the current run, if any, has ended. Used by tests and by a
 * clean shutdown; routes must not call it.
 */
export async function whenBackfillSettled(): Promise<void> {
  await run?.promise;
}

/**
 * The backfill's progress.
 *
 * Counts come from the `activity_backfill` rows, so they survive a restart:
 * no rows is `idle`, every row done is `done` (and, when the run was started
 * with the reaction pass, every row's reaction pass too), unfinished rows with
 * no live run is `stopped`. A live run is `running`, and a run that could not list the
 * channels is `failed`. `startedAt`, `elapsedSec` and `errors` describe the run
 * of this process only.
 *
 * @returns The status snapshot.
 */
export function getBackfillStatus(): BackfillStatus {
  const rows = db.select().from(schema.activityBackfill).all();
  const channelsDone = rows.filter((r) => r.doneAt !== null).length;
  const scanned = rows.reduce((sum, r) => sum + r.scanned, 0);
  const live = run !== null && run.endedAt === null;
  // Whether the reaction pass counts toward `done`: the last run's setting, or
  // after a restart (no run in memory) whether any channel has had its pass.
  const reactions = run ? run.reactions : rows.some((r) => r.reactionsDoneAt !== null);

  let status: BackfillStatus["status"];
  if (live) status = "running";
  else if (run?.fatal) status = "failed";
  else if (rows.length === 0) status = "idle";
  else if (channelsDone === rows.length && (!reactions || rows.every((r) => r.reactionsDoneAt !== null))) status = "done";
  else status = "stopped";

  return {
    status,
    channelsDone,
    channelsTotal: rows.length,
    scanned,
    current: live ? run!.current : null,
    startedAt: run?.startedAt ?? null,
    elapsedSec: run ? (run.endedAt ?? nowSec()) - run.startedAt : 0,
    reactions,
    errors: run?.errors ?? 0,
  };
}
