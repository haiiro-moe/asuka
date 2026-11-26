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
import { closeSignups, getSignupState, postSignupMessage, reopenSignups, signupsClosed } from "./signup.ts";
import { allButtons, allStrings, at, fakeClient, fakeCtx, msg, resetWrappedTables, setConfig } from "./testing.ts";

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
async function slash(
  sub: string,
  userId: string,
  opts: {
    admin?: boolean;
    year?: number;
    announce?: boolean;
    action?: string;
    fake?: ReturnType<typeof fakeClient>;
    order?: string[];
  } = {},
) {
  const replies: Reply[] = [];
  /** The order of the interaction calls (and channel fetches, when the fake records them). */
  const order: string[] = opts.order ?? [];
  const interaction = {
    options: {
      getSubcommand: () => sub,
      getInteger: (name: string) => (name === "year" ? (opts.year ?? null) : null),
      getBoolean: (name: string) => (name === "announce" ? (opts.announce ?? null) : null),
      getString: (name: string) => (name === "action" ? (opts.action ?? null) : null),
    },
    user: { id: userId },
    member: { permissions: { has: () => opts.admin ?? false } },
    deferred: false,
    replied: false,
    async reply(payload: Reply) {
      order.push("reply");
      replies.push(payload);
      return {};
    },
    async editReply(payload: Reply) {
      order.push("editReply");
      replies.push(payload);
      return {};
    },
    async deferReply(payload: Reply) {
      order.push("deferReply");
      expect(payload.flags! & MessageFlags.Ephemeral).toBe(MessageFlags.Ephemeral);
      interaction.deferred = true;
      return {};
    },
  };
  const { client, log } = opts.fake ?? fakeClient();
  await wrappedCommands[0]!.execute(interaction as never, fakeCtx(client));
  return { replies, log, order };
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
  startWrappedRun(fakeCtx(client), { year: 2026, startedBy: "admin" });
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
  startWrappedRun(fakeCtx(client), { year: 2026, startedBy: "admin" });
  await waitForWrappedRun();
  const { replies } = await slash("me", "u9");
  expect(textOf(replies[0]!)).toContain("you were not around in 2026");
});

test("admin subcommands are forbidden to members", async () => {
  for (const sub of ["start", "send", "announce", "signups", "status", "resume"]) {
    const { replies } = await slash(sub, "u1");
    expect(textOf(replies[0]!)).toContain("forbidden");
    expect(textOf(replies[0]!)).toContain("admin only.");
  }
});

