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
 * Discord error codes that refuse one member and say nothing about the bot or
 * Discord as a whole: closed DMs (50007), an unknown user (10013) and opening
 * DMs too fast for that user (40003). Any other failure counts towards the
 * send step's circuit breaker.
 */
export const PER_MEMBER_DM_CODES: ReadonlySet<number> = new Set([DISCORD_CANNOT_DM, 10013, 40003]);

/** The outcome of one DM attempt, with the failure kind. */
export type WrappedDmOutcome =
  | { status: "sent" }
  | {
      status: "failed";
      /** True for a refusal of this one member ({@link PER_MEMBER_DM_CODES}). */
      perMember: boolean;
      /** The error's message, for the run status. */
      message: string;
    };

/**
 * DM a member their Wrapped link, telling a per-member refusal apart from any
 * other failure.
 *
 * @param client - The bot client.
 * @param userId - The member.
 * @param url - The member's link, `linkUrl(token)`.
 * @param year - The Wrapped year.
 * @returns `sent`, or `failed` with `perMember` and the error message.
 *   Never throws; a failure that is not per-member is logged.
 */
export async function sendWrappedDmDetailed(client: Client, userId: string, url: string, year: number): Promise<WrappedDmOutcome> {
  try {
    const user = await client.users.fetch(userId);
    await user.send(await wrappedDmPayload(client, url, year));
    return { status: "sent" };
  } catch (err) {
    const code = (err as { code?: unknown }).code;
    const perMember = typeof code === "number" && PER_MEMBER_DM_CODES.has(code);
    if (!perMember) console.error(`[wrapped] dm to ${userId} failed:`, err);
    return { status: "failed", perMember, message: err instanceof Error ? err.message : String(err) };
  }
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
  return (await sendWrappedDmDetailed(client, userId, url, year)).status;
}
