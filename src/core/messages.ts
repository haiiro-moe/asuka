import { eq } from "drizzle-orm";
import type { APIMessageTopLevelComponent, Client } from "discord.js";
import { db, schema, getConfig } from "../db/index.ts";
import { env } from "../config/env.ts";
import { MessageFlags, Accent, isValidComponentsPayload } from "./components.ts";
import { resolveVariable } from "./variables.ts";
import { nowSec } from "./util.ts";
import type { BotContext } from "./plugin.ts";

/**
 * Catalog of bot responses editable from the web dashboard. Each entry ships a
 * static Components V2 default; an override row in `bot_messages` replaces it.
 * Shipped defaults are written in the haiiro voice: lowercase titles, short
 * plain or narrator lines, glyphs (`» @ ★ ✓ ×`, `☼` for events) instead of
 * emoji, no exclamation marks. A default only applies while no override row
 * exists (see {@link getMessagePayload}), so editing a default here never
 * changes a template an admin has already saved.
 *
 * Text content supports two substitutions at send time:
 *   {param}  — context values documented per message (user, level, …)
 *   {{name}} — owner-defined JS variables (src/core/variables.ts)
 */
export interface BotMessageDef {
  key: string;
  label: string;
  description: string;
  /** Display group in the web editor (messages sharing a category collapse together). */
  category: string;
  /** Context params available as {name} in this message's text. */
  params: { name: string; description: string }[];
  defaultComponents: unknown[];
}

/** Shorthand for a single-container default payload matching core card(). Titles are lowercase by convention. */
function cardPayload(accent: number, title: string, lines: string[]): unknown[] {
  return [
    {
      type: 17, // Container
      accent_color: accent,
      components: [
        { type: 10, content: `## ${title}` },
        { type: 10, content: lines.join("\n") },
      ],
    },
  ];
}

const user = { name: "user", description: "Mention of the affected member" };
const reason = { name: "reason", description: "Moderator-supplied reason (may be empty)" };

/** A {@link cardPayload} with one action row of raw buttons appended inside the container (Wrapped). */
function cardWithButtons(
  accent: number,
  title: string,
  lines: string[],
  buttons: Record<string, unknown>[],
): unknown[] {
  const payload = cardPayload(accent, title, lines) as { components: unknown[] }[];
  payload[0]!.components.push({ type: 1, components: buttons });
  return payload;
}

const wrappedYear = { name: "year", description: "The Wrapped year, e.g. 2026" };
const wrappedUrl = { name: "url", description: "The member's personal Wrapped link (the button opens it)" };
/** The link button of the Wrapped DM and of /wrapped me (style 5 = link). */
const wrappedLinkButton = { type: 2, style: 5, label: "open wrapped", url: "{url}" };

