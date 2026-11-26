/**
 * The ordered dither haiiro draws with: the 4x4 Bayer matrix and a token reader. Pure helpers, shared by
 * the blob backdrop ({@link startBlobs}).
 *
 * Ported from fishnet (`src/lib/design/dither.ts`, github.com/Kex1016/fishnet), the haiiro reference site.
 *
 * @module
 */

/** The 4x4 Bayer matrix, row by row, as thresholds in (0, 1): a cell is lit when its value is above. */
export const BAYER4: readonly number[] = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map(
  (v) => (v + 0.5) / 16,
);

/** The Bayer threshold of the cell at column `x`, row `y`. */
export function bayer(x: number, y: number): number {
  return BAYER4[(y & 3) * 4 + (x & 3)]!;
}

/** An RGB triple, 0 to 255 per channel. */
export type Tone = readonly [number, number, number];

/**
 * Parses a `#rrggbb` token value into an RGB triple.
 *
 * @param value - A colour as written in a token, for example the value of `--color-base`.
 * @param fallback - Returned when `value` is not six-digit hex.
 */
export function hexTone(value: string, fallback: Tone): Tone {
  const m = /^#([0-9a-f]{6})$/i.exec(value.trim());
  if (!m) return fallback;
  const n = parseInt(m[1]!, 16);
  return [n >> 16, (n >> 8) & 255, n & 255];
}
