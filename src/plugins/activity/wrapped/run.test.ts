import { afterAll, afterEach, beforeAll, beforeEach, expect, spyOn, test } from "bun:test";
import { and, eq } from "drizzle-orm";
import { db, initDb, schema } from "../../../db/index.ts";
import { env } from "../../../config/env.ts";
import { nowSec } from "../../../core/util.ts";
import { recordMembership, recordMessage } from "../record.ts";
import plugin from "../index.ts";
import { wrappedCommands } from "./commands.ts";
import * as dataModule from "./data.ts";
import { buildWrapped } from "./data.ts";
import { wrappedListeners } from "./listeners.ts";
import { getLinkByToken, linkUrl, upsertWrappedLink } from "./links.ts";
import { setOptIn } from "./optin.ts";
import {
  getWrappedStatus,
  postAnnouncement,
  resendWrappedDm,
  resumeWrappedRun,
  startWrappedRun,
  startWrappedSend,
  waitForWrappedRun,
  wrappedRunTiming,
} from "./run.ts";
import type { WrappedRunStatus } from "./run.ts";
import type { FakeClientLog } from "./testing.ts";
import { allButtons, allStrings, at, fakeClient, fakeCtx, msg, resetWrappedTables, setConfig } from "./testing.ts";

const YEAR = 2026;

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

/** Give each user one message in 2026. */
function active(...userIds: string[]) {
  for (const userId of userIds) recordMessage(msg(userId, at("2026-06-01T12:00:00Z")));
}

/** Every link row of 2026, by user id. */
function links() {
  const rows = db
    .select()
    .from(schema.activityWrappedLinks)
    .where(eq(schema.activityWrappedLinks.year, YEAR))
    .all();
  return new Map(rows.map((r) => [r.userId, r]));
}

/** DMs to members (the starter's `wrapped.processed` DM to "admin" left out). */
function memberDms(log: FakeClientLog) {
  return log.dms.filter((d) => d.userId !== "admin");
}

/** Process the year and wait. */
async function processYear(ctx: ReturnType<typeof fakeCtx>) {
  expect(startWrappedRun(ctx, { year: YEAR, startedBy: "admin" })).toBe("started");
  await waitForWrappedRun();
  return getWrappedStatus();
}

/** Send the DMs (no announcement unless asked) and wait. */
async function sendYear(ctx: ReturnType<typeof fakeCtx>, announce = false) {
  expect(startWrappedSend(ctx, { startedBy: "admin", announce })).toBe("started");
  await waitForWrappedRun();
  return getWrappedStatus();
}

/** Process, then send. */
async function run(ctx: ReturnType<typeof fakeCtx>) {
  await processYear(ctx);
  return sendYear(ctx);
}

test("with no run the status is idle", () => {
  expect(getWrappedStatus()).toEqual({
    id: null,
    year: null,
    status: "idle",
    total: 0,
    processed: 0,
    sent: 0,
    failed: 0,
    skipped: 0,
    optedIn: 0,
    startedAt: null,
    finishedAt: null,
    announce: false,
    announcedAt: null,
    buildFailed: 0,
    error: null,
  });
});

test("processing alone sends no member DM and no announcement, and ends processed", async () => {
  active("u1", "u2");
  setOptIn("u1", true);
  setConfig({ announcementChannelId: "ann", modLogChannelId: "modlog" });
  const { client, log } = fakeClient();
  const status = await processYear(fakeCtx(client));
  expect(status.status).toBe("processed");
  expect(memberDms(log)).toEqual([]);
  expect(log.posts).toEqual([]);
  expect(status.announcedAt).toBeNull();
  expect(links().size).toBe(2);
});