export const MESSAGE_CATALOG: BotMessageDef[] = [
  {
    key: "xp.levelup",
    label: "Level-up announcement",
    description: "Posted in the level-up channel when a member reaches a new level.",
    category: "XP & Levels",
    params: [user, { name: "level", description: "The level just reached" }],
    defaultComponents: cardPayload(Accent.success, "level up", [
      "{user} is now **level {level}**.",
    ]),
  },
  {
    key: "economy.credits-granted",
    label: "Credits granted",
    description: "Confirmation card for /credits give.",
    category: "Economy",
    params: [
      user,
      { name: "amount", description: "SC granted" },
      { name: "balance", description: "New balance" },
      reason,
    ],
    defaultComponents: cardPayload(Accent.success, "credits granted", [
      "{user} received **{amount} SC**.",
      "new balance: **{balance} SC**.",
      "{reason}",
    ]),
  },
  {
    key: "economy.credits-revoked",
    label: "Credits revoked",
    description: "Confirmation card for /credits take.",
    category: "Economy",
    params: [
      user,
      { name: "amount", description: "SC revoked" },
      { name: "balance", description: "New balance" },
      reason,
    ],
    defaultComponents: cardPayload(Accent.warning, "credits revoked", [
      "{user} lost **{amount} SC**.",
      "new balance: **{balance} SC**.",
      "{reason}",
    ]),
  },
  {
    key: "moderation.timeout",
    label: "Member timed out",
    description: "Confirmation card for /timeout.",
    category: "Moderation",
    params: [user, { name: "duration", description: "Human-readable duration" }],
    defaultComponents: cardPayload(Accent.warning, "member timed out", [
      "{user} is muted for **{duration}**.",
    ]),
  },
  {
    key: "moderation.untimeout",
    label: "Timeout removed",
    description: "Confirmation card for /untimeout.",
    category: "Moderation",
    params: [user],
    defaultComponents: cardPayload(Accent.success, "timeout removed", [
      "{user} can speak again.",
    ]),
  },
  {
    key: "moderation.kick",
    label: "Member kicked",
    description: "Confirmation card for /kick.",
    category: "Moderation",
    params: [user, reason],
    defaultComponents: cardPayload(Accent.warning, "member kicked", ["{user} was kicked."]),
  },
  {
    key: "moderation.ban",
    label: "Member banned",
    description: "Confirmation card for /ban.",
    category: "Moderation",
    params: [user, reason],
    defaultComponents: cardPayload(Accent.danger, "member banned", ["{user} was banned."]),
  },
  {
    key: "moderation.unban",
    label: "Ban lifted",
    description: "Confirmation card for /unban.",
    category: "Moderation",
    params: [user, reason],
    defaultComponents: cardPayload(Accent.success, "ban lifted", ["{user} was unbanned."]),
  },
  {
    key: "moderation.warn",
    label: "Warning issued",
    description: "Confirmation card for /warn.",
    category: "Moderation",
    params: [
      user,
      reason,
      { name: "count", description: "The member's total warning count" },
    ],
    defaultComponents: cardPayload(Accent.warning, "warning issued", [
      "{user} now has **{count}** warnings.",
      "reason: {reason}",
    ]),
  },
  {
    key: "events.announce",
    label: "Event created",
    description:
      "Posted in the events channel when an admin creates a new event. Group role mentions are appended automatically.",
    category: "Events",
    params: [
      { name: "title", description: "Event title" },
      { name: "description", description: "Event description (markdown)" },
      { name: "start", description: "Start time as a Discord timestamp" },
      { name: "when", description: "Start–end range in words" },
      { name: "location", description: "Channel mention, or “—” when unset" },
      { name: "group", description: "Group name, or “—” when ungrouped" },
      { name: "recurrence", description: "Human-readable recurrence" },
    ],
    defaultComponents: cardPayload(Accent.primary, "☼ new event: {title}", [
      "{description}",
      "",
      "**when:** {when}",
      "**where:** {location}",
      "**repeats:** {recurrence}",
      "-# /events lists every event and lets you sign up.",
    ]),
  },
  {
    key: "events.reminder-channel",
    label: "Event reminder (channel)",
    description: "Posted in the events channel when an event reminder fires.",
    category: "Events",
    params: [
      { name: "title", description: "Event title" },
      { name: "start", description: "Start time as a Discord timestamp" },
      { name: "relative", description: "Relative start time (e.g. “in a day”)" },
      { name: "location", description: "Channel mention, or “—” when unset" },
      { name: "participants", description: "Number of participants" },
    ],
    defaultComponents: cardPayload(Accent.warning, "☼ reminder: {title}", [
      "starts {relative}, {start}",
      "**where:** {location}",
      "-# {participants} signed up.",
    ]),
  },
  {
    key: "events.reminder-dm",
    label: "Event reminder (DM)",
    description: "Sent as a direct message to each participant when a reminder fires.",
    category: "Events",
    params: [
      { name: "title", description: "Event title" },
      { name: "start", description: "Start time as a Discord timestamp" },
      { name: "relative", description: "Relative start time (e.g. “in a day”)" },
      { name: "location", description: "Channel mention, or “—” when unset" },
    ],
    defaultComponents: cardPayload(Accent.primary, "☼ {title}", [
      "you signed up for **{title}**. it starts {relative} ({start}).",
      "**where:** {location}",
    ]),
  },
  {
    key: "clubs.member-joined",
    label: "Member joined club",
    description: "Posted in the club's space when someone joins.",
    category: "Clubs",
    params: [user, { name: "club", description: "The club's name" }],
    defaultComponents: cardPayload(Accent.success, "new member", [
      "{user} joined the club.",
    ]),
  },
  {
    key: "clubs.member-left",
    label: "Member left club",
    description: "Posted in the club's space when someone leaves voluntarily.",
    category: "Clubs",
    params: [user, { name: "club", description: "The club's name" }],
    defaultComponents: cardPayload(Accent.warning, "member left", [
      "{user} left the club.",
    ]),
  },
  {
    key: "clubs.member-removed",
    label: "Member removed from club",
    description: "Posted in the club's space when someone is kicked from it.",
    category: "Clubs",
    params: [user, { name: "club", description: "The club's name" }],
    defaultComponents: cardPayload(Accent.warning, "member removed", [
      "{user} was removed from the club.",
    ]),
  },
  {
    key: "clubs.approved-announcement",
    label: "Club approved (announcement)",
    description: "Posted in the announcement channel when a club is approved.",
    category: "Clubs",
    params: [
      { name: "club", description: "The club's name" },
      { name: "owner", description: "Mention of the club owner" },
      { name: "description", description: "The club's description" },
    ],
    defaultComponents: cardPayload(Accent.club, "new club recognized", [
      "**{club}** is approved and led by {owner}.",
      "{description}",
    ]),
  },
  {
    key: "clubs.approved-dm",
    label: "Club approved (founder DM)",
    description: "DM sent to every founder when their club is approved.",
    category: "Clubs",
    params: [
      { name: "club", description: "The club's name" },
      { name: "space", description: "Mention of the club's thread/channel (may be empty)" },
    ],
    defaultComponents: cardPayload(Accent.success, "club approved: {club}", [
      "**{club}** is open. your new space is waiting in the server.",
      "{space}",
    ]),
  },
  {
    key: "clubs.rejected-dm",
    label: "Club rejected (founder DM)",
    description: "DM sent to every founder when their club proposal is rejected.",
    category: "Clubs",
    params: [{ name: "club", description: "The club's name" }],
    defaultComponents: cardPayload(Accent.danger, "club not approved: {club}", [
      "your proposal was reviewed and not approved this time.",
    ]),
  },
  {
    key: "clubs.cancelled-dm",
    label: "Club cancelled (founder DM)",
    description: "DM sent to every founder when a founding member declines the club.",
    category: "Clubs",
    params: [
      { name: "club", description: "The club's name" },
      { name: "user", description: "Mention of the founder who declined" },
    ],
    defaultComponents: cardPayload(Accent.warning, "club cancelled: {club}", [
      "{user} declined to be a founding member, so the proposal was cancelled.",
    ]),
  },
  {
    key: "clubs.terminated-announcement",
    label: "Club terminated (announcement)",
    description: "Posted in the announcement channel when a club is disbanded.",
    category: "Clubs",
    params: [{ name: "club", description: "The club's name" }],
    defaultComponents: cardPayload(Accent.warning, "club terminated", [
      "**{club}** has been disbanded.",
    ]),
  },
  {
    key: "elections.theme-updated",
    label: "Server theme updated",
    description: "Announcement posted when the president changes the server theme.",
    category: "Elections",
    params: [
      { name: "actor", description: "Mention of who changed it (or a fallback phrase)" },
      { name: "changes", description: "What was applied, one item per line" },
    ],
    defaultComponents: cardPayload(Accent.election, "server theme updated", [
      "changed by {actor}",
      "{changes}",
    ]),
  },
  {
    key: "system.pong",
    label: "Ping response",
    description: "Reply to /ping.",
    category: "System",
    params: [{ name: "latency", description: "Gateway latency in ms" }],
    defaultComponents: cardPayload(Accent.primary, "pong", [
      "gateway latency: **{latency}ms**",
    ]),
  },
  {
    key: "wrapped.signup",
    label: "Wrapped sign-up",
    description:
      "Posted in the announcement channel by an admin. The title banner image is added above it in code. Keep the button ids wrapped:optin and wrapped:optout.",
    category: "Wrapped",
    params: [wrappedYear],
    defaultComponents: cardWithButtons(
      Accent.primary,
      "wrapped is coming",
      [
        "you can ask for an envelope. it holds your year: what you said, when, and who you said it to.",
        "nobody is written to unless they ask.",
        "» you can always open your own with /wrapped me.",
      ],
      [
        { type: 2, style: 1, label: "opt in", custom_id: "wrapped:optin" },
        { type: 2, style: 2, label: "opt out", custom_id: "wrapped:optout" },
      ],
    ),
  },
  {
    key: "wrapped.optin",
    label: "Wrapped opt-in",
    description: "Ephemeral reply to the opt in button or /wrapped optin.",
    category: "Wrapped",
    params: [],
    defaultComponents: cardPayload(Accent.success, "on the list", [
      "you will get a dm when the envelopes go out.",
      "» /wrapped optout undoes it.",
    ]),
  },
  {
    key: "wrapped.already",
    label: "Wrapped already opted in",
    description: "Ephemeral reply to opting in when already opted in.",
    category: "Wrapped",
    params: [],
    defaultComponents: cardPayload(Accent.primary, "already on the list", ["nothing to change."]),
  },
  {
    key: "wrapped.optout",
    label: "Wrapped opt-out",
    description: "Ephemeral reply to the opt out button or /wrapped optout.",
    category: "Wrapped",
    params: [],
    defaultComponents: cardPayload(Accent.primary, "off the list", [
      "no dm will come.",
      "» your envelope is safe at the post office: /wrapped me.",
    ]),
  },
  {
    key: "wrapped.dm",
    label: "Wrapped DM",
    description:
      "DM with the member's personal link, sent only to opted-in members. The title banner image is added above it in code.",
    category: "Wrapped",
    params: [wrappedYear, wrappedUrl],
    defaultComponents: cardWithButtons(
      Accent.success,
      "your {year} is ready",
      [
        "an envelope has been left at your door. it is addressed to you, and only you.",
        "open it as often as you like.",
        "this link is yours. keep it between us.",
      ],
      [wrappedLinkButton],
    ),
  },
  {
    key: "wrapped.me-ready",
    label: "Wrapped link (/wrapped me)",
    description: "Ephemeral reply to /wrapped me with the member's own link.",
    category: "Wrapped",
    params: [wrappedYear, wrappedUrl],
    defaultComponents: cardWithButtons(
      Accent.success,
      "your envelope",
      ["your {year} is waiting.", "this link is yours. keep it between us."],
      [wrappedLinkButton],
    ),
  },
  {
    key: "wrapped.me-not-ready",
    label: "Wrapped not ready (/wrapped me)",
    description: "Ephemeral reply to /wrapped me before any run has made the member's link.",
    category: "Wrapped",
    params: [],
    defaultComponents: cardPayload(Accent.warning, "not yet", [
      "nothing has been posted. an admin sends the envelopes when they are ready.",
    ]),
  },
  {
    key: "wrapped.me-empty",
    label: "Wrapped empty (/wrapped me)",
    description: "Ephemeral reply to /wrapped me for a member with no activity that year.",
    category: "Wrapped",
    params: [wrappedYear],
    defaultComponents: cardPayload(Accent.primary, "an empty envelope", [
      "you were not around in {year}. there is nothing to show yet.",
    ]),
  },
  {
    key: "wrapped.run-finished",
    label: "Wrapped run finished (mod log)",
    description: "Posted in the mod-log channel when a Wrapped run ends. Skipped when no mod-log channel is set.",
    category: "Wrapped",
    params: [
      wrappedYear,
      { name: "admin", description: "Mention of the admin who started the run" },
      { name: "sent", description: "DMs delivered" },
      { name: "failed", description: "DMs that could not be delivered" },
      { name: "skipped", description: "Members with a link who had not opted in" },
    ],
    defaultComponents: cardPayload(Accent.success, "wrapped run finished", [
      "» {year}, started by {admin}",
      "» {sent} sent, {failed} failed, {skipped} not opted in",
      "» failed dms are listed on the dashboard.",
    ]),
  },
  {
    key: "wrapped.run-failed",
    label: "Wrapped run failed (mod log)",
    description: "Posted in the mod-log channel when a Wrapped run stops on an error. Skipped when no mod-log channel is set.",
    category: "Wrapped",
    params: [
      { name: "processed", description: "Members processed before it stopped" },
      { name: "total", description: "Members the run covers" },
    ],
    defaultComponents: cardPayload(Accent.danger, "wrapped run failed", [
      "stopped at {processed} of {total}.",
      "the dashboard has the details.",
    ]),
  },
];

