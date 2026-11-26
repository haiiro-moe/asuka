import satori, { type SatoriOptions } from "satori";
import { Resvg } from "@resvg/resvg-js";
import type { ReactNode } from "react";

/**
 * Card rendering: a satori-compatible React tree becomes an SVG (satori), then a PNG (resvg).
 *
 * ## Fonts
 *
 * The haiiro faces live in `./fonts/` as TTF/OTF (satori cannot read WOFF2):
 *
 * - `IBM VGA 8x16`, weight 400 (`IBMVGA8x16-Regular.ttf`) and weight 700, the double-width
 *   2x face (`IBMVGA8x16-Bold.ttf`). Adapted from The Ultimate Oldschool PC Font Pack by
 *   VileR (int10h.org), CC BY-SA 4.0, see `LICENSE-IBMVGA8x16-CC-BY-SA-4.0.txt`.
 * - `Unifont` and `Unifont Upper` (GNU Unifont 18.0.01, OFL 1.1 or GPL 2+ with the font
 *   embedding exception, see `OFL-Unifont.txt` and `LICENSE-Unifont.txt`): fallbacks for
 *   every glyph IBM VGA lacks (accents beyond CP437, arrows, CJK) on the same 8x16 grid.
 * - `Jacquard 24` (OFL 1.1, see `OFL-Jacquard24.txt`): card and banner titles only.
 *
 * Satori resolves a glyph through the `fontFamily` list first and then through every other
 * registered font in registration order, so Unifont is registered right after IBM VGA and
 * before anything else.
 *
 * ## Crispness
 *
 * Bitmap faces blur as soon as a glyph edge lands between pixels. What was measured (count
 * of anti-aliased pixels in rendered text, resvg 2.6 / satori 0.26):
 *
 * - Satori rounds every text and box position to whole pixels, so fractional padding or a
 *   1.15 line height never shifts a glyph off the grid.
 * - The size decides it. IBM VGA and Unifont have no anti-aliased pixels at 16px and 32px
 *   but plenty at 15, 18, 20 or 24px; `letter-spacing: 0.06em` at 16px (0.96px) also blurs.
 *   Jacquard 24's pixel is 1/21.5 em: it is exact at 43px and 86px only (48px leaves about
 *   a third of its edge pixels grey). The sizes live in `fontSize` in
 *   `components/haiiro/tokens.ts`.
 * - resvg's `shapeRendering: 1` (crispEdges) turns anti-aliasing off for every path
 *   (satori emits text as paths, so this covers glyphs too). It is the safety net for an
 *   off-grid size or a stray fraction: edges stay hard instead of grey. It does not touch
 *   raster images, which use `imageRendering: 0` (smooth) because avatars and cover art are
 *   full-colour content scaled down.
 * - `textRendering` has no effect: satori never emits `<text>`.
 *
 * Chosen: grid sizes from the tokens, crispEdges, and a 1x render by default. The old 2x
 * supersample is gone; an integer `scale` stays available and keeps pixels square.
 *
 * @packageDocumentation
 */

type SatoriFont = SatoriOptions["fonts"][number];

async function readFont(path: string | URL): Promise<ArrayBuffer | null> {
  try {
    const file = Bun.file(path);
    if (!(await file.exists())) return null;
    return await file.arrayBuffer();
  } catch {
    return null;
  }
}

const bundled = (name: string) => readFont(new URL(`./fonts/${name}`, import.meta.url));

async function loadFontsOnce(): Promise<SatoriFont[]> {
  const [vga, vgaBold, unifont, unifontUpper, jacquard] = await Promise.all([
    bundled("IBMVGA8x16-Regular.ttf"),
    bundled("IBMVGA8x16-Bold.ttf"),
    bundled("Unifont.otf"),
    bundled("UnifontUpper.otf"),
    bundled("Jacquard24-Regular.ttf"),
  ]);

  if (!vga) throw new Error("IBM VGA 8x16 font missing from src/core/images/fonts");

  // Order matters: satori falls back through registered fonts in this order.
  const fonts: SatoriFont[] = [
    { name: "IBM VGA 8x16", data: vga, weight: 400, style: "normal" },
    { name: "IBM VGA 8x16", data: vgaBold ?? vga, weight: 700, style: "normal" },
  ];
  if (unifont) fonts.push({ name: "Unifont", data: unifont, weight: 400, style: "normal" });
  if (unifontUpper) {
    fonts.push({ name: "Unifont Upper", data: unifontUpper, weight: 400, style: "normal" });
  }
  if (jacquard) fonts.push({ name: "Jacquard 24", data: jacquard, weight: 400, style: "normal" });
  return fonts;
}

// Plugin modules are evaluated before initDb()/login, so font loading must stay
// lazy: the first render pays the cost (about 2s, mostly parsing Unifont), later
// renders reuse the same array, which also lets satori reuse its parsed fonts.
let fontsPromise: Promise<SatoriFont[]> | null = null;

/** Size and scale of a rendered card. */
export interface RenderOptions {
  /** Layout width in px. Use whole numbers. */
  width: number;
  /** Layout height in px. Use whole numbers. */
  height: number;
  /**
   * Whole-number zoom applied by resvg after layout (default 1). Non-integer values are
   * rounded, since a fractional zoom would put bitmap pixels between device pixels.
   */
  scale?: number;
}

/**
 * Render a satori-compatible React tree to a PNG buffer at 1x (or an integer `scale`).
 * Paths are drawn without anti-aliasing (crispEdges) so bitmap type stays sharp; raster
 * images are scaled smoothly. Throws on font, layout or raster failure.
 *
 * @param node - Root element. Satori supports flexbox only (no grid, no `double` borders).
 * @param opts - Layout size and optional integer scale.
 * @returns The PNG bytes.
 */
export async function renderPng(node: ReactNode, opts: RenderOptions): Promise<Buffer> {
  const fonts = await (fontsPromise ??= loadFontsOnce());
  const width = Math.round(opts.width);
  const height = Math.round(opts.height);
  const scale = Math.max(1, Math.round(opts.scale ?? 1));
  const svg = await satori(node, { width, height, fonts });
  const png = new Resvg(svg, {
    fitTo: scale === 1 ? { mode: "original" } : { mode: "zoom", value: scale },
    shapeRendering: 1,
    imageRendering: 0,
    font: { loadSystemFonts: false },
  })
    .render()
    .asPng();
  return Buffer.from(png);
}

/**
 * {@link renderPng} that never throws: any satori/resvg/font failure logs and returns
 * null so call sites can fall back to their text-only Components V2 payload.
 *
 * @param node - Root element.
 * @param opts - Layout size and optional integer scale.
 * @returns The PNG bytes, or null on failure.
 */
export async function tryRenderPng(
  node: ReactNode,
  opts: RenderOptions,
): Promise<Buffer | null> {
  try {
    return await renderPng(node, opts);
  } catch (err) {
    console.error("[images] render failed:", err);
    return null;
  }
}
