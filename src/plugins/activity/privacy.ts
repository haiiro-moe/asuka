/**
 * Small-group suppression for views that must not identify a member.
 *
 * The president tier shows numbers only. A count of 1 or 2 can still point at a
 * person ("1 member went quiet"), so those counts are hidden. See
 * docs/activity/foundation.md.
 */

/** Smallest count that may be shown. Anything from 1 up to this, exclusive, is hidden. */
export const MIN_GROUP = 3;

/**
 * Hide a count that is too small to show.
 *
 * @param n - A count of members (or of anything that maps to members).
 * @returns `n` when it is 0 or at least {@link MIN_GROUP}; null for 1 and 2.
 *   Zero is shown because it identifies nobody.
 */
export function hideSmall(n: number): number | null {
  return n > 0 && n < MIN_GROUP ? null : n;
}

/**
 * Fold groups under {@link MIN_GROUP} members into one "other" bucket.
 *
 * @param sizes - Member count of each group.
 * @returns `shown`: the sizes of at least {@link MIN_GROUP}, in their given
 *   order. `other`: the members of all smaller groups added up, passed through
 *   {@link hideSmall}, so it is null when that sum is itself 1 or 2 and 0 when
 *   there was nothing to merge.
 *
 * @example
 * ```ts
 * mergeSmallGroups([14, 9, 2, 1, 5]); // { shown: [14, 9, 5], other: 3 }
 * mergeSmallGroups([14, 2]);          // { shown: [14], other: null }
 * ```
 */
export function mergeSmallGroups(sizes: number[]): { shown: number[]; other: number | null } {
  const shown: number[] = [];
  let small = 0;
  for (const size of sizes) {
    if (size >= MIN_GROUP) shown.push(size);
    else if (size > 0) small += size;
  }
  return { shown, other: hideSmall(small) };
}
