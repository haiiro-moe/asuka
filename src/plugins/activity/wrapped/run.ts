/**
 * Wrapped runs: the admin-started job that makes every member's snapshot and
 * link, then DMs the links of the members who opted in.
 *
 * **Nothing here runs on its own.** There is no schedule and nothing starts at
 * load or boot: a run starts only from {@link startWrappedRun} (the admin route
 * or `/wrapped start`) and continues only from {@link resumeWrappedRun}.
 *
 * A run has two phases, both persisted after every member so the dashboard
 * can poll the progress:
 *
 * 1. **processing**: for each member with activity that UTC year who has not
 *    left (sorted by id) and whose link this run has not processed yet, build
 *    the snapshot and upsert their link (an existing link keeps its token),
 *    stamping the link with the run id (`processedRunId`).
 * 2. **sending** (only when the run was started with `sendDms`): links that
 *    are failed or skipped go back to pending, then each pending link of an
 *    opted-in member is DM'd, one per second; a link of a member who has not
 *    opted in is marked `skipped` and never DM'd. Links already `sent` are
 *    left alone.
 *
 * A run whose row has not been updated for 120 seconds while processing or
 * sending (the bot restarted, say) reports `interrupted`; resuming it
 * continues the members whose link this run has not processed (taken from a
 * fresh member list, so members who became active meanwhile are included)
 * and the pending DMs only. Whether a run sends DMs is stored on the run
 * (`sendDms`), so a resumed run keeps the original choice.
 *
 * See docs/activity/wrapped.md.
 *
 * @packageDocumentation
 */
import type { TextChannel } from "discord.js";
import { and, count, desc, eq, inArray, sql } from "drizzle-orm";
import { renderBotMessage } from "../../../core/messages.ts";
import type { BotContext } from "../../../core/plugin.ts";
import { nowSec } from "../../../core/util.ts";
import { db, getConfig, schema } from "../../../db/index.ts";
import type { WrappedRunStatus } from "../types/wrapped.ts";
import { activeMemberIds, buildWrapped, leftMemberIds } from "./data.ts";
import { sendWrappedDm } from "./dm.ts";
import { getWrappedLink, linkUrl, upsertWrappedLink } from "./links.ts";
import { isOptedIn, optedInCount } from "./optin.ts";

export type { WrappedRunStatus, WrappedRunState } from "../types/wrapped.ts";

/**
 * Timing knobs of a run. Tests set `sendDelayMs` to 0; nothing else should
 * change them.
 */
export const wrappedRunTiming = {
  /** Pause between two DMs, in milliseconds (one DM per second). */
  sendDelayMs: 1000,
  /** A processing or sending run not updated for longer than this, in seconds, is interrupted. */
  staleSeconds: 120,
};

/** The run this process is working on, if any. */
let active: { id: number; promise: Promise<void> } | null = null;

type RunRow = typeof schema.activityWrappedRuns.$inferSelect;

/** The newest run row, or undefined when none exists. */
function latestRun(): RunRow | undefined {
  return db.select().from(schema.activityWrappedRuns).orderBy(desc(schema.activityWrappedRuns.id)).limit(1).get();
}

/** True when a processing or sending row has gone quiet and no run is active in this process. */
function isStale(row: RunRow): boolean {
  return (
    (row.status === "processing" || row.status === "sending") &&
    active?.id !== row.id &&
    nowSec() - row.updatedAt > wrappedRunTiming.staleSeconds
  );
}

/** Links of a year with a given DM status. */
function linkCount(year: number, dmStatus: "pending" | "sent" | "failed" | "skipped"): number {
  return (
    db
      .select({ n: count() })
      .from(schema.activityWrappedLinks)
      .where(and(eq(schema.activityWrappedLinks.year, year), eq(schema.activityWrappedLinks.dmStatus, dmStatus)))
      .get()?.n ?? 0
  );
}

/**
 * The latest run and its progress.
 *
 * `skipped` (links of the run's year whose member had not opted in) and
 * `optedIn` (the current opt-in count) are read from the links and opt-in
 * tables, not from the run row.
 *
 * @returns The status of the newest run; `idle` with zero counters when no
 *   run exists; `interrupted` for a processing or sending run that has not
 *   been updated for 120 seconds.
 */