test("the starter gets exactly one wrapped.processed DM with a dashboard button", async () => {
  active("u1", "u2");
  setOptIn("u1", true);
  const { client, log } = fakeClient();
  await processYear(fakeCtx(client));
  const mine = log.dms.filter((d) => d.userId === "admin");
  expect(mine.length).toBe(1);
  const text = allStrings(mine[0]!.payload.components).join("\n");
  expect(text).toContain("processing is done");
  expect(text).toContain("» 2026: 2 envelopes made, 1 members opted in");
  expect(allButtons(mine[0]!.payload.components).map((b) => [b.label, b.url])).toEqual([
    ["open the dashboard", `${env.PUBLIC_URL}/#/activity-admin`],
  ]);
});

test("a failing starter DM falls back to the mod-log card and never fails the run", async () => {
  active("u1");
  setConfig({ modLogChannelId: "modlog" });
  const { client, log } = fakeClient({ closedDms: ["admin"] });
  const status = await processYear(fakeCtx(client));
  expect(status.status).toBe("processed");
  expect(log.posts.map((p) => p.channelId)).toEqual(["modlog"]);
  expect(allStrings(log.posts[0]!.payload.components).join("\n")).toContain("processing is done");

  // Without a mod-log channel too, nothing is posted and the run still ends processed.
  resetWrappedTables();
  active("u1");
  const quiet = fakeClient({ closedDms: ["admin"] });
  expect((await processYear(fakeCtx(quiet.client))).status).toBe("processed");
  expect(quiet.log.posts).toEqual([]);
});

test("a run makes one link per member with activity, none for the inactive or those who left", async () => {
  active("u1", "u2", "u3");
  recordMembership("u3", "join", at("2026-01-01T00:00:00Z"));
  recordMembership("u3", "leave", at("2026-07-01T00:00:00Z"));
  // Joined again after leaving: still a member.
  active("u4");
  recordMembership("u4", "leave", at("2026-02-01T00:00:00Z"));
  recordMembership("u4", "join", at("2026-03-01T00:00:00Z"));
  recordMessage(msg("u5", at("2025-06-01T12:00:00Z")));

  const { client } = fakeClient();
  const status = await processYear(fakeCtx(client));

  const rows = links();
  expect([...rows.keys()].sort()).toEqual(["u1", "u2", "u4"]);
  for (const row of rows.values()) expect(row.token.length).toBeGreaterThanOrEqual(43);
  expect(status.total).toBe(3);
  expect(status.processed).toBe(3);
});

test("processing twice keeps every token and refreshes the snapshot", async () => {
  active("u1", "u2");
  const { client } = fakeClient();
  await processYear(fakeCtx(client));
  const before = links();

  recordMessage(msg("u1", at("2026-06-02T12:00:00Z")));
  await processYear(fakeCtx(client));
  const after = links();

  expect(after.get("u1")!.token).toBe(before.get("u1")!.token);
  expect(after.get("u2")!.token).toBe(before.get("u2")!.token);
  expect(getLinkByToken(after.get("u1")!.token)!.data.messages).toBe(2);
});

test("status counts processed up to total, then sent; a second start is already-running", async () => {
  active("u1", "u2", "u3");
  for (const u of ["u1", "u2", "u3"]) setOptIn(u, true);
  const seen: WrappedRunStatus[] = [];
  const { client, log } = fakeClient({ onDm: (id) => id !== "admin" && seen.push(getWrappedStatus()) });
  const ctx = fakeCtx(client);

  expect(startWrappedRun(ctx, { year: YEAR, startedBy: "admin" })).toBe("started");
  expect(startWrappedRun(ctx, { year: YEAR, startedBy: "admin" })).toBe("already-running");
  expect(startWrappedSend(ctx, { startedBy: "admin" })).toBe("already-running");
  const first = getWrappedStatus();
  expect(first.status).toBe("processing");
  expect(first.total).toBe(3);

  const processed: number[] = [];
  const done = waitForWrappedRun();
  let finished = false;
  void done.then(() => (finished = true));
  while (!finished) {
    const s = getWrappedStatus();
    if (s.status === "processing") processed.push(s.processed);
    await new Promise((r) => setTimeout(r, 0));
  }
  expect(processed.length).toBeGreaterThan(0);
  for (let i = 1; i < processed.length; i++) expect(processed[i]!).toBeGreaterThanOrEqual(processed[i - 1]!);

  await sendYear(ctx);
  expect(seen.map((s) => s.status)).toEqual(["sending", "sending", "sending"]);
  expect(seen.map((s) => s.processed)).toEqual([3, 3, 3]);
  expect(seen.map((s) => s.sent)).toEqual([0, 1, 2]);

  const end = getWrappedStatus();
  expect(end.status).toBe("done");
  expect(end.sent).toBe(3);
  expect(end.finishedAt).not.toBeNull();
  expect(memberDms(log).length).toBe(3);
});

