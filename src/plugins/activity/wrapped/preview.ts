/**
 * Private Wrapped previews: an admin generates the year's Wrapped for a small
 * sample and gets, by DM, exactly what members and the announcements channel
 * would get. Rulings R-P1..R-P7 (plan DECISIONS.md).
 *
 * - **A separate run kind** (`activity_wrapped_runs.kind = "private"`, owned
 *   by the admin). It never touches the real run, the real links, the sign-up
 *   message, the announcement claim or the server snapshot behind the public
 *   link. Its links are rows with `private = 1` and `ownerUserId` set, so a
 *   member can hold a real and a preview link for the same year. Its server
 *   snapshot lives in the run's `preview` JSON with its own `serverToken`.
 * - **Nothing reaches members or channels.** Every DM goes to the owning admin:
 *   an intro, then each sampled member's real DM labelled "preview for <name>"
 *   with their private link, the announcement with its buttons disabled, and
 *   the private server link.
 * - **Opt-ins are ignored** when generating; the status reports who would be
 *   skipped, and each preview says so. The best-pair rule is unchanged.
 * - **Scope**: the admin plus the most active members (3 by default, at most
 *   10), or an explicit list of at most 10 ids; `all` also builds every
 *   member's snapshot for the counts (the DMs still cover the sample only).
 * - **Lifecycle**: `processing` -> `processed` -> `sending` -> `done`, plus
 *   `failed` and `interrupted` (resume continues). Starting a preview is a
 *   manual admin action; the DMs to the admin follow automatically. Previews
 *   and their links last 14 days; expired ones give the uniform 404 and are
 *   deleted at the next preview start. Discard deletes them at once.
 * - The voice rule applies (readiness is checked once per preview).
 *
 * See docs/activity/wrapped.md, "Private wrapped (preview)".
 *
 * @packageDocumentation
 */
import { and, count, desc, eq, gte, inArray, lt, notInArray, sql } from "drizzle-orm";
import { renderBotMessage } from "../../../core/messages.ts";
import type { BotContext } from "../../../core/plugin.ts";
import { nowSec } from "../../../core/util.ts";
import { db, schema } from "../../../db/index.ts";
import { notExcluded } from "../exclusion.ts";
import type { PreviewRunState, PreviewStatus, ServerWrapped } from "../types/wrapped.ts";
import { voiceReadiness } from "../voice-ready.ts";
import { withWrappedBanner } from "./banner.ts";
import { activeMemberIds, buildWrapped, leftMemberIds, wrappedShared, yearBounds } from "./data.ts";
import { wrappedDmPayload } from "./dm.ts";
import { PREVIEW_TTL_SECONDS, getWrappedLink, linkUrl, newToken, upsertWrappedLink } from "./links.ts";
import { currentUtcYear, isOptedIn } from "./optin.ts";
import { wrappedRunTiming } from "./run.ts";
import { buildServerWrapped, serverWrappedDeps, serverWrappedUrl } from "./server.ts";
import { toggleButtons } from "./signup.ts";

/** Sampled members when none are named. */
export const PREVIEW_DEFAULT_SAMPLE = 3;
/** Most sampled or named members in one preview. */
export const PREVIEW_MAX_MEMBERS = 10;

/** A private run's own state, stored as JSON in `activity_wrapped_runs.preview`. */
interface PreviewState {
  /** Every member was processed (the dry run). */
  all: boolean;
  /** The members previewed by DM, in order. */
  sample: string[];
  /** Everyone to process: the sample, plus every active member with `all`. */
  members: string[];
  /** Display names of the sampled members, resolved while processing. */
  names: Record<string, string | null>;
  /** The private server snapshot; null until built. */
  server: ServerWrapped | null;
  /** Whether voice figures were shown (checked once). */
  voiceReady: boolean;
  /** Preview DMs already sent (the resume point). */
  dmStep: number;
  /** The admin could not be DM'd. */
  dmFailed: boolean;
  /** What went wrong, in plain words. */
  error: string | null;
}

type RunRow = typeof schema.activityWrappedRuns.$inferSelect;

/** Preview work in progress in this process, by run id. */
const active = new Map<number, Promise<void>>();

/**
 * Wait for every preview running in this process (tests and shutdown).
 *
 * @returns A promise that settles when they have all ended.
 */
export async function waitForWrappedPreviews(): Promise<void> {
  while (active.size > 0) await Promise.all([...active.values()]);
}

