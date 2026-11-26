import type { ReactNode } from "react";
import { border, color, font, fontSize, ink, lineHeight } from "./tokens.ts";
import { Text, toneColor, type Tone } from "./text.tsx";

/** Props for {@link KeyValue}. */
export interface KeyValueProps {
  /** The key, drawn uppercase in muted (`LEVEL`, `RANK`, `JOINED`). */
  label: string;
  /** The value: text, a number, or inline elements (keep them on one line). */
  value: ReactNode;
  /** Ink of the value (default `text`; `foam` for paths and readouts, `gold` for the one that matters). */
  tone?: Tone;
  /** Ink of the key (default `muted`). */
  labelTone?: Tone;
  /** Grow to share a row with other KeyValues (two columns: put two in a row box with `grow`). */
  grow?: boolean;
}

/**
 * One character-sheet row: key on the left in muted uppercase, value on the right.
 * The haiiro KeyValueSheet / stat row (`.kvr` in the mockups).
 *
 * @param props - {@link KeyValueProps}
 */
export function KeyValue(props: KeyValueProps) {
  const value =
    typeof props.value === "string" || typeof props.value === "number" ? (
      <Text tone={props.tone ?? "text"}>{props.value}</Text>
    ) : (
      props.value
    );
  return (
    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        alignItems: "flex-start",
        gap: 16,
        flexGrow: props.grow ? 1 : 0,
        flexBasis: props.grow ? 0 : "auto",
      }}
    >
      <Text tone={props.labelTone ?? "muted"} upper>
        {props.label}
      </Text>
      {value}
    </div>
  );
}

/** Props for {@link ProgressBar}. */
export interface ProgressBarProps {
  /** Current value. Clamped to `0..max`. */
  value: number;
  /** Value at a full bar (default 100). */
  max?: number;
  /** Outer width in px (default: stretch to the parent). A px width gives a whole-pixel fill. */
  width?: number;
  /** Outer height in px including the hairline (default 10). */
  height?: number;
  /** Fill ink (default `text`). */
  tone?: Tone;
}

/**
 * A progress bar: 1px `color-text` hairline track over `ink-track`, flat fill, square.
 * Put a {@link KeyValue} above it for the label and numbers.
 *
 * @param props - {@link ProgressBarProps}
 */
export function ProgressBar(props: ProgressBarProps) {
  const max = props.max && props.max > 0 ? props.max : 100;
  const ratio = Math.min(1, Math.max(0, props.value / max));
  const height = props.height ?? 10;
  const fill =
    props.width !== undefined
      ? Math.round((props.width - 2 * border.hairline) * ratio)
      : `${Math.round(ratio * 1000) / 10}%`;
  return (
    <div
      style={{
        display: "flex",
        width: props.width ?? "100%",
        height,
        border: `${border.hairline}px solid ${color.text}`,
        backgroundColor: ink.track,
      }}
    >
      <div style={{ display: "flex", width: fill, height: "100%", backgroundColor: toneColor(props.tone ?? "text") }} />
    </div>
  );
}

/** Props for {@link Chip}. */
export interface ChipProps {
  /** Chip text, lowercase (`admin`, `go club`, `tv`). */
  children: string;
  /**
   * On (default): solid `color-text` hairline, text ink, a check mark in front.
   * Off: dashed `ink-muted` hairline and ink, for inactive or coming-soon things.
   */
  active?: boolean;
}

/**
 * A chip: hairline box around one short word with a check mark, for an on/off state (use {@link Tag} for a plain label). Lay several out in a row box with a gap.
 *
 * @param props - {@link ChipProps}
 */
export function Chip(props: ChipProps) {
  const on = props.active !== false;
  return (
    <div
      style={{
        display: "flex",
        paddingLeft: 7,
        paddingRight: 7,
        border: `${border.hairline}px ${on ? "solid" : "dashed"} ${on ? color.text : ink.muted}`,
        fontFamily: font.mono,
        fontSize: fontSize.body,
        lineHeight,
        color: on ? color.text : ink.muted,
        whiteSpace: "nowrap",
      }}
    >
      {on ? `✓ ${props.children}` : props.children}
    </div>
  );
}

/** Props for {@link Tag}. */
export interface TagProps {
  /** Tag text, lowercase (`tv`, `go club`, `comedy`). */
  children: string;
}

/**
 * A plain tag: the same hairline box and size as {@link Chip} but without the check mark,
 * for labels that are not an on/off state (genres, formats, club names).
 *
 * @param props - {@link TagProps}
 */
export function Tag(props: TagProps) {
  return (
    <div
      style={{
        display: "flex",
        paddingLeft: 7,
        paddingRight: 7,
        border: `${border.hairline}px solid ${color.text}`,
        fontFamily: font.mono,
        fontSize: fontSize.body,
        lineHeight,
        color: color.text,
        whiteSpace: "nowrap",
      }}
    >
      {props.children}
    </div>
  );
}

/**
 * Rank colour job: 1 gold, 2 foam, 3 iris, then muted.
 *
 * @param rank - 1-based rank.
 * @returns The tone for that rank.
 */
export function rankTone(rank: number): Tone {
  if (rank === 1) return "gold";
  if (rank === 2) return "foam";
  if (rank === 3) return "iris";
  return "muted";
}

/** Props for {@link RankMark}. */
export interface RankMarkProps {
  /** 1-based rank. */
  rank: number;
  /** Mark the viewer's own row with the rose `»` arrow in front of the number. */
  current?: boolean;
  /** Box width in px, right-aligned (default 32: four cells, room for `»100`). */
  width?: number;
}

/**
 * A rank number in its colour job (see {@link rankTone}), right-aligned in a fixed box so
 * a column of ranks lines up. The current row gets a `»` (rose) in front; give that row
 * an `overlay` background.
 *
 * @param props - {@link RankMarkProps}
 */
export function RankMark(props: RankMarkProps) {
  return (
    <div style={{ display: "flex", justifyContent: "flex-end", width: props.width ?? 32, flexShrink: 0 }}>
      {props.current ? <Text tone="rose">»</Text> : null}
      <Text tone={rankTone(props.rank)}>{String(props.rank)}</Text>
    </div>
  );
}
