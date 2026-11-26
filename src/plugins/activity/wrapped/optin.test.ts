import { afterAll, afterEach, beforeAll, beforeEach, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { MessageFlags } from "discord.js";
import { db, initDb, schema } from "../../../db/index.ts";
import { isValidComponentsPayload } from "../../../core/components.ts";
import { MESSAGE_CATALOG, renderBotMessage } from "../../../core/messages.ts";
import { recordMessage } from "../record.ts";
import { wrappedCommands } from "./commands.ts";
import { wrappedListeners } from "./listeners.ts";
import { linkUrl } from "./links.ts";
import { isOptedIn, optedInCount, setOptIn, signupMessage } from "./optin.ts";
import { startWrappedRun, waitForWrappedRun, wrappedRunTiming } from "./run.ts";
import { allButtons, allStrings, at, fakeClient, fakeCtx, msg, resetWrappedTables } from "./testing.ts";

beforeAll(() => {
  initDb();
  wrappedRunTiming.sendDelayMs = 0;
});

beforeEach(() => {
  resetWrappedTables();
});

afterAll(() => {
  resetWrappedTables();
});

afterEach(async () => {
  await waitForWrappedRun();
});

/** A recorded reply: its payload. */
type Reply = { components?: unknown; flags?: number; content?: string };

/** A fake click on a button with `customId` by `userId`. */
function click(customId: string, userId: string) {
  const replies: Reply[] = [];
  const interaction = {
    isButton: () => true,
    customId,
    user: { id: userId },
    async reply(payload: Reply) {
      replies.push(payload);
      return {};
    },
  };
  return { interaction, replies };
}

/** Run the wrapped button listener for a click. */
async function handleClick(customId: string, userId: string) {
  const { client } = fakeClient();
  const { interaction, replies } = click(customId, userId);
  for (const l of wrappedListeners) await l.handle(fakeCtx(client), interaction as never);
  return replies;
}

/** Run `/wrapped <sub>` as `userId`; `admin` decides the member's permissions. */
async function slash(sub: string, userId: string, opts: { admin?: boolean; year?: number; send?: boolean } = {}) {
  const replies: Reply[] = [];
  const interaction = {
    options: {
      getSubcommand: () => sub,
      getInteger: (name: string) => (name === "year" ? (opts.year ?? null) : null),
      getBoolean: (name: string) => (name === "send" ? (opts.send ?? null) : null),
    },
    user: { id: userId },
    member: { permissions: { has: () => opts.admin ?? false } },
    deferred: false,
    replied: false,
    async reply(payload: Reply) {
      replies.push(payload);
      return {};
    },
    async editReply(payload: Reply) {
      replies.push(payload);
      return {};
    },
    async deferReply() {
      return {};
    },
  };
  const { client, log } = fakeClient();
  await wrappedCommands[0]!.execute(interaction as never, fakeCtx(client));
  return { replies, log };
}

/** The joined text of a reply. */
function textOf(reply: Reply): string {
  return allStrings(reply.components).join("\n");
}

test("setOptIn, isOptedIn and optedInCount", () => {
  expect(isOptedIn("u1")).toBe(false);
  setOptIn("u1", true);
  setOptIn("u1", true);
  setOptIn("u2", true);
  expect(isOptedIn("u1")).toBe(true);
  expect(optedInCount()).toBe(2);
  setOptIn("u1", false);
  setOptIn("u1", false);
  expect(isOptedIn("u1")).toBe(false);
  expect(optedInCount()).toBe(1);
});

test("the sign-up message has the opt-in and opt-out buttons and the banner", async () => {
  const payload = await signupMessage();
  expect(payload.flags).toBe(MessageFlags.IsComponentsV2);
  const ids = allButtons(payload.components).map((b) => b.custom_id);
  expect(ids).toEqual(["wrapped:optin", "wrapped:optout"]);
  expect(textOf(payload as Reply)).toContain("wrapped is coming");
  expect((payload.files as unknown as { name?: string }[]).map((f) => f.name)).toEqual(["wrapped-banner.png"]);
});

test("the opt-in button records the clicking user only, and replies ephemerally", async () => {
  const replies = await handleClick("wrapped:optin", "u1");
  expect(isOptedIn("u1")).toBe(true);
  expect(isOptedIn("u2")).toBe(false);
  expect(optedInCount()).toBe(1);
  expect(replies.length).toBe(1);
  expect(replies[0]!.flags! & MessageFlags.Ephemeral).toBe(MessageFlags.Ephemeral);
  expect(replies[0]!.flags! & MessageFlags.IsComponentsV2).toBe(MessageFlags.IsComponentsV2);
  expect(textOf(replies[0]!)).toContain("on the list");

  const again = await handleClick("wrapped:optin", "u1");
  expect(textOf(again[0]!)).toContain("already on the list");
});

test("the opt-out button removes the opt-in", async () => {
  setOptIn("u1", true);
  const replies = await handleClick("wrapped:optout", "u1");
  expect(isOptedIn("u1")).toBe(false);
  expect(textOf(replies[0]!)).toContain("off the list");
});

test("other buttons are ignored", async () => {
  const replies = await handleClick("pf:main:u1", "u1");
  expect(replies.length).toBe(0);
  expect(isOptedIn("u1")).toBe(false);
});

test("/wrapped optin and optout work for any member", async () => {
  const a = await slash("optin", "u1");
  expect(isOptedIn("u1")).toBe(true);
  expect(textOf(a.replies[0]!)).toContain("on the list");
  const b = await slash("optout", "u1");
  expect(isOptedIn("u1")).toBe(false);
  expect(textOf(b.replies[0]!)).toContain("off the list");
});

test("/wrapped me before any run is not ready", async () => {
  recordMessage(msg("u1", at("2026-06-01T12:00:00Z")));
  const { replies } = await slash("me", "u1");
  expect(textOf(replies[0]!)).toContain("not yet");
  expect(replies[0]!.flags! & MessageFlags.Ephemeral).toBe(MessageFlags.Ephemeral);
});

test("/wrapped me returns the link for a member who is not opted in", async () => {
  recordMessage(msg("u1", at("2026-06-01T12:00:00Z")));
  const { client } = fakeClient();
  startWrappedRun(fakeCtx(client), { year: 2026, startedBy: "admin", sendDms: true });
  await waitForWrappedRun();
  const token = db
    .select()
    .from(schema.activityWrappedLinks)
    .where(eq(schema.activityWrappedLinks.userId, "u1"))
    .get()!.token;

  const { replies } = await slash("me", "u1");
  expect(textOf(replies[0]!)).toContain("your 2026 is waiting");
  expect(allButtons(replies[0]!.components).map((b) => b.url)).toEqual([linkUrl(token)]);
});

test("/wrapped me with no activity that year is an empty envelope", async () => {
  recordMessage(msg("u1", at("2026-06-01T12:00:00Z")));
  const { client } = fakeClient();
  startWrappedRun(fakeCtx(client), { year: 2026, startedBy: "admin", sendDms: false });
  await waitForWrappedRun();
  const { replies } = await slash("me", "u9");
  expect(textOf(replies[0]!)).toContain("you were not around in 2026");
});

test("admin subcommands are forbidden to members", async () => {
  for (const sub of ["start", "status", "resume"]) {
    const { replies } = await slash(sub, "u1");
    expect(textOf(replies[0]!)).toContain("forbidden");
    expect(textOf(replies[0]!)).toContain("admin only.");
  }
});

test("/wrapped start and status for an admin use the run functions", async () => {
  recordMessage(msg("u1", at("2026-06-01T12:00:00Z")));
  const none = await slash("status", "admin", { admin: true });
  expect(textOf(none.replies[0]!)).toContain("no run yet.");

  const started = await slash("start", "admin", { admin: true, year: 2026 });
  expect(textOf(started.replies[0]!)).toContain("run started, nothing will be sent");
  const busy = await slash("start", "admin", { admin: true, year: 2026 });
  expect(textOf(busy.replies[0]!)).toContain("already running");
  await waitForWrappedRun();

  const done = await slash("status", "admin", { admin: true });
  expect(textOf(done.replies[0]!)).toContain("wrapped, done");
  expect(textOf(done.replies[0]!)).toContain("» 1 not opted in");
});

test("every wrapped.* default is a valid lowercase payload with no ! and no {param} left", async () => {
  const defs = MESSAGE_CATALOG.filter((m) => m.key.startsWith("wrapped."));
  expect(defs.map((d) => d.key).sort()).toEqual(
    [
      "wrapped.signup",
      "wrapped.optin",
      "wrapped.already",
      "wrapped.optout",
      "wrapped.dm",
      "wrapped.me-ready",
      "wrapped.me-not-ready",
      "wrapped.me-empty",
      "wrapped.run-finished",
      "wrapped.run-failed",
    ].sort(),
  );
  const { client } = fakeClient();
  for (const def of defs) {
    expect(def.category).toBe("Wrapped");
    expect(isValidComponentsPayload(def.defaultComponents)).toBe(true);
    const strings = allStrings(def.defaultComponents);
    const title = strings.find((s) => s.startsWith("## "))!;
    expect(title).toBe(title.toLowerCase());
    for (const s of strings) expect(s).not.toContain("!");

    const params = Object.fromEntries(def.params.map((p) => [p.name, `v-${p.name}`]));
    const rendered = await renderBotMessage(def.key, fakeCtx(client), params);
    for (const s of allStrings(rendered.components)) expect(s).not.toMatch(/\{[a-zA-Z_]\w*\}/);
  }
});