/**
 * Parse a member list typed in Discord: ids or mentions (`<@id>`, `<@!id>`),
 * separated by spaces or commas.
 *
 * @param input - The text.
 * @returns Distinct numeric ids, or null when an item is not an id or there are
 *   more than {@link PREVIEW_MAX_MEMBERS}.
 */
export function parseMemberIds(input: string): string[] | null {
  const ids: string[] = [];
  for (const raw of input.split(/[\s,]+/).filter((x) => x !== "")) {
    const id = raw.replace(/^<@!?(\d+)>$/, "$1");
    if (!/^\d{1,25}$/.test(id)) return null;
    if (!ids.includes(id)) ids.push(id);
  }
  return ids.length > PREVIEW_MAX_MEMBERS ? null : ids;
}

/** The owner's latest private run. */
function latestPreview(ownerUserId: string): RunRow | undefined {
  const r = schema.activityWrappedRuns;
  return db
    .select()
    .from(r)
    .where(and(eq(r.kind, "private"), eq(r.ownerUserId, ownerUserId)))
    .orderBy(desc(r.id))
    .limit(1)
    .get();
}

/** A run's preview state. */
function stateOf(row: RunRow): PreviewState {
  return JSON.parse(row.preview ?? "{}") as PreviewState;
}

/** Update a private run row (and its state), stamping `updatedAt`. */
function updatePreview(id: number, set: Partial<Omit<RunRow, "preview">>, state?: PreviewState): void {
  db.update(schema.activityWrappedRuns)
    .set({ ...set, ...(state ? { preview: JSON.stringify(state) } : {}), updatedAt: nowSec() } as never)
    .where(eq(schema.activityWrappedRuns.id, id))
    .run();
}

/** Whether a processing or sending preview has gone quiet (not running here, no update for 120 s). */
function isStale(row: RunRow): boolean {
  return (
    (row.status === "processing" || row.status === "sending") &&
    !active.has(row.id) &&
    nowSec() - row.updatedAt > wrappedRunTiming.staleSeconds
  );
}

/** Delete private runs (and their links) by id. */
function deletePreviews(ids: number[]): void {
  if (ids.length === 0) return;
  db.delete(schema.activityWrappedLinks)
    .where(and(eq(schema.activityWrappedLinks.private, 1), inArray(schema.activityWrappedLinks.processedRunId, ids)))
    .run();
  db.delete(schema.activityWrappedRuns).where(inArray(schema.activityWrappedRuns.id, ids)).run();
}

/** Delete every expired private run and its links, and private links whose run is gone. */
function sweepExpiredPreviews(now: number = nowSec()): void {
  const r = schema.activityWrappedRuns;
  const expired = db
    .select({ id: r.id })
    .from(r)
    .where(and(eq(r.kind, "private"), lt(r.startedAt, now - PREVIEW_TTL_SECONDS)))
    .all()
    .map((x) => x.id);
  deletePreviews(expired);
  const live = db.select({ id: r.id }).from(r).where(eq(r.kind, "private")).all().map((x) => x.id);
  db.delete(schema.activityWrappedLinks)
    .where(
      and(
        eq(schema.activityWrappedLinks.private, 1),
        live.length > 0 ? notInArray(schema.activityWrappedLinks.processedRunId, live) : undefined,
      ),
    )
    .run();
}

/** The most active members of a year by messages (excluding `exclude` and members who left). */
function mostActive(year: number, n: number, exclude: string): string[] {
  const { from, to } = yearBounds(year);
  const m = schema.activityMessages;
  const left = leftMemberIds();
  return db
    .select({ userId: m.userId, n: count() })
    .from(m)
    .where(and(gte(m.ts, from), lt(m.ts, to), notExcluded(m.channelId, m.parentChannelId)))
    .groupBy(m.userId)
    .orderBy(desc(count()), m.userId)
    .limit(n + left.size + 1)
    .all()
    .map((row) => row.userId)
    .filter((id) => id !== exclude && !left.has(id))
    .slice(0, n);
}

/**
 * Start a private preview for an admin, in the background. Returns at once;
 * the progress is in {@link getPreviewStatus}. The admin gets the preview by
 * DM when it is ready; nobody else is written to.
 *
 * Expired previews (anyone's) are deleted first, and so are the admin's own
 * earlier previews, so an admin has at most one.
 *
 * @param ctx - Bot context.
 * @param opts.ownerUserId - The requesting admin (from the session or the interaction, never a body field).
 * @param opts.year - The year (default the current UTC year).
 * @param opts.members - Preview exactly these member ids (at most 10) instead of the sample.
 * @param opts.all - Also build every member's snapshot, for the counts.
 * @param opts.sample - Sample size (default 3, at most 10).
 * @returns `started`, `already-running` while the admin's preview is processing
 *   or sending, or `invalid` with an `error` for a bad member list.
 */
