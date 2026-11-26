/**
 * Wrapped runs: three separate manual steps, each started by an admin.
 *
 * **Nothing here runs on its own.** There is no schedule and nothing starts at
 * load or boot.
 *
 * 1. **Process** ({@link startWrappedRun}): for each member with activity that
 *    UTC year who has not left (sorted by id) and whose link this run has not
 *    processed yet, build the snapshot and upsert their link (an existing link
 *    keeps its token), stamping it with the run id (`processedRunId`); then
 *    build the server snapshot. The run ends `processed` ("ready to send") and
 *    the admin who started it gets a `wrapped.processed` DM (or, when that DM
 *    fails, the same card in the mod-log channel). Nobody else is written to.
 * 2. **Send** ({@link startWrappedSend}): on a `processed` or `done` run,
 *    failed and skipped links go back to pending, each pending link of an
 *    opted-in member is DM'd (one per second), the others are marked
 *    `skipped`, and links already `sent` are left alone. The run ends `done`,
 *    then the announcement is posted when the send asked for it, and
 *    `wrapped.run-finished` goes to the mod-log channel.
 * 3. **Announce** ({@link postAnnouncement}): post the server Wrapped link to
 *    the announcement channel, once per year (guarded by `announcedAt`). The
 *    send step calls it when `announce` is on; an admin can also call it alone.
 *
 * Voice readiness (`voice-ready.ts`) is checked once when processing starts
 * (or resumes) and passed down, so every snapshot of a run agrees on it.
 *
 * Counters are persisted after every member so the dashboard can poll them. A
 * processing or sending run not updated for 120 seconds (the bot restarted,
 * say) reports `interrupted`, and {@link resumeWrappedRun} continues that phase.
 *
 * See docs/activity/wrapped.md.
 *
 * @packageDocumentation
 */
