import type { ReactNode } from "react";
import { border, color, font, fontSize, lineHeight } from "./tokens.ts";
import { cleanText, toneColor, type Tone } from "./text.tsx";

/** Frame colours a card may take: pine by default, the window variants for states. */
export type FrameTone = "pine" | "love" | "gold" | "foam" | "highlightHigh";

/** Props for {@link Notch}. */
export interface NotchProps {
  /** The label, written like a prompt: `profile: ~/mei`. */
  children: string;
  /** Ink of the label (default `foam`). */
  tone?: Tone;
  /** Left offset from the frame's outer edge in px (default 20, as on the web Window). */
  left?: number;
}

/**
 * The label notch cut into the top edge of a {@link CardFrame}: surface-filled, one
 * character of padding each side, centred on the frame line. It is absolutely
 * positioned, so it must be a child of a positioned box whose top edge is the frame
 * (CardFrame places it for you).
 *
 * @param props - {@link NotchProps}
 */
export function Notch(props: NotchProps) {
  const line = Math.round(fontSize.body * lineHeight);
  return (
    <div
      style={{
        display: "flex",
        position: "absolute",
        // The outer frame line is the positioning edge; centre the label line on the
        // 5px frame (CSS: top 0 + translateY(-50%) on the padding edge).
        top: border.window - border.windowLine - Math.round(line / 2),
        left: (props.left ?? 20) - border.windowLine,
        paddingLeft: 8,
        paddingRight: 8,
        backgroundColor: color.surface,
        fontFamily: font.mono,
        fontSize: fontSize.body,
        lineHeight,
        color: toneColor(props.tone ?? "foam"),
        whiteSpace: "nowrap",
      }}
    >
      {cleanText(props.children)}
    </div>
  );
}

/** Props for {@link CardFrame}. */
export interface CardFrameProps {
  /** Notch label, written like a prompt: `profile: ~/mei`. Omit for no notch. */
  label?: string;
  /** Ink of the notch label (default `foam`). */
  labelTone?: Tone;
  /** Frame colour (default `pine`). */
  frame?: FrameTone;
  /** Outer width in px or percent (default: stretch to the parent). */
  width?: number | string;
  /** Outer height in px or percent (default: fit the content). */
  height?: number | string;
  /** Grow to fill the parent's main axis. */
  grow?: boolean;
  /** Direction of the content (default `column`). */
  direction?: "row" | "column";
  /** Gap between content children in px (default 12). */
  gap?: number;
  /**
   * Content padding inside the inner frame line, in px: `[top, x, bottom]`
   * (default `[24, 20, 16]`; the top leaves room under the notch).
   */
  padding?: [number, number, number];
  /** Card content. */
  children: ReactNode;
}

/**
 * The haiiro window as a static card: a 5px double frame built from nested boxes (satori
 * has no `double` border): outer 2px line, 1px surface gap, inner 2px line, then the
 * surface fill. Square corners, no shadow. The notch label is cut into the top edge.
 *
 * Leave at least 8px of room above the card (a {@link StillBackdrop} padding does this):
 * the notch sticks out above the frame by half a line.
 *
 * @param props - {@link CardFrameProps}
 */
export function CardFrame(props: CardFrameProps) {
  const line = color[props.frame ?? "pine"];
  const [pt, px, pb] = props.padding ?? [24, 20, 16];
  return (
    <div
      style={{
        display: "flex",
        position: "relative",
        // Satori chokes on undefined style values, so only set sizes that were given.
        ...(props.width !== undefined ? { width: props.width } : {}),
        ...(props.height !== undefined ? { height: props.height } : {}),
        flexGrow: props.grow ? 1 : 0,
        flexShrink: 0,
        border: `${border.windowLine}px solid ${line}`,
        padding: border.windowGap,
        backgroundColor: color.surface,
      }}
    >
      <div
        style={{
          display: "flex",
          flexDirection: props.direction ?? "column",
          flexGrow: 1,
          gap: props.gap ?? 12,
          border: `${border.windowLine}px solid ${line}`,
          paddingTop: pt,
          paddingLeft: px,
          paddingRight: px,
          paddingBottom: pb,
          backgroundColor: color.surface,
          minWidth: 0,
        }}
      >
        {props.children}
      </div>
      {props.label ? <Notch tone={props.labelTone ?? "foam"}>{props.label}</Notch> : null}
    </div>
  );
}
