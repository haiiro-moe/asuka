/**
 * haiiro design tokens for the satori cards.
 *
 * Values are copied from the haiiro design system's `tokens.json` (Rosé Pine main), so a
 * card reads the same colours as the web dashboard's `--color-*` / `--ink-*` custom
 * properties. This is the only file under `src/core/images` allowed to hold raw colour
 * values; every card and primitive reads colours from here.
 *
 * @packageDocumentation
 */

/**
 * The Rosé Pine palette. Each hue has one job (see the haiiro README's ink table):
 * pine frames and names, gold commands and first place, love failures and the prompt `@`,
 * rose narration and the `»` arrow, foam values and paths, iris files and media,
 * muted labels and keys.
 */
export const color = {
  /** Page background, the night sky. Also the dark tone of the still backdrop. */
  base: "#191724",
  /** Window fill and the notch label that cuts the frame. */
  surface: "#1f1d2e",
  /** Raised layers: the current row, hover cards, the backdrop halo tone. */
  overlay: "#26233a",
  /** Labels and keys. About 3.4:1 on base: labels and large text only. */
  muted: "#6e6a86",
  /** Secondary text that must stay readable at 16px. 5.5:1 on base. */
  subtle: "#908caa",
  /** Body text and 1px stat hairlines. 13:1 on base. */
  text: "#e0def4",
  /** The prompt `@`, failures, destructive and low scores. */
  love: "#eb6f92",
  /** Commands, the acting value, first place, middling scores. */
  gold: "#f6c177",
  /** Narration (second-person voice) and the `»` arrow. */
  rose: "#ebbcba",
  /** The signature colour: window frames, names. 3.4:1: borders and large text only. */
  pine: "#31748f",
  /** Values, paths, in-window headings, second place, high scores. */
  foam: "#9ccfd8",
  /** Files, media and arguments, third place. */
  iris: "#c4a7e7",
  /** Faintest highlight: selected rows on base. */
  highlightLow: "#21202e",
  /** Medium highlight: inactive borders, the backdrop core tone. */
  highlightMed: "#403d52",
  /** Strongest highlight: a card border when no rarity is set. */
  highlightHigh: "#524f67",
} as const;

/** Name of a palette colour in {@link color}. */
export type ColorName = keyof typeof color;

/** Translucent inks: `color.text` at reduced alpha, for hairlines, tracks and quiet numbers. */
export const ink = {
  /** `color.text` at 55%: inactive chips, image hairline frames, quiet numbers. */
  muted: "rgba(224, 222, 244, 0.55)",
  /** `color.text` at 25%: hairline dividers between rows. */
  hairline: "rgba(224, 222, 244, 0.25)",
  /** `color.text` at 14%: the empty part of a progress bar. */
  track: "rgba(224, 222, 244, 0.14)",
} as const;

/**
 * Font family stacks as satori `fontFamily` values. The names match the families
 * registered in `render.tsx`. Satori tries the listed families first, then every other
 * registered font in registration order, which is why Unifont is registered straight
 * after IBM VGA.
 */
export const font = {
  /** Everything: IBM VGA 8x16 (weight 700 is the 2x face), then Unifont for missing glyphs. */
  mono: '"IBM VGA 8x16", "Unifont", "Unifont Upper"',
  /** Card and banner titles only: Jacquard 24, then the mono stack. */
  display: '"Jacquard 24", "IBM VGA 8x16", "Unifont"',
} as const;

/**
 * Font sizes that land on each face's pixel grid, so glyph edges fall on whole pixels.
 * IBM VGA and Unifont are drawn on a 16px grid (crisp at 16 and 32). Jacquard 24's pixel
 * is 1/21.5 em, so it is exact at 43px (2px pixels) and 86px (4px pixels); 48px, the
 * obvious guess, leaves a third of its edge pixels anti-aliased.
 */
export const fontSize = {
  /** Body, keys, values, labels: IBM VGA at its native size. */
  body: 16,
  /** Big readouts: IBM VGA doubled. */
  large: 32,
  /** A card's title in Jacquard 24 (2px pixels). */
  title: 43,
  /** A banner title in Jacquard 24 (4px pixels). */
  display: 86,
} as const;

/**
 * Line height. The system uses 1.15; cards snap it to 1.125 so a 16px line is exactly
 * 18px and a 32px line 36px, which keeps every baseline on a whole pixel.
 */
export const lineHeight = 1.125;

/** Spacing scale in px (`space-1` ... `space-8` in tokens.json). */
export const space = {
  1: 4,
  2: 8,
  3: 12,
  4: 16,
  6: 24,
  8: 32,
} as const;

/** Border widths in px. */
export const border = {
  /** The window frame: two 2px pine lines with a 1px surface gap. */
  window: 5,
  /** One line of the window frame. */
  windowLine: 2,
  /** The gap between the two frame lines. */
  windowGap: 1,
  /** Stat hairlines, chips, progress tracks and image frames. */
  hairline: 1,
} as const;

/**
 * The still backdrop's dither (the system's blob tokens): one cell is 6x6 px, and the
 * field is dithered with a 4x4 Bayer matrix in three tones, base ground, overlay halo and
 * highlight-med core.
 */
export const blob = {
  /** One dither cell in px (`blob-cell`). */
  cell: 6,
  /** Largest blob radius in cells (`blob-radius-max`). */
  radiusMax: 24,
} as const;

/**
 * Hard title shadow: `shadow-title` is an 8px offset at 150px; cards scale it to whole
 * pixels of the Jacquard grid (2px at 43px, 4px at 86px).
 */
export const titleShadow = {
  /** Offset for a {@link fontSize.title} title. */
  title: 2,
  /** Offset for a {@link fontSize.display} title. */
  display: 4,
  /** Shadow colour: the base tone. */
  color: color.base,
} as const;
