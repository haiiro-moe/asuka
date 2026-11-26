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
import type { WrappedData } from "../types/wrapped.ts";
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
 * @param token - The token from the URL.
 * @returns The link, or null for an unknown, truncated or malformed token.
 */
export function peekLinkByToken(token: string): WrappedLink | null {
  if (typeof token !== "string" || token.length !== TOKEN_LENGTH) return null;
  const row = db
    .select({
      userId: schema.activityWrappedLinks.userId,
      year: schema.activityWrappedLinks.year,
      data: schema.activityWrappedLinks.data,
    })
    .from(schema.activityWrappedLinks)
    .where(eq(schema.activityWrappedLinks.token, token))
    .get();
  if (!row) return null;
  return { userId: row.userId, year: row.year, data: JSON.parse(row.data) as WrappedData };
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
 * The stored link of a member for a year.
 *
 * @param userId - The member.
 * @param year - The year.
 * @returns The token and DM status, or null when the member has no link that year.
 */
export function getWrappedLink(
  userId: string,
  year: number,
): { token: string; dmStatus: "pending" | "sent" | "failed" | "skipped" } | null {
  return (
    db
      .select({ token: schema.activityWrappedLinks.token, dmStatus: schema.activityWrappedLinks.dmStatus })
      .from(schema.activityWrappedLinks)
      .where(and(eq(schema.activityWrappedLinks.userId, userId), eq(schema.activityWrappedLinks.year, year)))
      .get() ?? null
  );
}

/**
 * Create a member's link for a year, or refresh its snapshot.
 *
 * An existing link keeps its token, its DM status and its open count; only the
 * snapshot is replaced.
 *
 * @param userId - The member.
 * @param year - The year.
 * @param data - The snapshot, from {@link buildWrapped}.
 * @returns The link's token.
 */
export function upsertWrappedLink(userId: string, year: number, data: WrappedData): string {
  const json = JSON.stringify(data);
  db.insert(schema.activityWrappedLinks)
    .values({ userId, year, token: newToken(), data: json, createdAt: nowSec() })
    .onConflictDoUpdate({
      target: [schema.activityWrappedLinks.userId, schema.activityWrappedLinks.year],
      set: { data: json },
    })
    .run();
  return getWrappedLink(userId, year)!.token;
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
