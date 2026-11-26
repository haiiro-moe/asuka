import type { CSSProperties, ReactNode } from "react";
import { color, font, fontSize, ink, lineHeight, type ColorName } from "./tokens.ts";

/**
 * A colour a primitive may use for text or lines: a palette colour by name, or one of the
 * translucent inks. Primitives take a `Tone` instead of a CSS colour so no raw colour
 * value ever reaches a card.
 */
export type Tone = ColorName | "inkMuted" | "inkHairline";

/**
 * Resolve a {@link Tone} to its CSS colour.
 *
 * @param tone - Palette name or ink name.
 * @returns The CSS colour from the tokens.
 */
export function toneColor(tone: Tone): string {
  if (tone === "inkMuted") return ink.muted;
  if (tone === "inkHairline") return ink.hairline;
  return color[tone];
}

/**
 * Strip what the card fonts cannot draw and the system does not use: emoji and
 * pictographs, variation selectors and joiners. Everything else stays, since Unifont
 * covers accents, arrows, CJK and Hangul on the same pixel grid as IBM VGA.
 * Whitespace runs collapse to one space.
 *
 * @param input - Raw user text (a display name, a title).
 * @returns Text safe to hand to satori.
 */
export function cleanText(input: string): string {
  return input
    .replace(/[\p{Extended_Pictographic}\u{FE0E}\u{FE0F}\u{200D}\u{20E3}]/gu, "")
    .replace(/[\u{1F1E6}-\u{1F1FF}\u{1F3FB}-\u{1F3FF}]/gu, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Props for {@link Text}. */
export interface TextProps {
  /** The text. */
  children: ReactNode;
  /** Ink (default `text`). Muted and pine are 3.4:1, so use them for labels or 32px only. */
  tone?: Tone;
  /** `body` 16px (default) or `large` 32px: the two sizes IBM VGA is crisp at. */
  size?: "body" | "large";
  /** Use the 2x face (weight 700). It is twice as wide as the regular face. */
  bold?: boolean;
  /** Uppercase, for keys and labels. No letter-spacing: any tracking blurs the glyphs. */
  upper?: boolean;
  /** Keep on one line and cut with an ellipsis when it overflows. */
  truncate?: boolean;
  /** Extra layout style (flex, width, alignment). Do not pass colours or fonts here. */
  style?: CSSProperties;
}

/**
 * A run of IBM VGA text in one tone, at a pixel-grid size.
 *
 * @param props - {@link TextProps}
 */
export function Text(props: TextProps) {
  return (
    <span
      style={{
        fontFamily: font.mono,
        fontSize: props.size === "large" ? fontSize.large : fontSize.body,
        fontWeight: props.bold ? 700 : 400,
        lineHeight,
        color: toneColor(props.tone ?? "text"),
        textTransform: props.upper ? "uppercase" : "none",
        ...(props.truncate
          ? { overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis" }
          : {}),
        ...props.style,
      }}
    >
      {props.children}
    </span>
  );
}

/** Props for {@link Rule}. */
export interface RuleProps {
  /** Space above and below the line in px (default 8). */
  gap?: number;
}

/**
 * A 1px `ink-hairline` divider across the full width, as between a card's sections.
 *
 * @param props - {@link RuleProps}
 */
export function Rule(props: RuleProps) {
  const gap = props.gap ?? 8;
  return (
    <div
      style={{
        display: "flex",
        width: "100%",
        height: 1,
        marginTop: gap,
        marginBottom: gap,
        backgroundColor: ink.hairline,
      }}
    />
  );
}
