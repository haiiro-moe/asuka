import satori, { type SatoriOptions } from "satori";
import { Resvg } from "@resvg/resvg-js";
import type { ReactNode } from "react";

type SatoriFont = SatoriOptions["fonts"][number];

// Real Comic Sans is proprietary: use it when the host OS ships it, otherwise
// fall back to the bundled open-licensed Comic Neue (SIL OFL).
const SYSTEM_COMIC = "/System/Library/Fonts/Supplemental/Comic Sans MS.ttf";
const SYSTEM_COMIC_BOLD = "/System/Library/Fonts/Supplemental/Comic Sans MS Bold.ttf";

async function readFont(path: string | URL): Promise<ArrayBuffer | null> {
  try {
    const file = Bun.file(path);
    if (!(await file.exists())) return null;
    return await file.arrayBuffer();
  } catch {
    return null;
  }
}

async function loadFontsOnce(): Promise<SatoriFont[]> {
  const [sysRegular, sysBold, neueRegular, neueBold, bangers, roboto, robotoMedium, robotoBold] =
    await Promise.all([
      readFont(SYSTEM_COMIC),
      readFont(SYSTEM_COMIC_BOLD),
      readFont(new URL("./fonts/ComicNeue-Regular.ttf", import.meta.url)),
      readFont(new URL("./fonts/ComicNeue-Bold.ttf", import.meta.url)),
      readFont(new URL("./fonts/Bangers-Regular.ttf", import.meta.url)),
      readFont(new URL("./fonts/Roboto-Regular.ttf", import.meta.url)),
      readFont(new URL("./fonts/Roboto-Medium.ttf", import.meta.url)),
      readFont(new URL("./fonts/Roboto-Bold.ttf", import.meta.url)),
    ]);

  const regular = sysRegular ?? neueRegular;
  const bold = sysBold ?? neueBold ?? regular;
  if (!regular) throw new Error("no comic font available (system or bundled)");

  const fonts: SatoriFont[] = [
    { name: "Comic", data: regular, weight: 400, style: "normal" },
    { name: "Comic", data: bold!, weight: 700, style: "normal" },
  ];
  if (bangers) fonts.push({ name: "Bangers", data: bangers, weight: 400, style: "normal" });
  // Roboto (AniList's site font) powers the AniList-style cards.
  if (roboto) fonts.push({ name: "Roboto", data: roboto, weight: 400, style: "normal" });
  if (robotoMedium) fonts.push({ name: "Roboto", data: robotoMedium, weight: 500, style: "normal" });
  if (robotoBold) fonts.push({ name: "Roboto", data: robotoBold, weight: 700, style: "normal" });
  return fonts;
}

// Plugin modules are evaluated before initDb()/login, so font loading must stay
// lazy — first render pays the cost, later renders reuse the cache.
let fontsPromise: Promise<SatoriFont[]> | null = null;

/** Render a satori-compatible React tree to a transparent PNG buffer. */
export async function renderPng(
  node: ReactNode,
  opts: { width: number; height: number },
): Promise<Buffer> {
  const fonts = await (fontsPromise ??= loadFontsOnce());
  const svg = await satori(node, { width: opts.width, height: opts.height, fonts });
  // 2x supersample keeps text crisp on Discord's scaled-down inline preview.
  const png = new Resvg(svg, {
    fitTo: { mode: "width", value: opts.width * 2 },
  })
    .render()
    .asPng();
  return Buffer.from(png);
}

/**
 * renderPng that never throws: any satori/resvg/font failure logs and returns
 * null so call sites can fall back to their text-only Components V2 payload.
 */
export async function tryRenderPng(
  node: ReactNode,
  opts: { width: number; height: number },
): Promise<Buffer | null> {
  try {
    return await renderPng(node, opts);
  } catch (err) {
    console.error("[images] render failed:", err);
    return null;
  }
}