test("startWrappedSend before processing is not-processed", async () => {
  const { client } = fakeClient();
  expect(startWrappedSend(fakeCtx(client), { startedBy: "admin" })).toBe("not-processed");
});

test("a 50007 DM error marks that link failed, the others sent, and the send still ends done", async () => {
  active("u1", "u2", "u3");
  for (const u of ["u1", "u2", "u3"]) setOptIn(u, true);
  const { client, log } = fakeClient({ closedDms: ["u2"] });
  const status = await run(fakeCtx(client));

  expect(status.status).toBe("done");
  expect(status.sent).toBe(2);
  expect(status.failed).toBe(1);
  const rows = links();
  expect(rows.get("u1")!.dmStatus).toBe("sent");
  expect(rows.get("u2")!.dmStatus).toBe("failed");
  expect(rows.get("u3")!.dmStatus).toBe("sent");
  // A failed DM sends nothing else.
  expect(memberDms(log).map((d) => d.userId).sort()).toEqual(["u1", "u3"]);
});

test("a second send reaches a member who opted in meanwhile and retries failed links, never re-sending sent ones", async () => {
  active("u1", "u2", "u3");
  setOptIn("u1", true);
  setOptIn("u2", true);
  const closed = fakeClient({ closedDms: ["u2"] });
  await run(fakeCtx(closed.client));
  expect(memberDms(closed.log).map((d) => d.userId)).toEqual(["u1"]);
  expect(links().get("u3")!.dmStatus).toBe("skipped");

  setOptIn("u3", true);
  const open = fakeClient();
  const status = await sendYear(fakeCtx(open.client));
  expect(memberDms(open.log).map((d) => d.userId)).toEqual(["u2", "u3"]);
  expect(status.status).toBe("done");
  expect(status.sent).toBe(3);
  expect(status.failed).toBe(0);
});

test("resendWrappedDm retries a failed link", async () => {
  active("u1");
  setOptIn("u1", true);
  const closed = fakeClient({ closedDms: ["u1"] });
  await run(fakeCtx(closed.client));
  expect(links().get("u1")!.dmStatus).toBe("failed");

  const open = fakeClient();
  expect(await resendWrappedDm(fakeCtx(open.client), "u1", YEAR)).toBe("sent");
  expect(links().get("u1")!.dmStatus).toBe("sent");
  expect(open.log.dms.length).toBe(1);
  const status = getWrappedStatus();
  expect(status.sent).toBe(1);
  expect(status.failed).toBe(0);

  expect(await resendWrappedDm(fakeCtx(open.client), "nobody", YEAR)).toBe("no-link");
});

test("resendWrappedDm refuses a member who has not opted in", async () => {
  active("u1");
  const { client, log } = fakeClient();
  await run(fakeCtx(client));
  expect(memberDms(log).length).toBe(0);
  expect(await resendWrappedDm(fakeCtx(client), "u1", YEAR)).toBe("not-opted-in");
  expect(memberDms(log).length).toBe(0);
  expect(links().get("u1")!.dmStatus).toBe("skipped");
});