import type { TextChannel } from "discord.js";
import { and, count, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { env } from "../../../config/env.ts";
import { renderBotMessage } from "../../../core/messages.ts";
import type { BotContext } from "../../../core/plugin.ts";
import { nowSec } from "../../../core/util.ts";
import { db, getConfig, schema } from "../../../db/index.ts";
import type { WrappedRunStatus } from "../types/wrapped.ts";
import { withWrappedBanner } from "./banner.ts";
import { voiceReadiness } from "../voice-ready.ts";
import { activeMemberIds, buildWrapped, leftMemberIds, wrappedShared } from "./data.ts";
import type { WrappedShared } from "./data.ts";
import { sendWrappedDm } from "./dm.ts";
import { getWrappedLink, linkUrl, upsertWrappedLink } from "./links.ts";
import { isOptedIn, optedInCount } from "./optin.ts";
import {
  buildServerWrapped,
  getOrCreateServerToken,
  getServerRow,
  serverWrappedDeps,
  serverWrappedUrl,
  storeServerWrapped,
} from "./server.ts";

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

/** The work this process is doing, if any. */
let active: { id: number; promise: Promise<void> } | null = null;

type RunRow = typeof schema.activityWrappedRuns.$inferSelect;

/** The newest run row, or undefined when none exists. */
function latestRun(): RunRow | undefined {
  return db.select().from(schema.activityWrappedRuns).orderBy(desc(schema.activityWrappedRuns.id)).limit(1).get();
}

/** A run that is processing or sending. */
function isBusy(row: RunRow): boolean {
  return row.status === "processing" || row.status === "sending";
}

/** True when a processing or sending row has gone quiet and no work is active in this process. */
function isStale(row: RunRow): boolean {
  return isBusy(row) && active?.id !== row.id && nowSec() - row.updatedAt > wrappedRunTiming.staleSeconds;
}

/** Links of a year, optionally with a given DM status. */
function linkCount(year: number, dmStatus?: "pending" | "sent" | "failed" | "skipped"): number {
  const l = schema.activityWrappedLinks;
  return (
    db
      .select({ n: count() })
      .from(l)
      .where(and(eq(l.year, year), dmStatus ? eq(l.dmStatus, dmStatus) : undefined))
      .get()?.n ?? 0
  );
}

/**
 * The latest run and its progress.
 *
 * `skipped` (links of the run's year whose member had not opted in) and
 * `optedIn` (the current opt-in count) are read from the links and opt-in
 * tables; `announcedAt` from the server Wrapped of the run's year.
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
      announce: false,
      announcedAt: null,
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
    announce: row.announce === 1,
    announcedAt: getServerRow(row.year)?.announcedAt ?? null,
  };
}

/**
 * The stored phase of the latest run, before staleness is applied (an
 * interrupted run still shows `processing` or `sending` here).
 *
 * @returns The phase, or null when no run exists.
 */
export function latestRunPhase(): RunRow["status"] | null {
  return latestRun()?.status ?? null;
}

/**
 * The work in progress, for tests and shutdown code that must wait for it.
 *
 * @returns A promise that settles when the active step (if any) ends.
 */
export function waitForWrappedRun(): Promise<void> {
  return active?.promise ?? Promise.resolve();
}

/**
 * Step 1: start processing a year in the background. Returns at once; the
 * progress is in {@link getWrappedStatus}. Nobody but the starting admin is
 * written to, and no announcement is posted.
 *
 * The member list is taken now (members with activity that UTC year who have
 * not left), so `total` is known from the first poll. A previous run that was
 * interrupted is marked failed first.
 *
 * @param ctx - Bot context.
 * @param opts.year - The UTC calendar year.
 * @param opts.startedBy - User id of the admin who started it; they get the
 *   `wrapped.processed` DM.
 * @returns `started`, or `already-running` when a run is processing or sending.
 */
export function startWrappedRun(ctx: BotContext, opts: { year: number; startedBy: string }): "started" | "already-running" {
  if (active) return "already-running";
  const latest = latestRun();
  if (latest && isBusy(latest)) {
    if (!isStale(latest)) return "already-running";
    db.update(schema.activityWrappedRuns)
      .set({ status: "failed", finishedAt: nowSec(), updatedAt: nowSec() })
      .where(eq(schema.activityWrappedRuns.id, latest.id))
      .run();
  }

  // Voice readiness is checked once per processing step and passed down.
  const voiceReady = voiceReadiness().ready;
  const members = activeMemberIds(opts.year, voiceReady);
  const now = nowSec();
  const id = db
    .insert(schema.activityWrappedRuns)
    .values({
      year: opts.year,
      status: "processing",
      total: members.length,
      processed: 0,
      startedBy: opts.startedBy,
      startedAt: now,
      updatedAt: now,
    })
    .returning({ id: schema.activityWrappedRuns.id })
    .get().id;
  launch({ id, work: () => processWork(ctx, { id, year: opts.year, startedBy: opts.startedBy, members, voiceReady }) });
  return "started";
}

/**
 * Step 2: DM the links of opted-in members, in the background, on the latest
 * run. Allowed when that run is `processed`, or `done` (a later send reaches
 * members who opted in since and retries failed links; sent links are never
 * sent again), or `failed` when its processing had completed (`processed`
 * equals `total`), so a failed send is retried without reprocessing the year.
 *
 * @param ctx - Bot context.
 * @param opts.startedBy - The admin who started the send (named in the mod-log post).
 * @param opts.announce - Post the server Wrapped announcement when the DMs
 *   finish (default true; once per year).
 * @returns `started`; `already-running` while a run is processing or sending;
 *   `not-processed` when there is no processed run to send.
 */
export function startWrappedSend(
  ctx: BotContext,
  opts: { startedBy: string; announce?: boolean },
): "started" | "already-running" | "not-processed" {
  if (active) return "already-running";
  const row = latestRun();
  if (!row) return "not-processed";
  if (isBusy(row) && !isStale(row)) return "already-running";
  // A failed send can be retried once processing had completed (every member processed).
  const processingDone = row.status === "failed" && row.total > 0 && row.processed >= row.total;
  if (row.status !== "processed" && row.status !== "done" && !processingDone) return "not-processed";

  const announce = opts.announce !== false;
  resetForSending(row.year);
  updateRun(row.id, {
    status: "sending",
    announce: announce ? 1 : 0,
    sent: linkCount(row.year, "sent"),
    failed: 0,
    finishedAt: null,
  });
  launch({ id: row.id, work: () => sendWork(ctx, { id: row.id, year: row.year, startedBy: opts.startedBy, announce }) });
  return "started";
}

/**
 * Continue an interrupted run, in the phase it stopped in.
 *
 * - Processing: every member in a fresh member list whose link this run has
 *   not processed (`processedRunId`), so a member who became active meanwhile
 *   is included and one who left is not; then the server snapshot, `processed`
 *   and the starter's DM.
 * - Sending: the links still pending, with the run's stored `announce`.
 *
 * @param ctx - Bot context.
 * @returns `resumed`, or `nothing-to-resume` when the latest run is not interrupted.
 */
export function resumeWrappedRun(ctx: BotContext): "resumed" | "nothing-to-resume" {
  if (active) return "nothing-to-resume";
  const row = latestRun();
  if (!row || !isStale(row)) return "nothing-to-resume";

  updateRun(row.id, {});
  if (row.status === "processing") {
    const voiceReady = voiceReadiness().ready;
    const members = activeMemberIds(row.year, voiceReady);
    launch({ id: row.id, work: () => processWork(ctx, { id: row.id, year: row.year, startedBy: row.startedBy, members, voiceReady }) });
  } else {
    const announce = row.announce === 1;
    launch({ id: row.id, work: () => sendWork(ctx, { id: row.id, year: row.year, startedBy: row.startedBy, announce }) });
  }
  return "resumed";
}

/** Years whose announcement is being posted by this process right now. */
const announcing = new Set<number>();

/**
 * Step 3: post the server Wrapped announcement (`wrapped.announce`, with the
 * title banner and a link button) to the announcement channel. At most once
 * per year, even under concurrent calls: the year is claimed first with an
 * atomic update (`announcedAt` set only where it is still null) plus an
 * in-process guard, and the claim is released when the post fails, so it can
 * be retried.
 *
 * @param ctx - Bot context.
 * @param year - The UTC calendar year.
 * @returns `posted`; `already-announced` (also while another call is posting);
 *   `not-processed` unless the latest run of that year is `processed` or
 *   `done` with a server snapshot (an admin preview alone does not count);
 *   `no-channel` when the announcement channel is unset; `failed` when the
 *   channel cannot be reached or the post failed.
 */
export async function postAnnouncement(
  ctx: BotContext,
  year: number,
): Promise<"posted" | "already-announced" | "not-processed" | "no-channel" | "failed"> {
  const run = db
    .select({ status: schema.activityWrappedRuns.status })
    .from(schema.activityWrappedRuns)
    .where(eq(schema.activityWrappedRuns.year, year))
    .orderBy(desc(schema.activityWrappedRuns.id))
    .limit(1)
    .get();
  const server = getServerRow(year);
  if (!run || (run.status !== "processed" && run.status !== "done") || !server?.data) return "not-processed";
  if (server.announcedAt !== null || announcing.has(year)) return "already-announced";
  const channelId = getConfig().announcementChannelId;
  if (!channelId) return "no-channel";

  // Claim the year before any await, so a second call sees it taken.
  announcing.add(year);
  const claimed = db
    .update(schema.activityWrappedServer)
    .set({ announcedAt: nowSec() })
    .where(and(eq(schema.activityWrappedServer.year, year), isNull(schema.activityWrappedServer.announcedAt)))
    .returning({ year: schema.activityWrappedServer.year })
    .all();
  if (claimed.length !== 1) {
    announcing.delete(year);
    return "already-announced";
  }
  try {
    const channel = await ctx.client.channels.fetch(channelId).catch(() => null);
    if (!channel?.isTextBased() || !("send" in channel)) throw new Error("the announcement channel cannot be reached");
    const rendered = await renderBotMessage("wrapped.announce", ctx, { year, url: serverWrappedUrl(server.token) });
    await (channel as TextChannel).send(await withWrappedBanner(rendered, year));
    return "posted";
  } catch (err) {
    console.error("[wrapped] announcement failed:", err);
    // Release the claim so the announcement can be retried.
    db.update(schema.activityWrappedServer)
      .set({ announcedAt: null })
      .where(eq(schema.activityWrappedServer.year, year))
      .run();
    return "failed";
  } finally {
    announcing.delete(year);
  }
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

/** Run one step in the background and remember it as the active work. */
function launch(job: { id: number; work: () => Promise<void> }): void {
  // Start on the next microtask, so `active` is set before any work runs.
  const promise = Promise.resolve()
    .then(job.work)
    .finally(() => {
      if (active?.id === job.id) active = null;
    });
  active = { id: job.id, promise };
}

/** Mark a run failed and report it to the mod-log channel. Never throws. */
async function failRun(ctx: BotContext, id: number, err: unknown): Promise<void> {
  console.error(`[wrapped] run ${id} failed:`, err);
  updateRun(id, { status: "failed", finishedAt: nowSec() });
  const row = runRow(id);
  await postModLog(ctx, "wrapped.run-failed", { processed: row?.processed ?? 0, total: row?.total ?? 0 });
}

/** The processing step: members, server snapshot, `processed`, the starter's DM. Never throws. */
async function processWork(
  ctx: BotContext,
  job: { id: number; year: number; startedBy: string; members: string[]; voiceReady: boolean },
): Promise<void> {
  try {
    const shared = await processMembers(job);
    await storeServerSnapshot(ctx, job.year, shared);
    updateRun(job.id, { status: "processed", finishedAt: nowSec() });
  } catch (err) {
    await failRun(ctx, job.id, err);
    return;
  }
  await notifyStarter(ctx, job.startedBy, job.year);
}

/** The send step: DMs, `done`, the announcement, the mod-log post. Never throws. */
async function sendWork(ctx: BotContext, job: { id: number; year: number; startedBy: string; announce: boolean }): Promise<void> {
  try {
    await sendLinks(ctx, job);
    updateRun(job.id, { status: "done", finishedAt: nowSec() });
  } catch (err) {
    await failRun(ctx, job.id, err);
    return;
  }
  let announced = false;
  if (job.announce) {
    const result = await postAnnouncement(ctx, job.year);
    announced = result === "posted" || result === "already-announced";
  }
  const row = runRow(job.id);
  await postModLog(ctx, "wrapped.run-finished", {
    year: job.year,
    admin: `<@${job.startedBy}>`,
    sent: row?.sent ?? 0,
    failed: row?.failed ?? 0,
    skipped: linkCount(job.year, "skipped"),
    announcement: announced ? "announced in the announcements channel." : "not announced.",
  });
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
 *
 * @returns The year aggregates, computed once for every member.
 */
async function processMembers(job: { id: number; year: number; members: string[]; voiceReady: boolean }): Promise<WrappedShared> {
  const shared = wrappedShared(job.year, job.voiceReady);
  const done = processedByRun(job.id, job.year);
  const todo = job.members.filter((userId) => !done.has(userId));
  let processed = done.size;
  updateRun(job.id, { processed, total: Math.max(runRow(job.id)?.total ?? 0, processed + todo.length) });
  for (const userId of todo) {
    const data = buildWrapped(userId, job.year, shared);
    if (data) upsertWrappedLink(userId, job.year, data, job.id);
    processed += 1;
    updateRun(job.id, { processed });
    // Let the event loop breathe (gateway, web requests) between members.
    await sleep(0);
  }
  return shared;
}

/**
 * Build and store the server Wrapped once per processing step, with names from
 * the guild cache. The year's token is kept.
 */
async function storeServerSnapshot(ctx: BotContext, year: number, shared: WrappedShared): Promise<void> {
  const deps = await serverWrappedDeps(ctx);
  const data = buildServerWrapped(year, { ...deps, clubs: shared.clubs, terms: shared.terms, voiceReady: shared.voiceReady });
  if (data) storeServerWrapped(year, data);
  else getOrCreateServerToken(year);
}

/**
 * Tell the admin who started processing that it is done (`wrapped.processed`,
 * with a link to the dashboard). When the DM cannot be delivered the same card
 * goes to the mod-log channel; when that is unset, nothing. Never throws.
 */
async function notifyStarter(ctx: BotContext, userId: string, year: number): Promise<void> {
  try {
    const payload = await renderBotMessage("wrapped.processed", ctx, {
      year,
      links: linkCount(year),
      optedIn: optedInCount(),
      url: `${env.PUBLIC_URL}/#/activity-admin`,
    });
    try {
      const user = await ctx.client.users.fetch(userId);
      await user.send(payload);
      return;
    } catch {
      // Closed DMs or an unknown user: fall back to the mod-log channel.
    }
    const channelId = getConfig().modLogChannelId;
    if (!channelId) return;
    const channel = await ctx.client.channels.fetch(channelId).catch(() => null);
    if (!channel?.isTextBased() || !("send" in channel)) return;
    await (channel as TextChannel).send(payload);
  } catch (err) {
    console.error("[wrapped] processed notice failed:", err);
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
async function sendLinks(ctx: BotContext, job: { id: number; year: number }): Promise<void> {
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
