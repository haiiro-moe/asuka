/**
 * Personal Wrapped links: one per member and year, at `/wrapped/<token>`.
 *
 * A link is reusable. Opening it counts the open and never deletes or burns
 * it, and a token only ever resolves to the snapshot it was made for. Tokens
 * are 32 random bytes, so they cannot be guessed.
 *
 * See docs/activity/wrapped.md.
 *
 * @packageDocumentation
 */
import { randomBytes } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { env } from "../../../config/env.ts";
import { nowSec } from "../../../core/util.ts";
import { db, schema } from "../../../db/index.ts";
import type { WrappedData, WrappedFailedList } from "../types/wrapped.ts";
import { buildWrapped } from "./data.ts";

/** Length of a token: 32 bytes in base64url without padding. */
const TOKEN_LENGTH = 43;

/** A link resolved from its token. */
export interface WrappedLink {
  /** The member the link belongs to. */
  userId: string;
  /** The year of the snapshot. */
  year: number;
  /** The member's snapshot. */
  data: WrappedData;
  /** True for a private preview link (an admin's preview, not the real Wrapped). */
  preview: boolean;
}

/** How long a private preview link and its run live, in seconds (14 days). */
export const PREVIEW_TTL_SECONDS = 14 * 86400;

/**
 * Whether a private run still backs its links: it exists, is private, belongs
 * to `ownerUserId` and started less than {@link PREVIEW_TTL_SECONDS} ago.
 */
export function previewRunAlive(runId: number | null, ownerUserId: string, now: number = nowSec()): boolean {
  if (runId === null) return false;
  const r = schema.activityWrappedRuns;
  const run = db
    .select({ startedAt: r.startedAt })
    .from(r)
    .where(and(eq(r.id, runId), eq(r.kind, "private"), eq(r.ownerUserId, ownerUserId)))
    .get();
  return !!run && run.startedAt > now - PREVIEW_TTL_SECONDS;
}

/**
 * A new link token.
 *
 * @returns 32 random bytes, base64url without padding (43 characters).
 */
export function newToken(): string {
  return randomBytes(32).toString("base64url");
}

/**
 * The public URL of a link.
 *
 * @param token - The link's token.
 * @returns `${PUBLIC_URL}/wrapped/<token>`.
 */
export function linkUrl(token: string): string {
  return `${env.PUBLIC_URL}/wrapped/${token}`;
}

/**
 * Resolve a token without counting it as an open (the card image route uses
 * this, so fetching the image does not double the open count).
 *
 * A private preview link resolves only while its preview run exists and is
 * younger than 14 days ({@link previewRunAlive}); after that it is treated as
 * unknown (the uniform 404) and deleted at the next preview start.
 *
 * @param token - The token from the URL.
 * @returns The link, or null for an unknown, truncated, malformed or expired token.
 */
export function peekLinkByToken(token: string): WrappedLink | null {
  if (typeof token !== "string" || token.length !== TOKEN_LENGTH) return null;
  const l = schema.activityWrappedLinks;
  const row = db
    .select({
      userId: l.userId,
      year: l.year,
      data: l.data,
      private: l.private,
      ownerUserId: l.ownerUserId,
      processedRunId: l.processedRunId,
    })
    .from(l)
    .where(eq(l.token, token))
    .get();
  if (!row) return null;
  const preview = row.private === 1;
  if (preview && !previewRunAlive(row.processedRunId, row.ownerUserId)) return null;
  return { userId: row.userId, year: row.year, data: JSON.parse(row.data) as WrappedData, preview };
}

/**
 * Open a link: resolve its token and count the open.
 *
 * The link stays valid: `opens` goes up by one and `lastOpenedAt` is set, and
 * nothing is deleted, so the same token returns the same snapshot every time.
 *
 * @param token - The token from the URL.
 * @returns The link's member, year and snapshot, or null for an unknown or
 *   truncated token (which counts nothing).
 */
export function getLinkByToken(token: string): WrappedLink | null {
  const link = peekLinkByToken(token);
  if (!link) return null;
  db.update(schema.activityWrappedLinks)
    .set({ opens: sql`${schema.activityWrappedLinks.opens} + 1`, lastOpenedAt: nowSec() })
    .where(eq(schema.activityWrappedLinks.token, token))
    .run();
  return link;
}

