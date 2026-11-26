/**
 * Wrapped sign-up control: the "wrapped is coming" message an admin posts to
 * the announcement channel, and closing or reopening sign-ups.
 *
 * While sign-ups are closed the message's buttons are disabled, and the
 * buttons and `/wrapped optin` / `optout` change nothing (they reply
 * `wrapped.signup-closed`). `/wrapped me` always works. The state lives in
 * `activity_wrapped_signup`, one row per year; the latest year's row decides
 * whether sign-ups are closed.
 *
 * See docs/activity/wrapped.md.
 *
 * @packageDocumentation
 */
import type { TextChannel } from "discord.js";
import { desc, eq } from "drizzle-orm";
import type { BotContext } from "../../../core/plugin.ts";
import { nowSec } from "../../../core/util.ts";
import { db, getConfig, schema } from "../../../db/index.ts";
import type { WrappedSignupState } from "../types/wrapped.ts";
import { currentUtcYear, optedInCount, signupMessage } from "./optin.ts";

type SignupRow = typeof schema.activityWrappedSignup.$inferSelect;

/** The sign-up row of a year. */
function signupRow(year: number): SignupRow | undefined {
  return db.select().from(schema.activityWrappedSignup).where(eq(schema.activityWrappedSignup.year, year)).get();
}

/** The sign-up row of the latest year that has one. */
function latestSignupRow(): SignupRow | undefined {
  return db.select().from(schema.activityWrappedSignup).orderBy(desc(schema.activityWrappedSignup.year)).limit(1).get();
}

/**
 * Whether sign-ups are closed: the latest year's sign-up row says so.
 *
 * @returns False when no sign-up row exists.
 */
export function signupsClosed(): boolean {
  return latestSignupRow()?.closed === 1;
}

/**
 * The sign-up state for the dashboard.
 *
 * @param year - The year; defaults to the latest year with a sign-up row, else the current UTC year.
 */
export function getSignupState(year?: number): WrappedSignupState {
  const row = year === undefined ? latestSignupRow() : signupRow(year);
  return {
    year: row?.year ?? year ?? currentUtcYear(),
    posted: !!row?.messageId,
    buttons: row ? row.buttons === 1 : false,
    closed: row?.closed === 1,
    optedIn: optedInCount(),
  };
}

/**
 * Post the sign-up message to the announcement channel and remember it,
 * replacing the year's previous record. A new message opens sign-ups.
 *
 * @param ctx - Bot context.
 * @param opts.year - The year on the banner.
 * @param opts.buttons - False posts the card without buttons (information only).
 * @returns `posted`, or `no-channel` when the announcement channel is unset or unreachable.
 */
export async function postSignupMessage(
  ctx: BotContext,
  opts: { year: number; buttons: boolean },
): Promise<"posted" | "no-channel"> {
  const channelId = getConfig().announcementChannelId;
  if (!channelId) return "no-channel";
  const channel = await ctx.client.channels.fetch(channelId).catch(() => null);
  if (!channel?.isTextBased() || !("send" in channel)) return "no-channel";
  const message = await (channel as TextChannel).send(await signupMessage(ctx.client, opts.year, { buttons: opts.buttons }));
  const values = {
    channelId,
    messageId: message.id,
    buttons: opts.buttons ? 1 : 0,
    closed: 0,
    postedAt: nowSec(),
    closedAt: null,
  };
  db.insert(schema.activityWrappedSignup)
    .values({ year: opts.year, ...values })
    .onConflictDoUpdate({ target: schema.activityWrappedSignup.year, set: values })
    .run();
  return "posted";
}

/**
 * Close sign-ups for a year: disable both buttons on the posted message (same
 * labels) and mark the year closed. A deleted message or channel is logged
 * and sign-ups are closed anyway; a year with no message is closed too.
 *
 * @param ctx - Bot context.
 * @param year - The year.
 */
export async function closeSignups(ctx: BotContext, year: number): Promise<void> {
  setClosed(year, true);
  await setButtonsDisabled(ctx, signupRow(year), true);
}

/**
 * Reopen sign-ups for a year: re-enable the buttons and mark the year open.
 *
 * @param ctx - Bot context.
 * @param year - The year.
 */
export async function reopenSignups(ctx: BotContext, year: number): Promise<void> {
  setClosed(year, false);
  await setButtonsDisabled(ctx, signupRow(year), false);
}

/** Store the closed flag of a year, making its row when needed. */
function setClosed(year: number, closed: boolean): void {
  const values = { closed: closed ? 1 : 0, closedAt: closed ? nowSec() : null };
  db.insert(schema.activityWrappedSignup)
    .values({ year, ...values })
    .onConflictDoUpdate({ target: schema.activityWrappedSignup.year, set: values })
    .run();
}

/** Edit the posted sign-up message so its buttons are disabled or enabled. Never throws. */
async function setButtonsDisabled(ctx: BotContext, row: SignupRow | undefined, disabled: boolean): Promise<void> {
  if (!row?.channelId || !row.messageId || row.buttons !== 1) return;
  try {
    const channel = await ctx.client.channels.fetch(row.channelId);
    if (!channel?.isTextBased() || !("messages" in channel)) throw new Error("not a text channel");
    const message = await (channel as TextChannel).messages.fetch(row.messageId);
    const components = message.components.map((c) =>
      toggleButtons(typeof (c as { toJSON?: unknown }).toJSON === "function" ? (c as { toJSON: () => unknown }).toJSON() : c, disabled),
    );
    await message.edit({ components: components as never });
  } catch (err) {
    console.error(`[wrapped] could not edit the sign-up message (${disabled ? "close" : "reopen"}):`, err);
  }
}

/** Deep-copy component JSON, setting `disabled` on every button. */
export function toggleButtons(node: unknown, disabled: boolean): unknown {
  if (Array.isArray(node)) return node.map((n) => toggleButtons(n, disabled));
  if (node && typeof node === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(node)) out[k] = toggleButtons(v, disabled);
    if (out.type === 2) out.disabled = disabled;
    return out;
  }
  return node;
}
