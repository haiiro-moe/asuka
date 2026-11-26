/**
 * The Wrapped DM: the catalog message `wrapped.dm` with the member's link
 * button and the title banner.
 *
 * Who gets one is decided by the run (only opted-in members) or by an admin
 * resending to one member; this module only sends.
 *
 * @packageDocumentation
 */
import type { Client } from "discord.js";
import { messageCtx, renderBotMessage } from "../../../core/messages.ts";
import { withWrappedBanner } from "./banner.ts";

/** Discord's "Cannot send messages to this user" error: the member's DMs are closed. */
export const DISCORD_CANNOT_DM = 50007;

/**
 * The Wrapped DM payload for one member.
 *
 * @param client - The bot client (for `{{variables}}` in an edited template).
 * @param url - The member's link, `linkUrl(token)`.
 * @param year - The Wrapped year.
 * @returns A Components V2 payload with the banner when it renders.
 */
export async function wrappedDmPayload(client: Client, url: string, year: number) {
  const rendered = await renderBotMessage("wrapped.dm", messageCtx(client), { year, url });
  return withWrappedBanner(rendered, year);
}

/**
 * DM a member their Wrapped link.
 *
 * A failure sends nothing else: closed DMs (Discord error
 * {@link DISCORD_CANNOT_DM}), an unknown user or any other error is reported
 * as `failed` and logged, and the member can still open their link with
 * `/wrapped me`.
 *
 * @param client - The bot client.
 * @param userId - The member.
 * @param url - The member's link, `linkUrl(token)`.
 * @param year - The Wrapped year.
 * @returns `sent` when Discord accepted the DM, otherwise `failed`.
 */
export async function sendWrappedDm(client: Client, userId: string, url: string, year: number): Promise<"sent" | "failed"> {
  try {
    const user = await client.users.fetch(userId);
    await user.send(await wrappedDmPayload(client, url, year));
    return "sent";
  } catch (err) {
    const code = (err as { code?: unknown }).code;
    if (code !== DISCORD_CANNOT_DM) console.error(`[wrapped] dm to ${userId} failed:`, err);
    return "failed";
  }
}
