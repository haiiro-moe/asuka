import { font, fontSize, lineHeight, titleShadow } from "./tokens.ts";
import { cleanText, toneColor, type Tone } from "./text.tsx";

/** Props for {@link Title}. */
export interface TitleProps {
  /** The title: one or a few lowercase words. */
  children: string;
  /** `title` 43px for a card (default) or `display` 86px for a banner: Jacquard 24's two crisp sizes. */
  size?: "title" | "display";
  /** Ink (default `text`). */
  tone?: Tone;
  /** Draw the hard base-colour offset shadow (`shadow-title`, scaled to the size). Default true. */
  shadow?: boolean;
  /** Keep on one line, cutting with an ellipsis. */
  truncate?: boolean;
}

/**
 * Pick the title face for a text: Jacquard 24 only covers basic Latin, so a name with any
 * other glyph (CJK, accents like `ő`) is set in IBM VGA instead of switching face mid-word.
 *
 * @param text - The title text.
 * @returns `"display"` (Jacquard 24) when every character is printable ASCII, else `"mono"`.
 */
export function titleFont(text: string): "display" | "mono" {
  return /^[\x20-\x7e]*$/.test(text) ? "display" : "mono";
}

/**
 * A card title in Jacquard 24, the system's display face: only for the one title of a
 * card or banner, never for labels or body. Sizes sit on the face's pixel grid (43px,
 * 86px) so it renders without grey edges. The shadow is a hard offset in base, no blur.
 *
 * @param props - {@link TitleProps}
 */
export function Title(props: TitleProps) {
  const display = props.size === "display";
  const offset = display ? titleShadow.display : titleShadow.title;
  const text = cleanText(props.children);
  const mono = titleFont(text) === "mono";
  const lineH = Math.round((display ? fontSize.display : fontSize.title) * lineHeight);
  return (
    <span
      style={{
        fontFamily: mono ? font.mono : font.display,
        fontSize: mono ? (display ? 64 : fontSize.large) : display ? fontSize.display : fontSize.title,
        lineHeight: `${lineH}px`,
        color: toneColor(props.tone ?? "text"),
        textShadow: props.shadow === false ? "none" : `${offset}px ${offset}px 0px ${titleShadow.color}`,
        ...(props.truncate
          ? { overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis" }
          : {}),
      }}
    >
      {text}
    </span>
  );
}
