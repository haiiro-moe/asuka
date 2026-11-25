import type { CSSProperties } from "react";

/**
 * Bold comic text with a black outline. Satori's WebkitTextStroke draws the
 * stroke centered on the glyph edge, so we layer a stroke-only copy behind a
 * clean fill copy to keep the fill fully readable.
 */
export function OutlinedText(props: {
  children: string;
  size: number;
  color: string;
  family?: "Comic" | "Bangers";
  stroke?: number;
  align?: "left" | "center";
}) {
  const stroke = props.stroke ?? Math.max(3, Math.round(props.size / 9));
  const base: CSSProperties = {
    fontFamily: props.family ?? "Comic",
    fontWeight: 700,
    fontSize: props.size,
    lineHeight: 1.15,
    whiteSpace: "pre-wrap",
  };
  return (
    <div
      style={{
        display: "flex",
        position: "relative",
        justifyContent: props.align === "center" ? "center" : "flex-start",
      }}
    >
      <span
        style={{
          ...base,
          position: "absolute",
          left: 0,
          top: 0,
          width: "100%",
          justifyContent: props.align === "center" ? "center" : "flex-start",
          color: "#000",
          WebkitTextStrokeWidth: `${stroke}px`,
          WebkitTextStrokeColor: "#000",
        }}
      >
        {props.children}
      </span>
      <span style={{ ...base, color: props.color }}>{props.children}</span>
    </div>
  );
}

/**
 * Strip glyphs satori can't render with our bundled fonts: emoji/pictographs,
 * plus CJK/Hangul (Comic/Roboto/Bangers ship no such glyphs, so they'd render
 * as tofu boxes) — e.g. an AniList character's native-script name.
 */
export function sanitizeText(input: string): string {
  return input
    .replace(/[\p{Extended_Pictographic}️‍]/gu, "")
    .replace(/[　-ヿ㐀-䶿一-鿿가-힣豈-﫿]/gu, "")
    .replace(/\s+/g, " ")
    .trim();
}