test("/wrapped start and status for an admin use the run functions", async () => {
  recordMessage(msg("u1", at("2026-06-01T12:00:00Z")));
  const none = await slash("status", "admin", { admin: true });
  expect(textOf(none.replies[0]!)).toContain("no run yet.");

  const early = await slash("send", "admin", { admin: true });
  expect(textOf(early.replies[0]!)).toContain("not processed");

  const started = await slash("start", "admin", { admin: true, year: 2026 });
  expect(textOf(started.replies[0]!)).toContain("processing started");
  expect(textOf(started.replies[0]!)).toContain("» next: you get a dm when processing is done, then send the dms with /wrapped send.");
  const busy = await slash("start", "admin", { admin: true, year: 2026 });
  expect(textOf(busy.replies[0]!)).toContain("already running");
  await waitForWrappedRun();

  const processed = await slash("status", "admin", { admin: true });
  expect(textOf(processed.replies[0]!)).toContain("wrapped, processed");

  setOptIn("u1", true);
  const sending = await slash("send", "admin", { admin: true, announce: false });
  expect(textOf(sending.replies[0]!)).toContain("» dms: opted-in members only (1 of 1)");
  expect(textOf(sending.replies[0]!)).toContain("» announcement: off");
  await waitForWrappedRun();

  const done = await slash("status", "admin", { admin: true });
  expect(textOf(done.replies[0]!)).toContain("wrapped, done");
  expect(textOf(done.replies[0]!)).toContain("» 1 sent");
  expect(textOf(done.replies[0]!)).toContain("» not announced");
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
      "wrapped.announce",
      "wrapped.processed",
      "wrapped.signup-closed",
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

test("postSignupMessage with buttons stores the message; without buttons it has no buttons", async () => {
  const fake = fakeClient();
  expect(await postSignupMessage(fakeCtx(fake.client), { year: 2026, buttons: true })).toBe("no-channel");
  setConfig({ announcementChannelId: "ann" });
  expect(await postSignupMessage(fakeCtx(fake.client), { year: 2026, buttons: true })).toBe("posted");
  expect(allButtons(fake.log.posts[0]!.payload.components).map((b) => b.custom_id)).toEqual(["wrapped:optin", "wrapped:optout"]);
  expect(getSignupState()).toEqual({ year: 2026, posted: true, buttons: true, closed: false, optedIn: 0 });

  expect(await postSignupMessage(fakeCtx(fake.client), { year: 2026, buttons: false })).toBe("posted");
  const plain = fake.log.posts[1]!.payload;
  expect(allButtons(plain.components)).toEqual([]);
  expect(textOf(plain as Reply)).toContain("wrapped is coming");
  expect(getSignupState().buttons).toBe(false);
});

test("closeSignups disables both buttons; handlers change nothing while closed; reopenSignups restores them", async () => {
  setConfig({ announcementChannelId: "ann" });
  const fake = fakeClient();
  const ctx = fakeCtx(fake.client);
  await postSignupMessage(ctx, { year: 2026, buttons: true });
  const messageId = [...fake.log.messages.keys()][0]!;
  setOptIn("u2", true);

  await closeSignups(ctx, 2026);
  const closed = fake.log.messages.get(messageId)!;
  expect(closed.edits.length).toBe(1);
  expect(allButtons(closed.components).map((b) => [b.label, b.disabled])).toEqual([
    ["opt in", true],
    ["opt out", true],
  ]);
  expect(getSignupState().closed).toBe(true);

  const click1 = await handleClick("wrapped:optin", "u1");
  expect(textOf(click1[0]!)).toContain("sign-ups are closed");
  expect(isOptedIn("u1")).toBe(false);
  const click2 = await handleClick("wrapped:optout", "u2");
  expect(textOf(click2[0]!)).toContain("your choice stands.");
  expect(isOptedIn("u2")).toBe(true);
  const cmd = await slash("optin", "u3");
  expect(textOf(cmd.replies[0]!)).toContain("sign-ups are closed");
  expect(isOptedIn("u3")).toBe(false);
  // /wrapped me always works.
  const me = await slash("me", "u3");
  expect(textOf(me.replies[0]!)).toContain("not yet");

  await reopenSignups(ctx, 2026);
  expect(allButtons(fake.log.messages.get(messageId)!.components).map((b) => b.disabled)).toEqual([false, false]);
  expect(getSignupState().closed).toBe(false);
  await handleClick("wrapped:optin", "u1");
  expect(isOptedIn("u1")).toBe(true);
});

test("closing with a deleted message does not throw and still closes sign-ups", async () => {
  setConfig({ announcementChannelId: "ann" });
  const fake = fakeClient();
  const ctx = fakeCtx(fake.client);
  await postSignupMessage(ctx, { year: 2026, buttons: true });
  fake.log.messages.clear();
  await closeSignups(ctx, 2026);
  expect(getSignupState().closed).toBe(true);
  // Closing a year with no message at all closes it too.
  resetWrappedTables();
  await closeSignups(ctx, 2026);
  expect(signupsClosed()).toBe(true);
});

test("/wrapped signups posts, closes and reopens", async () => {
  setConfig({ announcementChannelId: "ann" });
  const fake = fakeClient();
  const posted = await slash("signups", "admin", { admin: true, action: "post", fake });
  expect(textOf(posted.replies[0]!)).toContain("sign-up posted");
  const closed = await slash("signups", "admin", { admin: true, action: "close", fake });
  expect(textOf(closed.replies[0]!)).toContain("sign-ups closed");
  expect(signupsClosed()).toBe(true);
  const reopened = await slash("signups", "admin", { admin: true, action: "reopen", fake });
  expect(textOf(reopened.replies[0]!)).toContain("sign-ups open");
  expect(signupsClosed()).toBe(false);
});

test("slow admin subcommands defer first and answer through editReply; fast ones reply directly", async () => {
  recordMessage(msg("u1", at("2026-06-01T12:00:00Z")));
  setConfig({ announcementChannelId: "ann" });
  const order: string[] = [];
  const fake = fakeClient({ onChannelFetch: () => order.push("channels.fetch") });
  await slash("start", "admin", { admin: true, year: 2026, fake });
  await waitForWrappedRun();

  order.length = 0;
  const announced = await slash("announce", "admin", { admin: true, fake, order });
  expect(order[0]).toBe("deferReply");
  expect(order).toContain("channels.fetch");
  expect(order.indexOf("channels.fetch")).toBeGreaterThan(0);
  expect(order[order.length - 1]).toBe("editReply");
  expect(order).not.toContain("reply");
  expect(textOf(announced.replies[0]!)).toContain("announced");

  for (const sub of ["start", "send", "signups", "resume"]) {
    const run = await slash(sub, "admin", { admin: true, action: "close", fake });
    expect(run.order[0]).toBe("deferReply");
    expect(run.order[run.order.length - 1]).toBe("editReply");
    await waitForWrappedRun();
  }

  const status = await slash("status", "admin", { admin: true });
  expect(status.order).toEqual(["reply"]);
});

test("/wrapped announce says when the post failed, and no-channel only when none is set", async () => {
  recordMessage(msg("u1", at("2026-06-01T12:00:00Z")));
  const fake = fakeClient({ failPosts: ["ann"] });
  await slash("start", "admin", { admin: true, year: 2026, fake });
  await waitForWrappedRun();

  const unset = await slash("announce", "admin", { admin: true, fake });
  expect(textOf(unset.replies[0]!)).toContain("no announcement channel");
  setConfig({ announcementChannelId: "ann" });
  const failed = await slash("announce", "admin", { admin: true, fake });
  expect(textOf(failed.replies[0]!)).toContain("announcement failed");
});