test("resendWrappedDm refuses a link already sent, and the sent counter never counts twice", async () => {
  active("u1");
  setOptIn("u1", true);
  const { client, log } = fakeClient();
  await run(fakeCtx(client));
  expect(getWrappedStatus().sent).toBe(1);
  expect(await resendWrappedDm(fakeCtx(client), "u1", YEAR)).toBe("already-sent");
  expect(memberDms(log).length).toBe(1);
  expect(getWrappedStatus().sent).toBe(1);
});

test("resendWrappedDm refuses a member who left", async () => {
  active("u1");
  setOptIn("u1", true);
  const closed = fakeClient({ closedDms: ["u1"] });
  await run(fakeCtx(closed.client));
  recordMembership("u1", "leave", nowSec());
  const open = fakeClient();
  expect(await resendWrappedDm(fakeCtx(open.client), "u1", YEAR)).toBe("left");
  expect(open.log.dms.length).toBe(0);
});

test("resendWrappedDm refuses while a send is running for the year", async () => {
  active("u1", "u2");
  setOptIn("u1", true);
  setOptIn("u2", true);
  const closed = fakeClient({ closedDms: ["u1"] });
  await run(fakeCtx(closed.client));
  expect(links().get("u1")!.dmStatus).toBe("failed");
  // A second send is running when the resend is asked for.
  const slow = fakeClient();
  const ctx = fakeCtx(slow.client);
  expect(startWrappedSend(ctx, { startedBy: "admin", announce: false })).toBe("started");
  expect(await resendWrappedDm(ctx, "u1", YEAR)).toBe("sending");
  await waitForWrappedRun();
  expect(memberDms(slow.log).map((d) => d.userId)).toEqual(["u1"]);
});

test("sendLinks re-reads each link: one flipped to sent mid-loop is skipped and not counted", async () => {
  active("u1", "u2", "u3");
  for (const u of ["u1", "u2", "u3"]) setOptIn(u, true);
  const { client: first } = fakeClient();
  await processYear(fakeCtx(first));
  const flip = (userId: string) =>
    db.update(schema.activityWrappedLinks)
      .set({ dmStatus: "sent" })
      .where(and(eq(schema.activityWrappedLinks.userId, userId), eq(schema.activityWrappedLinks.year, YEAR)))
      .run();
  // While u1's DM goes out, u2's link is marked sent elsewhere.
  const { client, log } = fakeClient({ onDm: (id) => id === "u1" && flip("u2") });
  const status = await sendYear(fakeCtx(client));
  expect(memberDms(log).map((d) => d.userId)).toEqual(["u1", "u3"]);
  // The counter is the number of sent links: u2 once, never twice.
  expect(status.sent).toBe(3);
  expect(links().get("u2")!.dmStatus).toBe("sent");
});

/** A snapshot marker: a link holding it was not rebuilt. */
const UNTOUCHED = 999;

/**
 * Insert an interrupted processing run (last updated 121 s ago) and, for each
 * of `processedUserIds`, a link this run already processed, holding the
 * {@link UNTOUCHED} marker.
 */
function interruptedRun(opts: { total: number; processedUserIds: string[] }): number {
  const stale = nowSec() - 121;
  const id = db
    .insert(schema.activityWrappedRuns)
    .values({
      year: YEAR,
      status: "processing",
      total: opts.total,
      processed: opts.processedUserIds.length,
      startedBy: "admin",
      startedAt: stale,
      updatedAt: stale,
    })
    .returning({ id: schema.activityWrappedRuns.id })
    .get().id;
  for (const userId of opts.processedUserIds) {
    upsertWrappedLink(userId, YEAR, { ...buildWrapped(userId, YEAR)!, messages: UNTOUCHED }, id);
  }
  return id;
}

/** The `messages` number in a member's stored snapshot. */
function storedMessages(userId: string): number {
  return (JSON.parse(links().get(userId)!.data) as { messages: number }).messages;
}

