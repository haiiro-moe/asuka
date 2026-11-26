import { MessageFlags, SlashCommandBuilder, type ChatInputCommandInteraction, type GuildMember } from "discord.js";
import { Accent, card, v2 } from "../../../core/components.ts";
import { renderBotMessage } from "../../../core/messages.ts";
import { isAdmin } from "../../../core/permissions.ts";
import type { BotContext, Command } from "../../../core/plugin.ts";
import type { WrappedRunStatus } from "../types/wrapped.ts";
import { ensureWrappedLink, getWrappedLink, linkUrl } from "./links.ts";
import { applyOptInChoice, currentUtcYear } from "./optin.ts";
import { getWrappedStatus, resumeWrappedRun, startWrappedRun } from "./run.ts";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** A unix-seconds time as a UTC date in the haiiro style, e.g. `20 Dec 2026`. */
function utcDate(unixSec: number): string {
  const d = new Date(unixSec * 1000);
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

/** A ten-cell text progress bar with its percentage, e.g. `▰▰▰▱▱▱▱▱▱▱ 35%`. */
function progressBar(done: number, total: number): string {
  const ratio = total > 0 ? Math.min(1, done / total) : 0;
  const cells = Math.round(ratio * 10);
  return `${"▰".repeat(cells)}${"▱".repeat(10 - cells)} ${Math.round(ratio * 100)}%`;
}

/** Reply ephemerally with a plain `card()` ack, as the elections commands do. */
function ack(interaction: ChatInputCommandInteraction, accent: number, title: string, lines: string[]) {
  return interaction.reply({
    ...v2(card({ accent, title, lines })),
    flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
  });
}

/** Reply ephemerally with a catalog message. */
async function replyMessage(
  interaction: ChatInputCommandInteraction,
  ctx: BotContext,
  key: string,
  params: Record<string, string | number> = {},
) {
  const payload = await renderBotMessage(key, ctx, params);
  return interaction.reply({ ...payload, flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
}

/**
 * The `/wrapped status` card for a run status: a plain card, not a catalog
 * message, matching the "wrapped: bot messages" board.
 *
 * @param s - The status from `getWrappedStatus()`.
 * @returns The card's accent, title and lines.
 */
export function statusCard(s: WrappedRunStatus): { accent: number; title: string; lines: string[] } {
  switch (s.status) {
    case "idle":
      return { accent: Accent.primary, title: "wrapped", lines: ["no run yet."] };
    case "processing":
      return {
        accent: Accent.primary,
        title: "wrapped, processing",
        lines: [
          progressBar(s.processed, s.total),
          `» ${s.processed} of ${s.total} processed`,
          ...(s.startedAt ? [`» started ${utcDate(s.startedAt)}`] : []),
        ],
      };
    case "sending":
      return {
        accent: Accent.primary,
        title: "wrapped, sending",
        lines: [
          progressBar(s.sent + s.failed, s.optedIn),
          `» ${s.sent} of ${s.optedIn} sent`,
          `» ${s.failed} failed`,
          `» ${s.skipped} not opted in`,
        ],
      };
    case "done":
      return {
        accent: Accent.success,
        title: "wrapped, done",
        lines: [
          `» ${s.sent} sent`,
          `» ${s.failed} failed`,
          `» ${s.skipped} not opted in`,
          ...(s.finishedAt ? [`finished ${utcDate(s.finishedAt)}`] : []),
        ],
      };
    case "interrupted":
      return {
        accent: Accent.warning,
        title: "wrapped, interrupted",
        lines: ["no update for 2 minutes. /wrapped resume continues it."],
      };
    case "failed":
      return {
        accent: Accent.danger,
        title: "wrapped, failed",
        lines: [`stopped at ${s.processed} of ${s.total}.`, "the dashboard has the details."],
      };
  }
}

/** `/wrapped start`: start a run and say what it will do. */
function start(interaction: ChatInputCommandInteraction, ctx: BotContext) {
  const year = interaction.options.getInteger("year") ?? currentUtcYear();
  const sendDms = interaction.options.getBoolean("send") ?? true;
  const result = startWrappedRun(ctx, { year, startedBy: interaction.user.id, sendDms });
  const s = getWrappedStatus();
  if (result === "already-running") {
    const progress = s.status === "sending" ? `sending ${s.sent} of ${s.optedIn}` : `processing ${s.processed} of ${s.total}`;
    return ack(interaction, Accent.warning, "already running", [`${progress}. look at /wrapped status.`]);
  }
  if (sendDms && s.optedIn === 0) {
    return ack(interaction, Accent.warning, "run started, nothing will be sent", [
      "no one has opted in yet. links are still made, and /wrapped me works.",
    ]);
  }
  return ack(interaction, Accent.success, "run started", [
    `» year: ${year}`,
    sendDms ? `» dms: opted-in members only (${s.optedIn} of ${s.total})` : "» dms: none, links only",
    "» progress: the dashboard, or /wrapped status",
  ]);
}

/** `/wrapped resume`: continue an interrupted run. */
function resume(interaction: ChatInputCommandInteraction, ctx: BotContext) {
  const before = getWrappedStatus();
  if (resumeWrappedRun(ctx) === "nothing-to-resume") {
    return ack(interaction, Accent.warning, "nothing to resume", ["no run is interrupted."]);
  }
  return ack(interaction, Accent.success, "run resumed", [`» continuing from ${before.processed} of ${before.total}.`]);
}

/**
 * `/wrapped me`: the member's own link, opted in or not. With no link yet it
 * makes one when a run for the year exists and the member had activity;
 * before any run it says the envelopes are not out yet.
 */
async function me(interaction: ChatInputCommandInteraction, ctx: BotContext) {
  const userId = interaction.user.id;
  const status = getWrappedStatus();
  const year = status.year ?? currentUtcYear();
  let token = getWrappedLink(userId, year)?.token ?? null;
  if (!token) {
    if (status.status === "idle") return replyMessage(interaction, ctx, "wrapped.me-not-ready");
    token = ensureWrappedLink(userId, year);
    if (!token) return replyMessage(interaction, ctx, "wrapped.me-empty", { year });
  }
  return replyMessage(interaction, ctx, "wrapped.me-ready", { year, url: linkUrl(token) });
}

/**
 * `/wrapped`: `start`, `status` and `resume` for admins (plain card acks);
 * `optin`, `optout` and `me` for every member (ephemeral catalog messages).
 * The admin subcommands call the same functions as the dashboard routes.
 */
const wrapped: Command = {
  data: new SlashCommandBuilder()
    .setName("wrapped")
    .setDescription("Your yearly Wrapped.")
    .addSubcommand((s) =>
      s
        .setName("start")
        .setDescription("Make everyone's Wrapped and DM opted-in members (admin only).")
        .addIntegerOption((o) => o.setName("year").setDescription("The year (default: this year, UTC)").setMinValue(2015).setMaxValue(2100))
        .addBooleanOption((o) => o.setName("send").setDescription("DM the links to opted-in members (default: true)")),
    )
    .addSubcommand((s) => s.setName("status").setDescription("Show the Wrapped run's progress (admin only)."))
    .addSubcommand((s) => s.setName("resume").setDescription("Continue an interrupted Wrapped run (admin only)."))
    .addSubcommand((s) => s.setName("optin").setDescription("Get your Wrapped link by DM when it is ready."))
    .addSubcommand((s) => s.setName("optout").setDescription("Do not DM me my Wrapped link."))
    .addSubcommand((s) => s.setName("me").setDescription("Get your own Wrapped link.")),

  async execute(interaction, ctx) {
    const sub = interaction.options.getSubcommand();

    if (sub === "optin" || sub === "optout") {
      const payload = await applyOptInChoice(ctx.client, interaction.user.id, sub === "optin");
      return interaction.reply({ ...payload, flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
    }
    if (sub === "me") return me(interaction, ctx);

    const member = interaction.member as GuildMember | null;
    if (!member || !isAdmin(member)) return ack(interaction, Accent.danger, "forbidden", ["admin only."]);
    if (sub === "start") return start(interaction, ctx);
    if (sub === "resume") return resume(interaction, ctx);
    const { accent, title, lines } = statusCard(getWrappedStatus());
    return ack(interaction, accent, title, lines);
  },
};

/** The `/wrapped` slash command. */
export const wrappedCommands: Command[] = [wrapped];
