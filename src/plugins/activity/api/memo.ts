/**
 * A small in-memory memo for the heavy everyone-tier views.
 *
 * Every member may call the user routes, and some of them scan a whole period
 * of the log. A result is kept per (route, period, ten-minute window) and,
 * when it depends on who asks, per user id, so a burst of page loads costs
 * one computation per window. Numbers can be up to ten minutes stale, except
 * for the channel exclusion list: its signature (`exclusionSignature`) is
 * part of every key, so a channel excluded by any writer drops out of the very
 * next read. Entries stored under an older list are never returned and age out
 * through the size bound.
 *
 * The memo is bounded: at most {@link USER_MEMO_MAX_ENTRIES} results, the
 * least recently used one dropped first. It lives in this process only.
 *
 * @packageDocumentation
 */
import { nowSec } from "../../../core/util.ts";
import { exclusionSignature } from "../exclusion.ts";

/** Length of one memo window, in seconds (10 minutes). */
export const USER_MEMO_WINDOW_SECONDS = 600;

/** Most results kept at once. */
export const USER_MEMO_MAX_ENTRIES = 256;

/** The results, oldest use first (a `Map` keeps insertion order). */
const store = new Map<string, unknown>();

/** What a memoised result is keyed by. */
export interface UserMemoKey {
  /** The route name, e.g. `awards`. */
  route: string;
  /** The `?period=` value as asked (after the default is applied). */
  period: string;
  /** The requesting user, for a result that depends on who asks; left out otherwise. */
  userId?: string;
  /** Anything else the result depends on (voice readiness, the guild's emoji ids). */
  extra?: string;
  /**
   * The exclusion-list signature the result is computed under. Left out, it is
   * read from the config at call time, so callers need not pass it.
   */
  exclusions?: string;
}

/**
 * Return the memoised result for `key` in the current window, or compute and
 * keep it. The exclusion list in force is part of the key.
 *
 * @param key - What the result depends on.
 * @param compute - Builds the result; called at most once per key and window.
 * @param now - The current time in unix seconds (tests pass one).
 * @returns The result, the same value for every call in the window.
 */
export function userMemo<T>(key: UserMemoKey, compute: () => T, now: number = nowSec()): T {
  const window = Math.floor(now / USER_MEMO_WINDOW_SECONDS);
  const id = [key.route, key.period, key.userId ?? "", key.extra ?? "", key.exclusions ?? exclusionSignature(), window].join("\u0000");
  if (store.has(id)) {
    const hit = store.get(id) as T;
    // Most recently used goes last.
    store.delete(id);
    store.set(id, hit);
    return hit;
  }
  const value = compute();
  store.set(id, value);
  while (store.size > USER_MEMO_MAX_ENTRIES) store.delete(store.keys().next().value!);
  return value;
}

/** Drop every memoised result (tests, and after a change that must show at once). */
export function clearUserMemo(): void {
  store.clear();
}

/**
 * How many results are kept right now.
 *
 * @internal For the tests of the size bound.
 */
export function userMemoSize(): number {
  return store.size;
}