test("a run not updated for 121 seconds is interrupted; resume completes only the unprocessed members", async () => {
  active("u1", "u2", "u3");
  const id = interruptedRun({ total: 3, processedUserIds: ["u1"] });
  expect(getWrappedStatus().status).toBe("interrupted");

  const { client, log } = fakeClient();
  expect(resumeWrappedRun(fakeCtx(client))).toBe("resumed");
  await waitForWrappedRun();

  // u1 was processed before the interruption and is not processed twice.
  expect(storedMessages("u1")).toBe(UNTOUCHED);
  expect(storedMessages("u2")).toBe(1);
  expect(storedMessages("u3")).toBe(1);
  for (const row of links().values()) expect(row.processedRunId).toBe(id);
  const status = getWrappedStatus();
  expect(status.status).toBe("processed");
  expect(status.processed).toBe(3);
  expect(status.total).toBe(3);
  // A resumed processing step sends nothing to members either.
  expect(memberDms(log)).toEqual([]);
  expect(resumeWrappedRun(fakeCtx(client))).toBe("nothing-to-resume");
});

test("resume processes a member who became active meanwhile, even one sorting earlier", async () => {
  active("a", "c", "d");
  interruptedRun({ total: 3, processedUserIds: ["a", "c"] });
  // b becomes active while the run is down; by position it would land on index 1.
  active("b");

  const { client } = fakeClient();
  expect(resumeWrappedRun(fakeCtx(client))).toBe("resumed");
  await waitForWrappedRun();

  expect([...links().keys()].sort()).toEqual(["a", "b", "c", "d"]);
  expect(storedMessages("a")).toBe(UNTOUCHED);
  expect(storedMessages("c")).toBe(UNTOUCHED);
  expect(storedMessages("b")).toBe(1);
  expect(storedMessages("d")).toBe(1);
  const status = getWrappedStatus();
  expect(status.processed).toBe(4);
  expect(status.total).toBe(4);
});

test("resume leaves out a member who left meanwhile without shifting anyone", async () => {
  active("a", "c", "d");
  interruptedRun({ total: 3, processedUserIds: ["a"] });
  recordMembership("c", "leave", nowSec());

  const { client } = fakeClient();
  expect(resumeWrappedRun(fakeCtx(client))).toBe("resumed");
  await waitForWrappedRun();

  expect([...links().keys()].sort()).toEqual(["a", "d"]);
  expect(storedMessages("d")).toBe(1);
  const status = getWrappedStatus();
  expect(status.status).toBe("processed");
  expect(status.processed).toBe(2);
  // The total is never rewritten to a smaller number.
  expect(status.total).toBe(3);
});

test("a run updated 119 seconds ago is still running and cannot be resumed", () => {
  const recent = nowSec() - 119;
  db.insert(schema.activityWrappedRuns)
    .values({ year: YEAR, status: "sending", total: 3, processed: 3, startedBy: "admin", startedAt: recent, updatedAt: recent })
    .run();
  expect(getWrappedStatus().status).toBe("sending");
  const { client } = fakeClient();
  expect(resumeWrappedRun(fakeCtx(client))).toBe("nothing-to-resume");
});

test("resuming an interrupted send continues only the unsent DMs, and announces once", async () => {
  active("u1", "u2", "u3");
  for (const u of ["u1", "u2", "u3"]) setOptIn(u, true);
  setConfig({ announcementChannelId: "ann" });
  const { client: first } = fakeClient();
  await processYear(fakeCtx(first));
  // Pretend u1 was DM'd before the bot stopped in the middle of an announcing send.
  db.update(schema.activityWrappedLinks)
    .set({ dmStatus: "sent" })
    .where(and(eq(schema.activityWrappedLinks.userId, "u1"), eq(schema.activityWrappedLinks.year, YEAR)))
    .run();
  const stale = nowSec() - 300;
  db.update(schema.activityWrappedRuns).set({ status: "sending", announce: 1, sent: 1, updatedAt: stale, finishedAt: null }).run();
  expect(getWrappedStatus().status).toBe("interrupted");

  const { client, log } = fakeClient();
  expect(resumeWrappedRun(fakeCtx(client))).toBe("resumed");
  await waitForWrappedRun();
  expect(memberDms(log).map((d) => d.userId).sort()).toEqual(["u2", "u3"]);
  expect(getWrappedStatus().sent).toBe(3);
  expect(log.posts.filter((p) => p.channelId === "ann").length).toBe(1);

  // Another send asking to announce does not announce the year again.
  const again = fakeClient();
  await sendYear(fakeCtx(again.client), true);
  expect(again.log.posts.filter((p) => p.channelId === "ann").length).toBe(0);
});