/**
 * BotContext for message rendering in service code that only holds a Client
 * (background jobs, shared helpers). Mirrors the ctx built at boot.
 */
export function messageCtx(client: Client): BotContext {
  return { client, guildId: env.GUILD_ID, config: getConfig };
}

export function getMessageDef(key: string): BotMessageDef | undefined {
  return MESSAGE_CATALOG.find((m) => m.key === key);
}

export function getMessageOverride(key: string): unknown[] | null {
  const row = db
    .select()
    .from(schema.botMessages)
    .where(eq(schema.botMessages.key, key))
    .get();
  return row && isValidComponentsPayload(row.components) ? row.components : null;
}

/** Current payload for a message: the override if set, else the shipped default. */
export function getMessagePayload(key: string): unknown[] {
  const def = getMessageDef(key);
  if (!def) throw new Error(`unknown bot message key: ${key}`);
  return getMessageOverride(key) ?? structuredClone(def.defaultComponents);
}

export function setMessageOverride(key: string, components: unknown[]) {
  if (!getMessageDef(key)) throw new Error(`unknown bot message key: ${key}`);
  db.insert(schema.botMessages)
    .values({ key, components, updatedAt: nowSec() })
    .onConflictDoUpdate({
      target: schema.botMessages.key,
      set: { components, updatedAt: nowSec() },
    })
    .run();
}

