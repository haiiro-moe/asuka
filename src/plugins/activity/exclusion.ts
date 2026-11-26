/**
 * Channels left out of activity analytics.
 *
 * `guild_config.activityExcludedChannelIds` is a comma list of channel ids. An
 * excluded channel is not recorded, not backfilled and not counted by any
 * query, and the same goes for every thread under it.
 *
 * The list is read from the config on each call, never at module top level:
 * plugin modules are loaded before `initDb()` has run.
 */
import { and, isNull, notInArray, or, sql } from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import type { SQLiteColumn } from "drizzle-orm/sqlite-core";
import { getConfig } from "../../db/index.ts";

/**
 * The excluded channel ids, read from the guild config.
 *
 * @returns The ids in `activityExcludedChannelIds`; empty when none are set.
 */
export function excludedChannelIds(): Set<string> {
  const ids = getConfig()
    .activityExcludedChannelIds.split(",")
    .map((id) => id.trim())
    .filter((id) => id !== "");
  return new Set(ids);
}

/**
 * Whether activity in a channel must be left out.
 *
 * @param channelId - The channel, or the thread, the activity happened in.
 * @param parentChannelId - The parent channel when `channelId` is a thread.
 * @returns True when the channel or its parent is excluded.
 */
export function isExcluded(channelId: string, parentChannelId?: string | null): boolean {
  const excluded = excludedChannelIds();
  if (excluded.size === 0) return false;
  return excluded.has(channelId) || (parentChannelId != null && excluded.has(parentChannelId));
}

/** True when `column` is null or holds none of `ids`. */
function holdsNone(column: SQLiteColumn, ids: string[]): SQL {
  // `NULL NOT IN (...)` is NULL in SQL, which would drop the row.
  return or(isNull(column), notInArray(column, ids))!;
}

/**
 * A Drizzle filter that keeps only rows outside the excluded channels.
 *
 * Build it inside the query function, at call time: it reads the config when
 * called, so a channel excluded later drops out of the next query.
 *
 * @param channelColumn - The row's channel id column.
 * @param parentColumn - The row's parent-channel column, for tables that have
 *   one. With it, a thread under an excluded channel is hidden too.
 * @returns An expression that is true when neither column holds an excluded
 *   channel. It is true for every row when the list is empty.
 *
 * @example
 * ```ts
 * db.select()
 *   .from(activityMessages)
 *   .where(and(gte(activityMessages.ts, from), notExcluded(activityMessages.channelId, activityMessages.parentChannelId)));
 * ```
 */
export function notExcluded(channelColumn: SQLiteColumn, parentColumn?: SQLiteColumn): SQL {
  const ids = [...excludedChannelIds()];
  if (ids.length === 0) return sql`1 = 1`;
  if (!parentColumn) return holdsNone(channelColumn, ids);
  return and(holdsNone(channelColumn, ids), holdsNone(parentColumn, ids))!;
}
