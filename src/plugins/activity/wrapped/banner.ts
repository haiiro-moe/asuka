/**
 * The haiiro title banner (`wrapped <year>`) that the sign-up message and the
 * Wrapped DM carry above their catalog text. It is the only haiiro-styled part
 * of those messages; Discord draws the rest.
 *
 * @packageDocumentation
 */
import { AttachmentBuilder } from "discord.js";
import { attachmentImage } from "../../../core/components.ts";
import { renderTitleBannerPng } from "../../../core/images/index.tsx";
import type { renderBotMessage } from "../../../core/messages.ts";

/** File name of the banner attachment. */
export const WRAPPED_BANNER_NAME = "wrapped-banner.png";

/** A rendered catalog message, as {@link renderBotMessage} returns it. */
type Rendered = Awaited<ReturnType<typeof renderBotMessage>>;

/** Rendered banners by year. A DM run sends hundreds of DMs, so the PNG is drawn once. */
const cache = new Map<number, Promise<Buffer | null>>();

/**
 * The banner PNG for a year, drawn once per process.
 *
 * @param year - The Wrapped year.
 * @returns The PNG, or null when rendering failed (the next call tries again).
 */
export function wrappedBannerPng(year: number): Promise<Buffer | null> {
  let png = cache.get(year);
  if (!png) {
    png = renderTitleBannerPng(`wrapped ${year}`).then((buffer) => {
      if (!buffer) cache.delete(year);
      return buffer;
    });
    cache.set(year, png);
  }
  return png;
}

/**
 * Add the banner above a rendered catalog message: the image goes first in
 * the first container (or first in the message when there is no container),
 * and the PNG rides in `files`. When the banner cannot be rendered the
 * message is returned text-only, unchanged.
 *
 * @param payload - The rendered message.
 * @param year - The Wrapped year shown on the banner.
 * @returns The payload with the banner, ready to send.
 */
export async function withWrappedBanner(
  payload: Rendered,
  year: number,
): Promise<Rendered & { files?: AttachmentBuilder[] }> {
  const png = await wrappedBannerPng(year);
  if (!png) return payload;
  const gallery = attachmentImage(WRAPPED_BANNER_NAME).toJSON();
  const components = structuredClone(payload.components) as unknown[];
  const first = components[0] as { type?: number; components?: unknown[] } | undefined;
  if (first?.type === 17 && Array.isArray(first.components)) first.components.unshift(gallery);
  else components.unshift(gallery);
  return {
    ...payload,
    components: components as Rendered["components"],
    files: [new AttachmentBuilder(png, { name: WRAPPED_BANNER_NAME })],
  };
}