/**
 * The stored link of a member for a year: the real link, or with
 * `ownerUserId` the private preview link that admin owns.
 *
 * @param userId - The member.
 * @param year - The year.
 * @param ownerUserId - The preview owner; "" (default) for the real link.
 * @returns The token and DM status, or null when the member has no such link.
 */
export function getWrappedLink(
  userId: string,
  year: number,
  ownerUserId = "",
): { token: string; dmStatus: "pending" | "sent" | "failed" | "skipped" } | null {
  const l = schema.activityWrappedLinks;
  return (
    db
      .select({ token: l.token, dmStatus: l.dmStatus })
      .from(l)
      .where(and(eq(l.userId, userId), eq(l.year, year), eq(l.ownerUserId, ownerUserId)))
      .get() ?? null
  );
}

/**
 * Create a member's link for a year, or refresh its snapshot.
 *
 * An existing link keeps its token, its DM status and its open count; only the
 * snapshot is replaced (and `processedRunId`, when a run passes one).
 *
 * @param userId - The member.
 * @param year - The year.
 * @param data - The snapshot, from {@link buildWrapped}.
 * @param processedRunId - The run that built the snapshot. Left out (an admin
 *   preview, `/wrapped me`), a new link gets null and an existing one keeps its value.
 * @param ownerUserId - For a private preview link, the owning admin; "" (default)
 *   for the real link. The two never share a row.
 * @returns The link's token.
 */
export function upsertWrappedLink(
  userId: string,
  year: number,
  data: WrappedData,
  processedRunId?: number,
  ownerUserId = "",
): string {
  const json = JSON.stringify(data);
  const l = schema.activityWrappedLinks;
  db.insert(l)
    .values({
      userId,
      year,
      token: newToken(),
      data: json,
      createdAt: nowSec(),
      processedRunId: processedRunId ?? null,
      private: ownerUserId === "" ? 0 : 1,
      ownerUserId,
    })
    .onConflictDoUpdate({
      target: [l.userId, l.year, l.ownerUserId],
      set: processedRunId === undefined ? { data: json } : { data: json, processedRunId },
    })
    .run();
  return getWrappedLink(userId, year, ownerUserId)!.token;
}

/**
 * A member's link for a year, making the snapshot first when they have none
 * (an admin previewing a link, or `/wrapped me` after a run missed them). An
 * existing link is returned as it is, without refreshing its snapshot.
 *
 * @param userId - The member.
 * @param year - The year.
 * @returns The token, or null when the member has no activity that year.
 */
export function ensureWrappedLink(userId: string, year: number): string | null {
  const existing = getWrappedLink(userId, year);
  if (existing) return existing.token;
  const data = buildWrapped(userId, year);
  if (!data) return null;
  return upsertWrappedLink(userId, year, data);
}

/** Most items {@link listFailedDms} returns. */
export const FAILED_DM_LIMIT = 200;

/**
 * The members of a year whose Wrapped DM failed and who are still opted in,
 * for the admin's resend list. One SQL query (links joined with opt-ins); no
 * Discord call.
 *
 * @param year - The year.
 * @param limit - Most items to return (default {@link FAILED_DM_LIMIT}).
 * @returns The items ordered by user id, and `truncated` when more exist.
 */
export function listFailedDms(year: number, limit: number = FAILED_DM_LIMIT): WrappedFailedList {
  const l = schema.activityWrappedLinks;
  const o = schema.activityWrappedOptins;
  const rows = db
    .select({ userId: l.userId })
    .from(l)
    .innerJoin(o, eq(o.userId, l.userId))
    .where(and(eq(l.year, year), eq(l.private, 0), eq(l.dmStatus, "failed")))
    .orderBy(l.userId)
    .limit(limit + 1)
    .all();
  return {
    year,
    items: rows.slice(0, limit).map((r) => ({ userId: r.userId, state: "failed" as const })),
    truncated: rows.length > limit,
  };
}