export function clearMessageOverride(key: string) {
  db.delete(schema.botMessages).where(eq(schema.botMessages.key, key)).run();
}

// --- Rendering ---

const VAR_RE = /\{\{([a-zA-Z_][\w.-]*)\}\}/g;
const PARAM_RE = /\{([a-zA-Z_][\w]*)\}/g;

function collectStrings(node: unknown, out: string[]) {
  if (typeof node === "string") out.push(node);
  else if (Array.isArray(node)) for (const n of node) collectStrings(n, out);
  else if (node && typeof node === "object") {
    for (const v of Object.values(node)) collectStrings(v, out);
  }
}

function mapStrings(node: unknown, fn: (s: string) => string): unknown {
  if (typeof node === "string") return fn(node);
  if (Array.isArray(node)) return node.map((n) => mapStrings(n, fn));
  if (node && typeof node === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(node)) out[k] = mapStrings(v, fn);
    return out;
  }
  return node;
}

/**
 * Resolve a message's current payload with {{variables}} (evaluated once each
 * per render) and {params} substituted, wrapped as a Components V2 send
 * payload. Call sites spread it into reply()/send() options; ephemeral
 * replies OR the Ephemeral flag on top.
 */
export async function renderBotMessage(
  key: string,
  ctx: BotContext,
  params: Record<string, string | number> = {},
) {
  const payload = getMessagePayload(key);

  // Evaluate each distinct {{variable}} once, even when repeated.
  const strings: string[] = [];
  collectStrings(payload, strings);
  const varNames = new Set<string>();
  for (const s of strings) for (const m of s.matchAll(VAR_RE)) varNames.add(m[1]!);
  const resolved = new Map<string, string>();
  await Promise.all(
    [...varNames].map(async (name) => resolved.set(name, await resolveVariable(name, ctx))),
  );

  const components = mapStrings(payload, (s) =>
    s
      .replace(VAR_RE, (_, name) => resolved.get(name) ?? "")
      .replace(PARAM_RE, (whole, name) =>
        name in params ? String(params[name]) : whole,
      ),
  ) as APIMessageTopLevelComponent[];

  return {
    flags: MessageFlags.IsComponentsV2 as const,
    components,
    allowedMentions: { parse: [] as const },
  };
}
