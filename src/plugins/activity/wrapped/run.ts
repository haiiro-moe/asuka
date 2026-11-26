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
 * (or resumes), at the year's last second when the year is over
 * (`voiceReadinessForYear`), and passed down, so every snapshot of a run
 * agrees on it.
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
import type { WrappedResendResult, WrappedRunStatus } from "../types/wrapped.ts";
import { withWrappedBanner } from "./banner.ts";
import { voiceReadinessForYear } from "../voice-ready.ts";
import { activeMemberIds, buildWrapped, clearWrappedSharedMemo, leftMemberIds, rememberWrappedShared, wrappedShared } from "./data.ts";
import type { WrappedShared } from "./data.ts";
import { sendWrappedDmDetailed } from "./dm.ts";
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

/**
 * The newest real run row, or undefined when none exists. Private preview runs
 * (`kind = "private"`) are never seen by the real run.
 */
function latestRun(): RunRow | undefined {
  const r = schema.activityWrappedRuns;
  return db.select().from(r).where(eq(r.kind, "real")).orderBy(desc(r.id)).limit(1).get();
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
      .where(and(eq(l.year, year), eq(l.private, 0), dmStatus ? eq(l.dmStatus, dmStatus) : undefined))
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
      buildFailed: 0,
      error: null,
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
    buildFailed: row.buildFailed,
    error: row.error,
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

  clearWrappedSharedMemo();
  // Voice readiness is checked once per processing step and passed down.
  const voiceReady = voiceReadinessForYear(opts.year).ready;
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
  launch({ id, work: () => processWork(ctx, { id, year: opts.year, startedBy: opts.startedBy, members, voiceReady, fresh: true }) });
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
    error: null,
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
    clearWrappedSharedMemo();
    const voiceReady = voiceReadinessForYear(row.year).ready;
    const members = activeMemberIds(row.year, voiceReady);
    launch({ id: row.id, work: () => processWork(ctx, { id: row.id, year: row.year, startedBy: row.startedBy, members, voiceReady, fresh: false }) });
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
    .where(and(eq(schema.activityWrappedRuns.year, year), eq(schema.activityWrappedRuns.kind, "real")))
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

/** Links whose DM is being sent right now, as `userId:year`: by a send step or a resend. */
const inFlight = new Set<string>();

/** The {@link inFlight} key of a link. */
function flightKey(userId: string, year: number): string {
  return `${userId}:${year}`;
}

/** True while a real send step for `year` is running and not stale. */
function sendRunning(year: number): boolean {
  const r = schema.activityWrappedRuns;
  const row = db.select().from(r).where(and(eq(r.year, year), eq(r.kind, "real"))).orderBy(desc(r.id)).limit(1).get();
  return !!row && row.status === "sending" && !isStale(row);
}

/**
 * DM one member their link again, because an admin asked for that member
 * (the resend control on the failed-DM list).
 *
 * Only a link that has not been delivered may be resent: `failed`, or
 * `pending`/`skipped` while no DM to it is in flight. A member's own
 * `/wrapped me` is the way back to a link that was already delivered, and the
 * admin's `open link` still shows any link.
 *
 * On success the run's `sent` counter is set to the number of sent links of
 * the year (so a link is never counted twice) and `failed` drops by one when
 * the link had failed.
 *
 * @param ctx - Bot context.
 * @param userId - The member.
 * @param year - The year of the link.
 * @returns `sent` or `failed` after an attempt; without one: `no-link` when the
 *   member has no link that year, `left` when they have left the guild,
 *   `not-opted-in` when they have not opted in to the DM, `already-sent` when
 *   the link was delivered, `sending` while a send step runs for the year or
 *   this link's DM is in flight.
 */
export async function resendWrappedDm(ctx: BotContext, userId: string, year: number): Promise<WrappedResendResult> {
  const link = getWrappedLink(userId, year);
  if (!link) return "no-link";
  if (leftMemberIds().has(userId)) return "left";
  if (!isOptedIn(userId)) return "not-opted-in";
  if (link.dmStatus === "sent") return "already-sent";
  const key = flightKey(userId, year);
  if (inFlight.has(key) || sendRunning(year)) return "sending";

  inFlight.add(key);
  let result: "sent" | "failed";
  try {
    result = (await deliverDm(ctx, userId, link.token, year)).status;
  } finally {
    inFlight.delete(key);
  }
  setDmStatus(userId, year, result);

  const run = db
    .select({ id: schema.activityWrappedRuns.id })
    .from(schema.activityWrappedRuns)
    .where(and(eq(schema.activityWrappedRuns.year, year), eq(schema.activityWrappedRuns.kind, "real")))
    .orderBy(desc(schema.activityWrappedRuns.id))
    .limit(1)
    .get();
  if (run) {
    const r = schema.activityWrappedRuns;
    const wasFailed = link.dmStatus === "failed";
    const set =
      result === "sent"
        ? { sent: linkCount(year, "sent"), failed: wasFailed ? sql`max(0, ${r.failed} - 1)` : sql`${r.failed}` }
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
  updateRun(id, { status: "failed", finishedAt: nowSec(), error: errorText(err) });
  const row = runRow(id);
  await postModLog(ctx, "wrapped.run-failed", { processed: row?.processed ?? 0, total: row?.total ?? 0 });
}

/** The processing step: members, server snapshot, `processed`, the starter's DM. Never throws. */
async function processWork(
  ctx: BotContext,
  job: { id: number; year: number; startedBy: string; members: string[]; voiceReady: boolean; fresh: boolean },
): Promise<void> {
  try {
    const live = await liveMemberIds(ctx);
    let members = job.members;
    if (live) {
      members = members.filter((userId) => live.has(userId));
      // A fresh run's total is the members still in the guild; a resumed one never shrinks.
      if (job.fresh) updateRun(job.id, { total: members.length });
    } else {
      noteError(job.id, MEMBER_FETCH_FALLBACK);
    }
    const shared = await processMembers({ ...job, members });
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
    .where(
      and(
        eq(schema.activityWrappedLinks.year, year),
        eq(schema.activityWrappedLinks.private, 0),
        eq(schema.activityWrappedLinks.processedRunId, id),
      ),
    )
    .all();
  return new Set(rows.map((r) => r.userId));
}

/**
 * Build and store the snapshot of each member in `job.members` whose link this
 * run has not processed yet, stamping the link with the run id and saving
 * progress after each. `processed` counts the links this run has processed;
 * `total` is that plus the members still to do, and never shrinks.
 *
 * A link whose DM was already `sent` keeps its snapshot (a delivered story
 * never changes) and is only stamped. A member whose snapshot throws is
 * counted in `buildFailed`, the first such error is kept in `error`, and
 * processing carries on with the next member.
 *
 * @returns The year aggregates, computed once for every member.
 */
async function processMembers(job: { id: number; year: number; members: string[]; voiceReady: boolean }): Promise<WrappedShared> {
  const shared = rememberWrappedShared(job.year, wrappedShared(job.year, job.voiceReady));
  const done = processedByRun(job.id, job.year);
  const todo = job.members.filter((userId) => !done.has(userId));
  let processed = done.size;
  updateRun(job.id, { processed, total: Math.max(runRow(job.id)?.total ?? 0, processed + todo.length) });
  for (const userId of todo) {
    const existing = getWrappedLink(userId, job.year);
    if (existing?.dmStatus === "sent") {
      // A delivered story never changes: only mark it as processed by this run.
      markProcessed(userId, job.year, job.id);
    } else {
      try {
        const data = buildWrapped(userId, job.year, shared);
        if (data) upsertWrappedLink(userId, job.year, data, job.id);
      } catch (err) {
        console.error(`[wrapped] snapshot of ${userId} failed:`, err);
        const r = schema.activityWrappedRuns;
        updateRun(job.id, { buildFailed: sql`${r.buildFailed} + 1` });
        noteError(job.id, `a snapshot failed (${userId}): ${errorText(err)}`);
      }
    }
    processed += 1;
    updateRun(job.id, { processed });
    // Let the event loop breathe (gateway, web requests) between members.
    await sleep(0);
  }
  return shared;
}

/**
 * Build and store the server Wrapped once per processing step, with names from
 * the guild cache. The year's token is kept. A year already announced keeps
 * the snapshot it was announced with.
 */
async function storeServerSnapshot(ctx: BotContext, year: number, shared: WrappedShared): Promise<void> {
  // Once announced, the public story never changes.
  if (getServerRow(year)?.announcedAt != null) return;
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
    .where(
      and(
        eq(schema.activityWrappedLinks.year, year),
        eq(schema.activityWrappedLinks.private, 0),
        inArray(schema.activityWrappedLinks.dmStatus, ["failed", "skipped"]),
      ),
    )
    .run();
}

/** A link's current DM status, read fresh. */
function dmStatusOf(userId: string, year: number): RunLinkStatus | null {
  const l = schema.activityWrappedLinks;
  return (
    db
      .select({ dmStatus: l.dmStatus })
      .from(l)
      .where(and(eq(l.userId, userId), eq(l.year, year), eq(l.private, 0)))
      .get()?.dmStatus ?? null
  );
}

/**
 * DM every pending link of an opted-in member, one per `sendDelayMs`; mark the
 * pending links of the others skipped. Members who left are passed over.
 *
 * Circuit breaker: after {@link SEND_BREAKER_LIMIT} failures in a row that are
 * not a refusal of one member (closed DMs and the like, `PER_MEMBER_DM_CODES`)
 * the step throws, so the run ends `failed` with that error and every link
 * not yet tried stays `pending` for the next send.
 *
 * Each link is read again right before its DM: one that is no longer
 * `pending` (a resend delivered it meanwhile) or whose DM is in flight
 * elsewhere is skipped. After each DM the run's `sent` counter is set to the
 * number of sent links of the year, so no link is ever counted twice.
 */
async function sendLinks(ctx: BotContext, job: { id: number; year: number }): Promise<void> {
  const left = leftMemberIds();
  const pending = db
    .select({ userId: schema.activityWrappedLinks.userId, token: schema.activityWrappedLinks.token })
    .from(schema.activityWrappedLinks)
    .where(
      and(
        eq(schema.activityWrappedLinks.year, job.year),
        eq(schema.activityWrappedLinks.private, 0),
        eq(schema.activityWrappedLinks.dmStatus, "pending"),
      ),
    )
    .orderBy(schema.activityWrappedLinks.userId)
    .all();

  let first = true;
  let streak = 0;
  for (const link of pending) {
    if (left.has(link.userId)) continue;
    const key = flightKey(link.userId, job.year);
    if (inFlight.has(key) || dmStatusOf(link.userId, job.year) !== "pending") continue;
    if (!isOptedIn(link.userId)) {
      setDmStatus(link.userId, job.year, "skipped");
      updateRun(job.id, {});
      continue;
    }
    if (!first) await sleep(wrappedRunTiming.sendDelayMs);
    first = false;
    // The pause may have let a resend in: read the link once more.
    if (inFlight.has(key) || dmStatusOf(link.userId, job.year) !== "pending") continue;
    inFlight.add(key);
    let outcome: DmOutcome;
    try {
      outcome = await deliverDm(ctx, link.userId, link.token, job.year);
    } finally {
      inFlight.delete(key);
    }
    setDmStatus(link.userId, job.year, outcome.status);
    const r = schema.activityWrappedRuns;
    updateRun(job.id, outcome.status === "sent" ? { sent: linkCount(job.year, "sent") } : { failed: sql`${r.failed} + 1` });
    streak = outcome.status === "failed" && !outcome.perMember ? streak + 1 : 0;
    if (outcome.status === "failed" && streak >= SEND_BREAKER_LIMIT) {
      throw new Error(
        `stopped after ${SEND_BREAKER_LIMIT} dms in a row failed with a discord or network error (last: ${outcome.message}); ` +
          "the remaining links are still pending, send again to continue",
      );
    }
  }
}

/** Failures in a row (not per-member refusals) after which a send step stops. */
export const SEND_BREAKER_LIMIT = 5;

/** The run error when the live member list could not be fetched. */
const MEMBER_FETCH_FALLBACK =
  "the guild member list could not be fetched; members who left were taken from the membership table only";

/**
 * The ids of the locked guild's current members, fetched from Discord, so a
 * member who left before capture started (and so has no `leave` row) gets no
 * link and does not count. Never throws.
 *
 * @returns The ids, or null when the guild or its members cannot be fetched.
 */
async function liveMemberIds(ctx: BotContext): Promise<Set<string> | null> {
  try {
    const guild = ctx.client.guilds.cache.get(ctx.guildId) ?? (await ctx.client.guilds.fetch(ctx.guildId));
    const members = await guild.members.fetch();
    return new Set(members.keys());
  } catch (err) {
    console.error("[wrapped] member list fetch failed:", err);
    return null;
  }
}

/** Keep `message` as the run's error unless one is already stored. */
function noteError(id: number, message: string): void {
  const r = schema.activityWrappedRuns;
  db.update(r).set({ error: message, updatedAt: nowSec() }).where(and(eq(r.id, id), isNull(r.error))).run();
}

/** An error's message, for the run status. */
function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** Stamp a link as processed by run `id` without touching its snapshot. */
function markProcessed(userId: string, year: number, id: number): void {
  const l = schema.activityWrappedLinks;
  db.update(l)
    .set({ processedRunId: id })
    .where(and(eq(l.userId, userId), eq(l.year, year), eq(l.private, 0)))
    .run();
}

/** A link's DM status. */
type RunLinkStatus = "pending" | "sent" | "failed" | "skipped";

/** What one DM attempt came to. */
type DmOutcome = Awaited<ReturnType<typeof sendWrappedDmDetailed>>;

/** DM a member their link, with the failure kind (see `sendWrappedDmDetailed`). */
function deliverDm(ctx: BotContext, userId: string, token: string, year: number): Promise<DmOutcome> {
  return sendWrappedDmDetailed(ctx.client, userId, linkUrl(token), year);
}

/** Set a link's DM status. */
function setDmStatus(userId: string, year: number, dmStatus: RunLinkStatus): void {
  db.update(schema.activityWrappedLinks)
    .set({ dmStatus })
    .where(
      and(
        eq(schema.activityWrappedLinks.userId, userId),
        eq(schema.activityWrappedLinks.year, year),
        eq(schema.activityWrappedLinks.private, 0),
      ),
    )
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
