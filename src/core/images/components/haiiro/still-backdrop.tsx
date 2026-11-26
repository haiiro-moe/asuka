import type { ReactNode } from "react";
import { blob, color } from "./tokens.ts";
import { svgDataUri } from "./image-frame.tsx";

/** 4x4 Bayer matrix, the ordered-dither thresholds the live Blobs background uses. */
const BAYER4 = [
  [0, 8, 2, 10],
  [12, 4, 14, 6],
  [3, 11, 1, 9],
  [15, 7, 13, 5],
] as const;

/** Small deterministic PRNG (mulberry32), so a seed always draws the same field. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Field level where the overlay halo starts (the blob edge sits at 1.0). */
const HALO = 0.55;
/** Field level where the highlight-med core starts. */
const CORE = 1.7;
/** Width of the dithered band around each threshold, as a fraction of the threshold. */
const BAND = 0.5;

/**
 * Build the still backdrop as an SVG data URI: one frozen frame of the haiiro Blobs
 * background. Metaballs (field r^2 / (d^2 + 0.01) summed within 3r, as in the live
 * background) on a grid of 6px cells, ordered-dithered with a 4x4 Bayer matrix into three
 * tones: base ground, overlay halo, highlight-med core. Each tone is one SVG path of
 * horizontal runs in cell units, scaled up by the viewBox, so a 900x500 card costs a few
 * kilobytes and no image is decoded.
 *
 * @param width - Field width in px; rounded up to whole cells.
 * @param height - Field height in px; rounded up to whole cells.
 * @param seed - PRNG seed; the same seed and size draw the same field.
 * @returns The data URI and its pixel size (whole cells, at least `width` x `height`).
 */
export function stillBackdropDataUri(
  width: number,
  height: number,
  seed = 7,
): { uri: string; width: number; height: number } {
  const cw = Math.max(1, Math.ceil(width / blob.cell));
  const ch = Math.max(1, Math.ceil(height / blob.cell));
  const rand = mulberry32(seed);

  // Blob count follows the live background's density (cells / 700, clamped to 6..60).
  const count = Math.min(60, Math.max(6, Math.round((cw * ch) / 700)));
  const blobs = Array.from({ length: count }, () => ({
    x: rand() * cw,
    y: rand() * ch,
    r: 4 + rand() * Math.min(blob.radiusMax - 4, Math.max(4, Math.min(cw, ch) / 4)),
  }));

  const tones = new Uint8Array(cw * ch);
  for (let y = 0; y < ch; y++) {
    for (let x = 0; x < cw; x++) {
      let f = 0;
      for (const b of blobs) {
        const dx = x + 0.5 - b.x;
        const dy = y + 0.5 - b.y;
        const d2 = dx * dx + dy * dy;
        if (d2 < 9 * b.r * b.r) f += (b.r * b.r) / (d2 + 0.01);
      }
      const t = (BAYER4[y & 3]![x & 3]! + 0.5) / 16 - 0.5; // -0.47..0.47
      const tone = f > CORE * (1 + t * BAND) ? 2 : f > HALO * (1 + t * BAND) ? 1 : 0;
      tones[y * cw + x] = tone;
    }
  }

  // Runs per row: the halo path covers halo and core cells, the core path is drawn on top.
  const runs = (min: number): string => {
    let d = "";
    for (let y = 0; y < ch; y++) {
      let x = 0;
      while (x < cw) {
        if (tones[y * cw + x]! < min) {
          x++;
          continue;
        }
        const start = x;
        while (x < cw && tones[y * cw + x]! >= min) x++;
        d += `M${start} ${y}h${x - start}v1h-${x - start}z`;
      }
    }
    return d;
  };

  const pw = cw * blob.cell;
  const ph = ch * blob.cell;
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${pw}" height="${ph}" viewBox="0 0 ${cw} ${ch}" shape-rendering="crispEdges">` +
    `<rect width="${cw}" height="${ch}" fill="${color.base}"/>` +
    `<path fill="${color.overlay}" d="${runs(1)}"/>` +
    `<path fill="${color.highlightMed}" d="${runs(2)}"/>` +
    `</svg>`;
  return { uri: svgDataUri(svg), width: pw, height: ph };
}

/** Props for {@link StillBackdrop}. */
export interface StillBackdropProps {
  /** Card width in px (the render width). */
  width: number;
  /** Card height in px (the render height). */
  height: number;
  /** Space between the image edge and the content in px (default 32). Keep 8px or more above a CardFrame for its notch. */
  padding?: number;
  /** PRNG seed for the field (default 7). Vary it per card type if two cards sit side by side. */
  seed?: number;
  /** Direction of the content (default `column`). */
  direction?: "row" | "column";
  /** Gap between content children in px (default 24). */
  gap?: number;
  /** The card content, usually one CardFrame. */
  children?: ReactNode;
}

/**
 * The page behind a card: the haiiro Blobs background as one still, dithered frame,
 * filling the whole image, with the content laid over it. Use it as the root element
 * of every card so the image is opaque base, never transparent.
 *
 * @param props - {@link StillBackdropProps}
 */
export function StillBackdrop(props: StillBackdropProps) {
  const field = stillBackdropDataUri(props.width, props.height, props.seed);
  const pad = props.padding ?? 32;
  return (
    <div
      style={{
        display: "flex",
        position: "relative",
        width: props.width,
        height: props.height,
        overflow: "hidden",
        backgroundColor: color.base,
      }}
    >
      <img
        src={field.uri}
        width={field.width}
        height={field.height}
        style={{ position: "absolute", top: 0, left: 0, width: field.width, height: field.height }}
      />
      <div
        style={{
          display: "flex",
          flexDirection: props.direction ?? "column",
          gap: props.gap ?? 24,
          width: "100%",
          height: "100%",
          padding: pad,
        }}
      >
        {props.children}
      </div>
    </div>
  );
}
