import { randomInt, remapInternalHost } from "../util.ts";

/** A random saturated hue for titles/backgrounds. */
export function randomVibrant(): string {
  return `hsl(${randomInt(0, 360)}, 95%, 60%)`;
}

/** A random hue plus an offset partner, for two-tone gradient backgrounds. */
export function randomVibrantPair(): [string, string] {
  const hue = randomInt(0, 360);
  return [`hsl(${hue}, 90%, 62%)`, `hsl(${(hue + 45) % 360}, 90%, 52%)`];
}

/** Format a unix-seconds timestamp as a short date for rendered images. */
export function fmtDate(unixSec: number): string {
  return new Date(unixSec * 1000).toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

/**
 * Fetch an image (e.g. a Discord CDN avatar) and inline it as a base64 data
 * URI for satori. Callers must request PNG avatars — resvg cannot decode webp,
 * so use displayAvatarURL({ extension: "png", forceStatic: true }).
 */
export async function fetchImageDataUri(url: string): Promise<string | null> {
  try {
    const res = await fetch(remapInternalHost(url));
    if (!res.ok) return null;
    const bytes = Buffer.from(await res.arrayBuffer());
    const type = res.headers.get("content-type") ?? "image/png";
    return `data:${type};base64,${bytes.toString("base64")}`;
  } catch {
    return null;
  }
}
