import { remapInternalHost } from "../util.ts";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/**
 * Format a unix-seconds timestamp as a short date for rendered images, in the haiiro
 * style: day, short month, year (`4 Nov 2026`), in the server's local time zone.
 *
 * @param unixSec - Seconds since the Unix epoch.
 * @returns The formatted date.
 */
export function fmtDate(unixSec: number): string {
  const d = new Date(unixSec * 1000);
  return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

/**
 * Fetch an image (e.g. a Discord CDN avatar) and inline it as a base64 data
 * URI for satori. Callers must request PNG or JPEG: resvg cannot decode webp,
 * so use displayAvatarURL({ extension: "png", forceStatic: true }).
 *
 * @param url - Image URL; internal hosts are remapped first.
 * @returns A `data:` URI, or null when the fetch fails.
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