export function startWrappedPreview(
  ctx: BotContext,
  opts: { ownerUserId: string; year?: number; members?: string[]; all?: boolean; sample?: number },
): { result: "started" | "already-running" | "invalid"; error?: string } {
  if (opts.members !== undefined) {
    if (!Array.isArray(opts.members) || opts.members.length > PREVIEW_MAX_MEMBERS) {
      return { result: "invalid", error: `name at most ${PREVIEW_MAX_MEMBERS} members` };
    }
    if (!opts.members.every((id) => typeof id === "string" && /^\d{1,25}$/.test(id))) {
      return { result: "invalid", error: "member ids must be numbers" };
    }
  }
  const owner = opts.ownerUserId;
  const latest = latestPreview(owner);
  if (latest && (latest.status === "processing" || latest.status === "sending") && !isStale(latest)) {
    return { result: "already-running" };
  }

  sweepExpiredPreviews();
  const r = schema.activityWrappedRuns;
  const mine = db
    .select({ id: r.id })
    .from(r)
    .where(and(eq(r.kind, "private"), eq(r.ownerUserId, owner)))
    .all()
    .map((x) => x.id);
  deletePreviews(mine);

  const year = opts.year ?? currentUtcYear();
  const voiceReady = voiceReadiness().ready;
  const size = Math.min(PREVIEW_MAX_MEMBERS, Math.max(1, Math.floor(opts.sample ?? PREVIEW_DEFAULT_SAMPLE)));
  const sample =
    opts.members && opts.members.length > 0 ? [...new Set(opts.members)] : [owner, ...mostActive(year, size, owner)];
  const members = opts.all ? [...new Set([...sample, ...activeMemberIds(year, voiceReady)])] : sample;
  const state: PreviewState = {
    all: opts.all === true,
    sample,
    members,
    names: {},
    server: null,
    voiceReady,
    dmStep: 0,
    dmFailed: false,
    error: null,
  };
  const now = nowSec();
  const id = db
    .insert(r)
    .values({
      year,
      status: "processing",
      kind: "private",
      ownerUserId: owner,
      startedBy: owner,
      total: members.length,
      processed: 0,
      announce: 0,
      serverToken: newToken(),
      preview: JSON.stringify(state),
      startedAt: now,
      updatedAt: now,
    })
    .returning({ id: r.id })
    .get().id;
  launch(id, () => work(ctx, id, "processing"));
  return { result: "started" };
}

/**
 * Continue the admin's interrupted preview in the phase it stopped in.
 *
 * @param ctx - Bot context.
 * @param ownerUserId - The admin.
 * @returns `resumed`, or `nothing-to-resume`.
 */
export function resumeWrappedPreview(ctx: BotContext, ownerUserId: string): "resumed" | "nothing-to-resume" {
  const row = latestPreview(ownerUserId);
  if (!row || !isStale(row)) return "nothing-to-resume";
  updatePreview(row.id, {});
  const phase = row.status === "processing" ? "processing" : "sending";
  launch(row.id, () => work(ctx, row.id, phase));
  return "resumed";
}

/**
 * Discard the admin's preview: delete the run, its links and its server story.
 *
 * @param ownerUserId - The admin.
 * @returns `discarded`, `nothing` when there is none, or `running` while it is
 *   processing or sending (wait for it, then discard).
 */
export function discardWrappedPreview(ownerUserId: string): "discarded" | "nothing" | "running" {
  const r = schema.activityWrappedRuns;
  const rows = db.select().from(r).where(and(eq(r.kind, "private"), eq(r.ownerUserId, ownerUserId))).all();
  if (rows.length === 0) return "nothing";
  if (rows.some((row) => active.has(row.id))) return "running";
  deletePreviews(rows.map((row) => row.id));
  return "discarded";
}

/** The status of an admin who has no preview. */
function idleStatus(): PreviewStatus {
  return {
    id: null,
    status: "idle",
    year: null,
    total: 0,
    done: 0,
    all: false,
    sampled: [],
    wouldSkip: 0,
    dmFailed: false,
    links: [],
    serverToken: null,
    expiresAt: null,
    error: null,
    startedAt: null,
    finishedAt: null,
  };
}