export function getWrappedStatus(): WrappedRunStatus {
  const row = latestRun();
  const optedIn = optedInCount();
  if (!row) {
    return {
      id: null,
      year: null,
      status: "idle",
      total: 0,
      processed: 0,
      sent: 0,
      failed: 0,
      skipped: 0,
      optedIn,
      startedAt: null,
      finishedAt: null,
    };
  }
  return {
    id: row.id,
    year: row.year,
    status: isStale(row) ? "interrupted" : row.status,
    total: row.total,
    processed: row.processed,
    sent: row.sent,
    failed: row.failed,
    skipped: linkCount(row.year, "skipped"),
    optedIn,
    startedAt: row.startedAt,
    finishedAt: row.finishedAt,
  };
}

/**
 * The work in progress, for tests and shutdown code that must wait for it.
 *
 * @returns A promise that settles when the active run (if any) ends.
 */
export function waitForWrappedRun(): Promise<void> {
  return active?.promise ?? Promise.resolve();
}

/**
 * Start a Wrapped run in the background. Returns at once; the run's progress
 * is in {@link getWrappedStatus}.
 *
 * The member list is taken now (members with activity that UTC year who have
 * not left), so `total` is known from the first poll. A previous run that was
 * interrupted is marked failed first.
 *
 * @param ctx - Bot context (the client sends the DMs and the mod-log post).
 * @param opts.year - The UTC calendar year.
 * @param opts.startedBy - User id of the admin who started it.
 * @param opts.sendDms - False to make the links only (nobody is written to).
 * @returns `started`, or `already-running` when a run is processing or sending.
 */
export function startWrappedRun(
  ctx: BotContext,
  opts: { year: number; startedBy: string; sendDms: boolean },
): "started" | "already-running" {
  if (active) return "already-running";
  const latest = latestRun();
  if (latest && (latest.status === "processing" || latest.status === "sending")) {
    if (!isStale(latest)) return "already-running";
    db.update(schema.activityWrappedRuns)
      .set({ status: "failed", finishedAt: nowSec(), updatedAt: nowSec() })
      .where(eq(schema.activityWrappedRuns.id, latest.id))
      .run();
  }

  const members = activeMemberIds(opts.year);
  const now = nowSec();
  const id = db
    .insert(schema.activityWrappedRuns)
    .values({
      year: opts.year,
      status: "processing",
      total: members.length,
      processed: 0,
      startedBy: opts.startedBy,
      sendDms: opts.sendDms ? 1 : 0,
      startedAt: now,
      updatedAt: now,
    })
    .returning({ id: schema.activityWrappedRuns.id })
    .get().id;
  launch(ctx, { id, year: opts.year, startedBy: opts.startedBy, sendDms: opts.sendDms, phase: "processing", members });
  return "started";
}

/**
 * Continue an interrupted run. During processing: every member in a fresh
 * member list whose link this run has not processed (`processedRunId`), so a
 * member who became active meanwhile is included and one who left is not.
 * During sending: the DMs still pending. DMs follow only when the run was
 * started with `sendDms`, which is stored on the run (see {@link runSendsDms}).
 *
 * @param ctx - Bot context.
 * @returns `resumed`, or `nothing-to-resume` when the latest run is not interrupted.
 */
export function resumeWrappedRun(ctx: BotContext): "resumed" | "nothing-to-resume" {
  if (active) return "nothing-to-resume";
  const row = latestRun();
  if (!row || !isStale(row)) return "nothing-to-resume";

  db.update(schema.activityWrappedRuns)
    .set({ updatedAt: nowSec() })
    .where(eq(schema.activityWrappedRuns.id, row.id))
    .run();
  const sendDms = row.sendDms === 1;
  if (row.status === "processing") {
    const members = activeMemberIds(row.year);
    launch(ctx, { id: row.id, year: row.year, startedBy: row.startedBy, sendDms, phase: "processing", members });
  } else {
    launch(ctx, { id: row.id, year: row.year, startedBy: row.startedBy, sendDms, phase: "sending", members: [] });
  }
  return "resumed";
}

