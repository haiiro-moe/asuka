/**
 * Pure scaling helpers for the activity charts. No DOM and no server imports, so they are unit-tested
 * with `bun test`.
 *
 * @module
 */

/** One of the five heatmap steps: `0` is the empty overlay, `1` to `4` are the lightness steps. */
export type HeatLevel = 0 | 1 | 2 | 3 | 4;

/**
 * Scales values to whole-free percentages of the largest one.
 *
 * @param values - Non-negative numbers (negative and non-finite values count as 0).
 * @returns Numbers from 0 to 100, same length and order; all zeros when every input is zero.
 */
export function scaleToPercent(values: number[]): number[] {
  const clean = values.map((v) => (Number.isFinite(v) && v > 0 ? v : 0));
  const max = Math.max(0, ...clean);
  if (max === 0) return clean.map(() => 0);
  return clean.map((v) => (v / max) * 100);
}

/**
 * Picks the heatmap step for a cell. Zero is always step 0 and any positive value is at least step 1,
 * so a quiet hour never reads as empty.
 *
 * @param value - The cell's count.
 * @param max - The largest count on the map; with `0` or less every cell is step 0.
 * @returns The step, `0` to `4`.
 */
export function heatLevel(value: number, max: number): HeatLevel {
  if (!(max > 0) || !(value > 0)) return 0;
  const step = Math.ceil((Math.min(value, max) / max) * 4);
  return Math.max(1, Math.min(4, step)) as HeatLevel;
}
