/**
 * Wrapped DM opt-in.
 *
 * A run makes a link for every member with activity, but a DM only ever goes
 * to a member with a row in `activity_wrapped_optins`. Members opt in with
 * `/wrapped optin` or the button on the sign-up message, and opt out the same
 * way; opting out deletes the row.
 *
 * @packageDocumentation
 */
import type { Client, MessageCreateOptions } from "discord.js";
import { count, eq } from "drizzle-orm";
import { messageCtx, renderBotMessage } from "../../../core/messages.ts";
import { nowSec } from "../../../core/util.ts";
import { db, schema } from "../../../db/index.ts";
import { withWrappedBanner } from "./banner.ts";

/** Custom id of the sign-up message's opt-in button. */
export const OPTIN_BUTTON_ID = "wrapped:optin";
/** Custom id of the sign-up message's opt-out button. */
export const OPTOUT_BUTTON_ID = "wrapped:optout";

/**
 * Whether a member has opted in to the Wrapped DM.
 *
 * @param userId - The member.
 */
export function isOptedIn(userId: string): boolean {
  return (
    db
      .select({ userId: schema.activityWrappedOptins.userId })
      .from(schema.activityWrappedOptins)
      .where(eq(schema.activityWrappedOptins.userId, userId))
      .get() !== undefined
  );
}

/**
 * Opt a member in or out. Repeating either is a no-op.
 *
 * @param userId - The member.
 * @param optedIn - True to opt in, false to opt out (deletes the row).
 */
export function setOptIn(userId: string, optedIn: boolean): void {
  if (optedIn) {
    db.insert(schema.activityWrappedOptins).values({ userId, optedInAt: nowSec() }).onConflictDoNothing().run();
  } else {
    db.delete(schema.activityWrappedOptins).where(eq(schema.activityWrappedOptins.userId, userId)).run();
  }
}

/** How many members are opted in right now. */
export function optedInCount(): number {
  return db.select({ n: count() }).from(schema.activityWrappedOptins).get()?.n ?? 0;
}

/**
 * Record a member's opt-in choice and render the matching ephemeral reply:
 * `wrapped.optin`, `wrapped.already` (opting in twice) or `wrapped.optout`.
 * Shared by the sign-up buttons and `/wrapped optin` / `optout`.
 *
 * @param client - The bot client, for `{{variables}}` in an edited template.
 * @param userId - The member who chose.
 * @param optedIn - True to opt in, false to opt out.
 * @returns The rendered reply, to be sent with the Ephemeral flag.
 */
export async function applyOptInChoice(client: Client, userId: string, optedIn: boolean) {
  let key = "wrapped.optout";
  if (optedIn) key = isOptedIn(userId) ? "wrapped.already" : "wrapped.optin";
  setOptIn(userId, optedIn);
  return renderBotMessage(key, messageCtx(client), {});
}

/** The current UTC year. */
export function currentUtcYear(): number {
  return new Date().getUTCFullYear();
}

/**
 * The sign-up message an admin posts to the announcement channel: the
 * `wrapped.signup` catalog message (with the `wrapped:optin` and
 * `wrapped:optout` buttons) under the `wrapped <year>` title banner, or
 * text-only when the banner cannot be rendered.
 *
 * It is async because the catalog message may hold `{{variables}}` and the
 * banner is rendered.
 *
 * @param client - The bot client, for `{{variables}}` in an edited template.
 *   Optional: without it variables resolve against no client.
 * @param year - The year on the banner; defaults to the current UTC year.
 * @returns Send options for `channel.send()`.
 */
export async function signupMessage(client?: Client, year: number = currentUtcYear()): Promise<MessageCreateOptions> {
  const ctx = messageCtx(client ?? (null as unknown as Client));
  const rendered = await renderBotMessage("wrapped.signup", ctx, { year });
  return (await withWrappedBanner(rendered, year)) as MessageCreateOptions;
}