/**
 * Whether a run DMs the links after processing (`sendDms` when it started).
 *
 * @param id - The run's id.
 * @returns True or false; null when no such run exists.
 */
export function runSendsDms(id: number): boolean | null {
  const row = runRow(id);
  return row ? row.sendDms === 1 : null;
}

/**
 * DM one member their link again, whether or not they opted in: an admin
 * asked for this member. The link's DM status and the latest run of that
 * year's counters are updated.
 *
 * @param ctx - Bot context.
 * @param userId - The member.
 * @param year - The year of the link.
 * @returns `sent`, `failed`, or `no-link` when the member has no link that year.
 */
export async function resendWrappedDm(ctx: BotContext, userId: string, year: number): Promise<"sent" | "failed" | "no-link"> {
  const link = getWrappedLink(userId, year);
  if (!link) return "no-link";
  const result = await sendWrappedDm(ctx.client, userId, linkUrl(link.token), year);
  setDmStatus(userId, year, result);

  const run = db
    .select({ id: schema.activityWrappedRuns.id })
    .from(schema.activityWrappedRuns)
    .where(eq(schema.activityWrappedRuns.year, year))
    .orderBy(desc(schema.activityWrappedRuns.id))
    .limit(1)
    .get();
  if (run) {
    const r = schema.activityWrappedRuns;
    const wasFailed = link.dmStatus === "failed";
    const set =
      result === "sent"
        ? { sent: sql`${r.sent} + 1`, failed: wasFailed ? sql`max(0, ${r.failed} - 1)` : sql`${r.failed}` }
        : { failed: wasFailed ? sql`${r.failed}` : sql`${r.failed} + 1` };
    db.update(r).set(set).where(eq(r.id, run.id)).run();
  }
  return result;
}

/** What {@link launch} works on. */
interface RunJob {
  id: number;
  year: number;
  startedBy: string;
  sendDms: boolean;
  /** The phase to start in. */
  phase: "processing" | "sending";
  /** The fresh, sorted member list (processing only). */
  members: string[];
}

/** Run a job in the background and remember it as the active run. */
function launch(ctx: BotContext, job: RunJob): void {
  // Start on the next microtask, so `active` is set before any work runs.
  const promise = Promise.resolve()
    .then(() => work(ctx, job))
    .finally(() => {
      if (active?.id === job.id) active = null;
    });
  active = { id: job.id, promise };
}

/** The body of a run: process, send, finish, report. Never throws. */
async function work(ctx: BotContext, job: RunJob): Promise<void> {
  try {
    if (job.phase === "processing") {
      await processMembers(job);
      if (job.sendDms) {
        resetForSending(job.year);
        updateRun(job.id, { status: "sending" });
      }
    }
    if (job.sendDms) await sendLinks(ctx, job);
    updateRun(job.id, { status: "done", finishedAt: nowSec() });
    const row = runRow(job.id);
    await postModLog(ctx, "wrapped.run-finished", {
      year: job.year,
      admin: `<@${job.startedBy}>`,
      sent: row?.sent ?? 0,
      failed: row?.failed ?? 0,
      skipped: linkCount(job.year, "skipped"),
    });
  } catch (err) {
    console.error(`[wrapped] run ${job.id} failed:`, err);
    updateRun(job.id, { status: "failed", finishedAt: nowSec() });
    const row = runRow(job.id);
    await postModLog(ctx, "wrapped.run-failed", { processed: row?.processed ?? 0, total: row?.total ?? 0 });
  }
}

/** Members of a year whose link was processed by run `id`. */
function processedByRun(id: number, year: number): Set<string> {
  const rows = db
    .select({ userId: schema.activityWrappedLinks.userId })
    .from(schema.activityWrappedLinks)
    .where(and(eq(schema.activityWrappedLinks.year, year), eq(schema.activityWrappedLinks.processedRunId, id)))
    .all();
  return new Set(rows.map((r) => r.userId));
}

