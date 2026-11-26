import { MessageFlags, SlashCommandBuilder, type ChatInputCommandInteraction, type GuildMember } from "discord.js";
import { Accent, card, v2 } from "../../../core/components.ts";
import { renderBotMessage } from "../../../core/messages.ts";
import { isAdmin } from "../../../core/permissions.ts";
import type { BotContext, Command } from "../../../core/plugin.ts";
import type { WrappedRunStatus } from "../types/wrapped.ts";
import { ensureWrappedLink, getWrappedLink, linkUrl } from "./links.ts";
import { applyOptInChoice, currentUtcYear } from "./optin.ts";
import { getWrappedStatus, latestRunPhase, postAnnouncement, resumeWrappedRun, startWrappedRun, startWrappedSend } from "./run.ts";
import { closeSignups, getSignupState, postSignupMessage, reopenSignups } from "./signup.ts";

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

/**
 * Reply ephemerally with a plain `card()` ack, as the elections commands do.
 * After a `deferReply` (the slow subcommands) the card goes through `editReply`.
 */
function ack(interaction: ChatInputCommandInteraction, accent: number, title: string, lines: string[]) {
  const payload = v2(card({ accent, title, lines }));
  if (interaction.deferred || interaction.replied) return interaction.editReply(payload);
  return interaction.reply({ ...payload, flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
}

/**
 * Admin subcommands that do network or heavy work before answering. They defer
 * first (ephemeral), so the 3-second interaction deadline is never missed and a
 * retry cannot double-post.
 */
const SLOW_SUBCOMMANDS = new Set(["start", "send", "announce", "signups", "resume"]);

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

/** The announcement line of a card. */
function announcementLine(s: WrappedRunStatus): string {
  return s.announcedAt !== null ? `» announced ${utcDate(s.announcedAt)}` : "» not announced";
}

/**
 * The `/wrapped status` card for a run status: a plain card, not a catalog
 * message.
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
    case "processed":
      return {
        accent: Accent.success,
        title: "wrapped, processed",
        lines: [`» ${s.processed} of ${s.total} processed`, `» ${s.optedIn} opted in`, "» nothing sent yet. next: /wrapped send"],
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
          announcementLine(s),
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

/** `/wrapped start`: process a year (no DMs, no announcement). */
function start(interaction: ChatInputCommandInteraction, ctx: BotContext) {
  const year = interaction.options.getInteger("year") ?? currentUtcYear();
  const result = startWrappedRun(ctx, { year, startedBy: interaction.user.id });
  const s = getWrappedStatus();
  if (result === "already-running") {
    const progress = s.status === "sending" ? `sending ${s.sent} of ${s.optedIn}` : `processing ${s.processed} of ${s.total}`;
    return ack(interaction, Accent.warning, "already running", [`${progress}. look at /wrapped status.`]);
  }
  return ack(interaction, Accent.success, "processing started", [
    `» year: ${year}`,
    `» members: ${s.total}`,
    "» nothing is sent while it runs.",
    "» next: you get a dm when processing is done, then send the dms with /wrapped send.",
  ]);
}

/** `/wrapped send`: DM opted-in members their links. */
function send(interaction: ChatInputCommandInteraction, ctx: BotContext) {
  const announce = interaction.options.getBoolean("announce") ?? true;
  const result = startWrappedSend(ctx, { startedBy: interaction.user.id, announce });
  const s = getWrappedStatus();
  if (result === "not-processed") {
    return ack(interaction, Accent.warning, "not processed", ["nothing to send yet. process the year first: /wrapped start."]);
  }
  if (result === "already-running") {
    return ack(interaction, Accent.warning, "already running", ["look at /wrapped status."]);
  }
  const announcement = announce ? "» announcement: posted when the dms finish" : "» announcement: off";
  if (s.optedIn === 0) {
    return ack(interaction, Accent.warning, "sending, nothing to send", [
      "no one has opted in yet. links are made, and /wrapped me works.",
      announcement,
    ]);
  }
  return ack(interaction, Accent.success, "sending started", [
    `» dms: opted-in members only (${s.optedIn} of ${s.total})`,
    announcement,
    "» progress: the dashboard, or /wrapped status",
  ]);
}

/** `/wrapped announce`: post the server Wrapped link to the announcement channel. */
async function announce(interaction: ChatInputCommandInteraction, ctx: BotContext) {
  const year = getWrappedStatus().year ?? currentUtcYear();
  const result = await postAnnouncement(ctx, year);
  if (result === "posted") {
    return ack(interaction, Accent.success, "announced", [`» the server wrapped for ${year} is in the announcements channel.`]);
  }
  if (result === "already-announced") return ack(interaction, Accent.warning, "already announced", [`» ${year} was announced before.`]);
  if (result === "not-processed") {
    return ack(interaction, Accent.warning, "not processed", ["nothing to announce yet. process the year first: /wrapped start."]);
  }
  if (result === "failed") {
    return ack(interaction, Accent.danger, "announcement failed", ["the post did not go through. try /wrapped announce again."]);
  }
  return ack(interaction, Accent.warning, "no announcement channel", ["set one in the dashboard first."]);
}

/** `/wrapped signups`: post the sign-up message, or close or reopen sign-ups. */
async function signups(interaction: ChatInputCommandInteraction, ctx: BotContext) {
  const action = interaction.options.getString("action") ?? "post";
  const year = getSignupState().year;
  if (action === "close") {
    await closeSignups(ctx, year);
    return ack(interaction, Accent.success, "sign-ups closed", ["» the buttons are disabled.", "» /wrapped me still works."]);
  }
  if (action === "reopen") {
    await reopenSignups(ctx, year);
    return ack(interaction, Accent.success, "sign-ups open", ["» the buttons work again."]);
  }
  const buttons = action !== "post-without-buttons";
  const posted = await postSignupMessage(ctx, { year: currentUtcYear(), buttons });
  if (posted === "no-channel") return ack(interaction, Accent.warning, "no announcement channel", ["set one in the dashboard first."]);
  return ack(interaction, Accent.success, "sign-up posted", [buttons ? "» with the opt-in buttons" : "» without buttons, information only"]);
}

/** `/wrapped resume`: continue an interrupted run. */
function resume(interaction: ChatInputCommandInteraction, ctx: BotContext) {
  const before = latestRunPhase();
  if (resumeWrappedRun(ctx) === "nothing-to-resume") {
    return ack(interaction, Accent.warning, "nothing to resume", ["no run is interrupted."]);
  }
  const s = getWrappedStatus();
  return ack(interaction, Accent.success, "run resumed", [
    before === "sending" ? `» sending, ${s.sent} sent so far.` : `» processing, continuing from ${s.processed} of ${s.total}.`,
  ]);
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
 * `/wrapped`: for admins, `start` (process), `send` (DMs), `announce`,
 * `signups`, `status` and `resume` (plain card acks); for every member,
 * `optin`, `optout` and `me` (ephemeral catalog messages). The admin
 * subcommands call the same functions as the dashboard routes.
 */
const wrapped: Command = {
  data: new SlashCommandBuilder()
    .setName("wrapped")
    .setDescription("Your yearly Wrapped.")
    .addSubcommand((s) =>
      s
        .setName("start")
        .setDescription("Process a year: everyone's Wrapped and the server Wrapped. Sends nothing (admin only).")
        .addIntegerOption((o) => o.setName("year").setDescription("The year (default: this year, UTC)").setMinValue(2015).setMaxValue(2100)),
    )
    .addSubcommand((s) =>
      s
        .setName("send")
        .setDescription("DM the links to opted-in members (admin only).")
        .addBooleanOption((o) => o.setName("announce").setDescription("Announce the server Wrapped when the DMs finish (default: true)")),
    )
    .addSubcommand((s) => s.setName("announce").setDescription("Post the server Wrapped link to the announcement channel (admin only)."))
    .addSubcommand((s) =>
      s
        .setName("signups")
        .setDescription("Post the sign-up message, or close or reopen sign-ups (admin only).")
        .addStringOption((o) =>
          o
            .setName("action")
            .setDescription("What to do")
            .setRequired(true)
            .addChoices(
              { name: "post", value: "post" },
              { name: "post without buttons", value: "post-without-buttons" },
              { name: "close", value: "close" },
              { name: "reopen", value: "reopen" },
            ),
        ),
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
    if (SLOW_SUBCOMMANDS.has(sub)) await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    if (sub === "start") return start(interaction, ctx);
    if (sub === "send") return send(interaction, ctx);
    if (sub === "announce") return announce(interaction, ctx);
    if (sub === "signups") return signups(interaction, ctx);
    if (sub === "resume") return resume(interaction, ctx);
    const { accent, title, lines } = statusCard(getWrappedStatus());
    return ack(interaction, accent, title, lines);
  },
};

/** The `/wrapped` slash command. */
export const wrappedCommands: Command[] = [wrapped];