/**
 * The admin's latest preview. Only the owner's own preview is ever returned;
 * an expired one reads as `idle`.
 *
 * @param ownerUserId - The admin.
 */
export function getPreviewStatus(ownerUserId: string): PreviewStatus {
  const row = latestPreview(ownerUserId);
  if (!row || row.startedAt <= nowSec() - PREVIEW_TTL_SECONDS) return idleStatus();
  const state = stateOf(row);
  const l = schema.activityWrappedLinks;
  const owned = and(eq(l.private, 1), eq(l.ownerUserId, ownerUserId), eq(l.processedRunId, row.id));
  const sampleLinks = new Map(
    (state.sample.length === 0
      ? []
      : db.select({ userId: l.userId, token: l.token }).from(l).where(and(owned, inArray(l.userId, state.sample))).all()
    ).map((x) => [x.userId, x.token]),
  );
  const wouldSkip =
    db
      .select({ n: count() })
      .from(l)
      .where(and(owned, sql`${l.userId} not in (select ${schema.activityWrappedOptins.userId} from ${schema.activityWrappedOptins})`))
      .get()?.n ?? 0;
  return {
    id: row.id,
    status: (isStale(row) ? "interrupted" : row.status) as PreviewRunState,
    year: row.year,
    total: row.total,
    done: row.processed,
    all: state.all,
    sampled: state.sample.map((userId) => ({
      userId,
      displayName: state.names[userId] ?? null,
      wouldSkip: !isOptedIn(userId),
      hasLink: sampleLinks.has(userId),
    })),
    wouldSkip,
    dmFailed: state.dmFailed,
    links: state.sample.filter((u) => sampleLinks.has(u)).map((userId) => ({ userId, token: sampleLinks.get(userId)! })),
    serverToken: state.server ? row.serverToken : null,
    expiresAt: row.startedAt + PREVIEW_TTL_SECONDS,
    error: state.error,
    startedAt: row.startedAt,
    finishedAt: row.finishedAt,
  };
}

/**
 * A private run's server story, for the public `s/:token` route: only while
 * the run exists and is younger than 14 days.
 *
 * @param token - The token from the URL.
 * @returns The year and snapshot, or null.
 */
export function getPreviewServerByToken(token: string): { year: number; data: ServerWrapped } | null {
  const r = schema.activityWrappedRuns;
  const row = db
    .select()
    .from(r)
    .where(and(eq(r.kind, "private"), eq(r.serverToken, token)))
    .get();
  if (!row || row.startedAt <= nowSec() - PREVIEW_TTL_SECONDS) return null;
  const server = stateOf(row).server;
  return server ? { year: row.year, data: server } : null;
}

/** Run preview work in the background, remembered by run id. */
function launch(id: number, job: () => Promise<void>): void {
  const promise = Promise.resolve()
    .then(job)
    .finally(() => active.delete(id));
  active.set(id, promise);
}

/** The preview's body: process, then DM the admin. Never throws. */
async function work(ctx: BotContext, id: number, phase: "processing" | "sending"): Promise<void> {
  try {
    if (phase === "processing") {
      await processPreview(ctx, id);
      updatePreview(id, { status: "processed" });
    }
    updatePreview(id, { status: "sending" });
    await sendPreview(ctx, id);
    updatePreview(id, { status: "done", finishedAt: nowSec() });
  } catch (err) {
    console.error(`[wrapped] preview ${id} failed:`, err);
    const row = db.select().from(schema.activityWrappedRuns).where(eq(schema.activityWrappedRuns.id, id)).get();
    if (!row) return;
    const state = stateOf(row);
    state.error = "the preview stopped on an error. start it again.";
    updatePreview(id, { status: "failed", finishedAt: nowSec() }, state);
  }
}

/** A display name: the guild cache, else the user, else null. */
async function displayName(ctx: BotContext, userId: string): Promise<string | null> {
  const guild = ctx.client.guilds?.cache?.get(ctx.guildId);
  const member = guild?.members.cache.get(userId);
  if (member) return member.displayName;
  const user = await ctx.client.users.fetch(userId).catch(() => null);
  return user?.displayName ?? user?.username ?? null;
}

/**
 * Build each member's private snapshot and link (those this run has not built
 * yet), then the private server snapshot and the sampled members' names.
 */