/**
 * Build and store the snapshot of each member in `job.members` whose link this
 * run has not processed yet, stamping the link with the run id and saving
 * progress after each. `processed` counts the links this run has processed;
 * `total` is that plus the members still to do, and never shrinks.
 */
async function processMembers(job: RunJob): Promise<void> {
  const done = processedByRun(job.id, job.year);
  const todo = job.members.filter((userId) => !done.has(userId));
  let processed = done.size;
  updateRun(job.id, { processed, total: Math.max(runRow(job.id)?.total ?? 0, processed + todo.length) });
  for (const userId of todo) {
    const data = buildWrapped(userId, job.year);
    if (data) upsertWrappedLink(userId, job.year, data, job.id);
    processed += 1;
    updateRun(job.id, { processed });
    // Let the event loop breathe (gateway, web requests) between members.
    await sleep(0);
  }
}

/** Put the failed and skipped links of a year back to pending, so a new send retries them. */
function resetForSending(year: number): void {
  db.update(schema.activityWrappedLinks)
    .set({ dmStatus: "pending" })
    .where(and(eq(schema.activityWrappedLinks.year, year), inArray(schema.activityWrappedLinks.dmStatus, ["failed", "skipped"])))
    .run();
}

/**
 * DM every pending link of an opted-in member, one per `sendDelayMs`; mark the
 * pending links of the others skipped. Members who left are passed over.
 */
async function sendLinks(ctx: BotContext, job: RunJob): Promise<void> {
  const left = leftMemberIds();
  const pending = db
    .select({ userId: schema.activityWrappedLinks.userId, token: schema.activityWrappedLinks.token })
    .from(schema.activityWrappedLinks)
    .where(and(eq(schema.activityWrappedLinks.year, job.year), eq(schema.activityWrappedLinks.dmStatus, "pending")))
    .orderBy(schema.activityWrappedLinks.userId)
    .all();

  let first = true;
  for (const link of pending) {
    if (left.has(link.userId)) continue;
    if (!isOptedIn(link.userId)) {
      setDmStatus(link.userId, job.year, "skipped");
      updateRun(job.id, {});
      continue;
    }
    if (!first) await sleep(wrappedRunTiming.sendDelayMs);
    first = false;
    const result = await sendWrappedDm(ctx.client, link.userId, linkUrl(link.token), job.year);
    setDmStatus(link.userId, job.year, result);
    const r = schema.activityWrappedRuns;
    updateRun(job.id, result === "sent" ? { sent: sql`${r.sent} + 1` } : { failed: sql`${r.failed} + 1` });
  }
}

/** Set a link's DM status. */
function setDmStatus(userId: string, year: number, dmStatus: "pending" | "sent" | "failed" | "skipped"): void {
  db.update(schema.activityWrappedLinks)
    .set({ dmStatus })
    .where(and(eq(schema.activityWrappedLinks.userId, userId), eq(schema.activityWrappedLinks.year, year)))
    .run();
}

/** Update a run row and stamp `updatedAt`. */
function updateRun(id: number, set: Partial<Record<keyof RunRow, unknown>>): void {
  db.update(schema.activityWrappedRuns)
    .set({ ...set, updatedAt: nowSec() } as never)
    .where(eq(schema.activityWrappedRuns.id, id))
    .run();
}

/** A run row by id. */
function runRow(id: number): RunRow | undefined {
  return db.select().from(schema.activityWrappedRuns).where(eq(schema.activityWrappedRuns.id, id)).get();
}

/** Post a catalog message to the mod-log channel; silently nothing when it is unset or unreachable. */
async function postModLog(ctx: BotContext, key: string, params: Record<string, string | number>): Promise<void> {
  const channelId = getConfig().modLogChannelId;
  if (!channelId) return;
  try {
    const channel = await ctx.client.channels.fetch(channelId).catch(() => null);
    if (!channel?.isTextBased() || !("send" in channel)) return;
    await (channel as TextChannel).send(await renderBotMessage(key, ctx, params));
  } catch (err) {
    console.error(`[wrapped] mod-log post failed:`, err);
  }
}

/** Wait `ms` milliseconds. */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