test("announce on posts wrapped.announce once; announce off posts nothing; postAnnouncement twice is already-announced", async () => {
  active("u1");
  setConfig({ announcementChannelId: "ann" });
  const off = fakeClient();
  await processYear(fakeCtx(off.client));
  await sendYear(fakeCtx(off.client), false);
  expect(off.log.posts.length).toBe(0);
  expect(getWrappedStatus().announcedAt).toBeNull();

  const on = fakeClient();
  await sendYear(fakeCtx(on.client), true);
  expect(on.log.posts.filter((p) => p.channelId === "ann").length).toBe(1);
  expect(getWrappedStatus().announcedAt).not.toBeNull();
  expect(await postAnnouncement(fakeCtx(on.client), YEAR)).toBe("already-announced");
  expect(on.log.posts.length).toBe(1);
});

test("postAnnouncement: not-processed before processing, no-channel without a channel", async () => {
  const { client } = fakeClient();
  expect(await postAnnouncement(fakeCtx(client), YEAR)).toBe("not-processed");
  active("u1");
  await processYear(fakeCtx(client));
  expect(await postAnnouncement(fakeCtx(client), YEAR)).toBe("no-channel");
  setConfig({ announcementChannelId: "ann" });
  expect(await postAnnouncement(fakeCtx(client), YEAR)).toBe("posted");
  expect(await postAnnouncement(fakeCtx(client), YEAR)).toBe("already-announced");
});

test("nothing is automatic: the plugin has no wrapped schedule and loading it sends nothing", async () => {
  const { client, log } = fakeClient();
  active("u1");
  setOptIn("u1", true);
  for (const s of plugin.schedules ?? []) expect(s.name.toLowerCase()).not.toContain("wrapped");
  // Booting: the wrapped listeners only react to button clicks.
  for (const l of wrappedListeners) {
    expect(l.event as string).toBe("interactionCreate");
    expect(l.once ?? false).toBe(false);
  }
  expect(wrappedCommands.length).toBe(1);
  await new Promise((r) => setTimeout(r, 10));
  expect(getWrappedStatus().status).toBe("idle");
  expect(links().size).toBe(0);
  expect(log.dms.length).toBe(0);
  expect(log.posts.length).toBe(0);
});

test("with 3 members active and 1 opted in: 3 links, 1 DM, skipped 2", async () => {
  active("u1", "u2", "u3");
  setOptIn("u2", true);
  const { client, log } = fakeClient();
  const status = await run(fakeCtx(client));
  expect(links().size).toBe(3);
  expect(memberDms(log).map((d) => d.userId)).toEqual(["u2"]);
  expect(status.sent).toBe(1);
  expect(status.skipped).toBe(2);
  expect(status.optedIn).toBe(1);
  expect(links().get("u1")!.dmStatus).toBe("skipped");
});

test("with nobody opted in a send sends no DM and still ends done", async () => {
  active("u1", "u2");
  const { client, log } = fakeClient();
  const status = await run(fakeCtx(client));
  expect(memberDms(log).length).toBe(0);
  expect(status.status).toBe("done");
  expect(status.skipped).toBe(2);
});

test("opting out after opting in stops the next send's DM", async () => {
  active("u1");
  setOptIn("u1", true);
  setOptIn("u1", false);
  const { client, log } = fakeClient();
  await run(fakeCtx(client));
  expect(memberDms(log).length).toBe(0);
});