async function processPreview(ctx: BotContext, id: number): Promise<void> {
  const row = db.select().from(schema.activityWrappedRuns).where(eq(schema.activityWrappedRuns.id, id)).get()!;
  const owner = row.ownerUserId!;
  const state = stateOf(row);
  const shared = wrappedShared(row.year, state.voiceReady);
  const l = schema.activityWrappedLinks;
  const done = new Set(
    db
      .select({ userId: l.userId })
      .from(l)
      .where(and(eq(l.private, 1), eq(l.ownerUserId, owner), eq(l.processedRunId, id)))
      .all()
      .map((x) => x.userId),
  );
  let processed = state.members.filter((u) => done.has(u)).length;
  updatePreview(id, { processed });
  for (const userId of state.members.filter((u) => !done.has(u))) {
    const data = buildWrapped(userId, row.year, shared);
    if (data) upsertWrappedLink(userId, row.year, data, id, owner);
    processed += 1;
    updatePreview(id, { processed });
    await new Promise((resolve) => setTimeout(resolve, 0));
  }

  const deps = await serverWrappedDeps(ctx);
  state.server = buildServerWrapped(row.year, { ...deps, clubs: shared.clubs, terms: shared.terms, voiceReady: state.voiceReady });
  for (const userId of state.sample) state.names[userId] = await displayName(ctx, userId);
  updatePreview(id, {}, state);
}

/** The preview DMs, in order: intro, each sampled member with a link, the announcement, the server link. */
function previewSteps(row: RunRow, state: PreviewState): string[] {
  const owner = row.ownerUserId!;
  const members = state.sample.filter((u) => getWrappedLink(u, row.year, owner) !== null).map((u) => `member:${u}`);
  return ["intro", ...members, "announce", "server"];
}

/** One preview DM's payload. */
async function previewPayload(ctx: BotContext, row: RunRow, state: PreviewState, step: string) {
  const owner = row.ownerUserId!;
  const year = row.year;
  const serverUrl = serverWrappedUrl(row.serverToken!);
  if (step === "intro") {
    const links = db
      .select({ n: count() })
      .from(schema.activityWrappedLinks)
      .where(and(eq(schema.activityWrappedLinks.private, 1), eq(schema.activityWrappedLinks.processedRunId, row.id)))
      .get()?.n ?? 0;
    return renderBotMessage("wrapped.preview-intro", ctx, { year, members: links });
  }
  if (step.startsWith("member:")) {
    const userId = step.slice("member:".length);
    const token = getWrappedLink(userId, year, owner)!.token;
    const name = state.names[userId] ?? userId;
    const label = await renderBotMessage(isOptedIn(userId) ? "wrapped.preview-for" : "wrapped.preview-skip", ctx, { member: name });
    const dm = await wrappedDmPayload(ctx.client, linkUrl(token), year);
    return { ...dm, components: [...label.components, ...dm.components] };
  }
  if (step === "announce") {
    const label = await renderBotMessage("wrapped.preview-announce", ctx, {});
    const announcement = await renderBotMessage("wrapped.announce", ctx, { year, url: serverUrl });
    announcement.components = toggleButtons(announcement.components, true) as typeof announcement.components;
    const withBanner = await withWrappedBanner(announcement, year);
    return { ...withBanner, components: [...label.components, ...withBanner.components] };
  }
  return renderBotMessage("wrapped.preview-server", ctx, { url: serverUrl });
}

/**
 * DM the admin the preview steps not sent yet, one per `sendDelayMs`. When the
 * admin cannot be DM'd the failure is recorded (`dmFailed`, `error`) and the
 * rest is not tried: the links are still in the dashboard.
 */
async function sendPreview(ctx: BotContext, id: number): Promise<void> {
  const row = db.select().from(schema.activityWrappedRuns).where(eq(schema.activityWrappedRuns.id, id)).get()!;
  const state = stateOf(row);
  const steps = previewSteps(row, state);
  const start = state.dmStep;
  for (let i = start; i < steps.length; i++) {
    if (i > start) await new Promise((resolve) => setTimeout(resolve, wrappedRunTiming.sendDelayMs));
    const payload = await previewPayload(ctx, row, state, steps[i]!);
    try {
      const user = await ctx.client.users.fetch(row.ownerUserId!);
      await user.send(payload as never);
    } catch {
      state.dmFailed = true;
      state.error = "could not dm you: your dms are closed. the preview links are listed in the dashboard.";
      updatePreview(id, {}, state);
      return;
    }
    state.dmStep = i + 1;
    updatePreview(id, {}, state);
  }
}