test("the DM carries a link button to the member's own link, and the banner", async () => {
  active("u1");
  setOptIn("u1", true);
  const { client, log } = fakeClient();
  await run(fakeCtx(client));
  const dm = memberDms(log)[0]!;
  const token = links().get("u1")!.token;
  const buttons = allButtons(dm.payload.components);
  expect(buttons.length).toBe(1);
  expect(buttons[0]!.url).toBe(linkUrl(token));
  expect(allStrings(dm.payload.components).join("\n")).toContain("your 2026 is ready");
  const files = dm.payload.files as { name?: string }[] | undefined;
  expect(files?.map((f) => f.name)).toEqual(["wrapped-banner.png"]);
  expect(allStrings(dm.payload.components)).toContain("attachment://wrapped-banner.png");
});

test("an edited wrapped.dm override wins over the default", async () => {
  db.insert(schema.botMessages)
    .values({
      key: "wrapped.dm",
      components: [{ type: 17, components: [{ type: 10, content: "custom {year} at {url}" }] }],
      updatedAt: nowSec(),
    })
    .run();
  active("u1");
  setOptIn("u1", true);
  const { client, log } = fakeClient();
  await run(fakeCtx(client));
  const token = links().get("u1")!.token;
  expect(allStrings(memberDms(log)[0]!.payload.components)).toContain(`custom 2026 at ${linkUrl(token)}`);
});

test("a finished send posts exactly one wrapped.run-finished to the mod-log channel", async () => {
  active("u1", "u2");
  setOptIn("u1", true);
  const { client, log } = fakeClient();
  await processYear(fakeCtx(client));
  setConfig({ modLogChannelId: "modlog" });
  await sendYear(fakeCtx(client));
  expect(log.posts.length).toBe(1);
  expect(log.posts[0]!.channelId).toBe("modlog");
  const text = allStrings(log.posts[0]!.payload.components).join("\n");
  expect(text).toContain("wrapped dms finished");
  expect(text).toContain("» 2026, started by <@admin>");
  expect(text).toContain("» 1 sent, 0 failed, 1 not opted in");
  expect(text).toContain("» not announced.");
});

test("no mod-log post when the channel is unset", async () => {
  active("u1");
  const { client, log } = fakeClient();
  await run(fakeCtx(client));
  expect(log.posts.length).toBe(0);
});

test("a failed send can be retried when processing had completed, not before", async () => {
  active("u1", "u2");
  setOptIn("u1", true);
  const { client, log } = fakeClient();
  await processYear(fakeCtx(client));
  // The send step crashed: the run ended failed with every member processed.
  db.update(schema.activityWrappedRuns).set({ status: "failed", finishedAt: nowSec() }).run();
  expect(startWrappedSend(fakeCtx(client), { startedBy: "admin", announce: false })).toBe("started");
  await waitForWrappedRun();
  expect(memberDms(log).map((d) => d.userId)).toEqual(["u1"]);
  expect(getWrappedStatus().status).toBe("done");

  // Processing itself failed half way: the send is refused.
  db.update(schema.activityWrappedRuns).set({ status: "failed", processed: 1, total: 2 }).run();
  expect(startWrappedSend(fakeCtx(client), { startedBy: "admin" })).toBe("not-processed");
});

test("leavers: members missing from the live guild get no link and do not count in the total", async () => {
  active("u1", "u2", "u3");
  // u3 left before capture started, so the membership table never saw it.
  const { client } = fakeClient({ guildMembers: ["u1", "u2"] });
  const status = await processYear(fakeCtx(client));
  expect([...links().keys()].sort()).toEqual(["u1", "u2"]);
  expect(status.total).toBe(2);
  expect(status.processed).toBe(2);
  expect(status.error).toBeNull();
});

test("leavers: a failed member fetch falls back to the membership table and says so", async () => {
  active("u1", "u2");
  recordMembership("u2", "leave", at("2026-07-01T00:00:00Z"));
  const { client } = fakeClient({ guildMembers: "fail" });
  const status = await processYear(fakeCtx(client));
  expect(status.status).toBe("processed");
  expect([...links().keys()]).toEqual(["u1"]);
  expect(status.error).toContain("membership table");
});

test("one member's snapshot throwing is counted and processing carries on", async () => {
  active("u1", "u2", "u3");
  const real = dataModule.buildWrapped;
  const spy = spyOn(dataModule, "buildWrapped").mockImplementation((userId, year, shared) => {
    if (userId === "u2") throw new Error("boom for u2");
    return real(userId, year, shared);
  });
  try {
    const { client } = fakeClient({ guildMembers: ["u1", "u2", "u3"] });
    const status = await processYear(fakeCtx(client));
    expect(status.status).toBe("processed");
    expect(status.buildFailed).toBe(1);
    expect(status.error).toContain("boom for u2");
    expect(status.processed).toBe(3);
    expect([...links().keys()].sort()).toEqual(["u1", "u3"]);
  } finally {
    spy.mockRestore();
  }
});

test("circuit breaker: five server errors in a row stop the send, the rest stay pending", async () => {
  const users = ["u1", "u2", "u3", "u4", "u5", "u6", "u7"];
  active(...users);
  for (const u of users) setOptIn(u, true);
  const { client: first } = fakeClient();
  await processYear(fakeCtx(first));
  const broken = fakeClient({ failDms: users });
  const status = await sendYear(fakeCtx(broken.client));
  expect(status.status).toBe("failed");
  expect(status.error).toContain("5 dms in a row");
  const rows = links();
  expect(users.filter((u) => rows.get(u)!.dmStatus === "failed")).toEqual(["u1", "u2", "u3", "u4", "u5"]);
  expect(users.filter((u) => rows.get(u)!.dmStatus === "pending")).toEqual(["u6", "u7"]);

  // The send can be retried: every link goes out.
  const ok = fakeClient();
  const again = await sendYear(fakeCtx(ok.client));
  expect(again.status).toBe("done");
  expect(memberDms(ok.log).map((d) => d.userId)).toEqual(users);
  expect(again.error).toBeNull();
});

test("circuit breaker: closed DMs never trip it", async () => {
  const users = ["u1", "u2", "u3", "u4", "u5", "u6"];
  active(...users);
  for (const u of users) setOptIn(u, true);
  const { client } = fakeClient({ closedDms: users });
  const status = await run(fakeCtx(client));
  expect(status.status).toBe("done");
  expect(status.failed).toBe(6);
});

test("re-processing never changes a sent link's snapshot; unsent links are rebuilt", async () => {
  active("u1", "u2");
  setOptIn("u1", true);
  const { client } = fakeClient();
  await run(fakeCtx(client));
  expect(links().get("u1")!.dmStatus).toBe("sent");
  const sentData = links().get("u1")!.data;

  recordMessage(msg("u1", at("2026-06-03T12:00:00Z")));
  recordMessage(msg("u2", at("2026-06-03T12:00:00Z")));
  const status = await processYear(fakeCtx(client));
  expect(status.processed).toBe(2);
  expect(links().get("u1")!.data).toBe(sentData);
  expect(storedMessages("u2")).toBe(2);
});

test("re-processing leaves the server snapshot alone once it was announced", async () => {
  active("u1");
  setConfig({ announcementChannelId: "ann" });
  const { client } = fakeClient();
  await processYear(fakeCtx(client));
  expect(await postAnnouncement(fakeCtx(client), YEAR)).toBe("posted");
  const before = db.select().from(schema.activityWrappedServer).get()!.data;
  recordMessage(msg("u1", at("2026-06-03T12:00:00Z")));
  await processYear(fakeCtx(client));
  expect(db.select().from(schema.activityWrappedServer).get()!.data).toBe(before);
});
