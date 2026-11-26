import { afterAll, afterEach, beforeAll, beforeEach, expect, test } from "bun:test";
import { and, eq } from "drizzle-orm";
import { db, initDb, schema } from "../../../db/index.ts";
import { nowSec } from "../../../core/util.ts";
import { recordMembership, recordMessage } from "../record.ts";
import plugin from "../index.ts";
import { wrappedCommands } from "./commands.ts";
import { wrappedListeners } from "./listeners.ts";
import { buildWrapped } from "./data.ts";
import { getLinkByToken, linkUrl, upsertWrappedLink } from "./links.ts";
import { setOptIn } from "./optin.ts";
import {
  getWrappedStatus,
  resendWrappedDm,
  resumeWrappedRun,
  runSendsDms,
  startWrappedRun,
  waitForWrappedRun,
  wrappedRunTiming,
} from "./run.ts";
import type { WrappedRunStatus } from "./run.ts";
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

/** Start a run and wait for it to finish. */
async function run(ctx: ReturnType<typeof fakeCtx>, sendDms = true) {
  expect(startWrappedRun(ctx, { year: YEAR, startedBy: "admin", sendDms })).toBe("started");
  await waitForWrappedRun();
  return getWrappedStatus();
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
  });
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
  const status = await run(fakeCtx(client), false);

  const rows = links();
  expect([...rows.keys()].sort()).toEqual(["u1", "u2", "u4"]);
  for (const row of rows.values()) expect(row.token.length).toBeGreaterThanOrEqual(43);
  expect(status.status).toBe("done");
  expect(status.total).toBe(3);
  expect(status.processed).toBe(3);
});

test("running twice keeps every token and refreshes the snapshot", async () => {
  active("u1", "u2");
  const { client } = fakeClient();
  await run(fakeCtx(client), false);
  const before = links();

  recordMessage(msg("u1", at("2026-06-02T12:00:00Z")));
  await run(fakeCtx(client), false);
  const after = links();

  expect(after.get("u1")!.token).toBe(before.get("u1")!.token);
  expect(after.get("u2")!.token).toBe(before.get("u2")!.token);
  expect(getLinkByToken(after.get("u1")!.token)!.data.messages).toBe(2);
});

test("status counts processed up to total, then sent; a second start is already-running", async () => {
  active("u1", "u2", "u3");
  for (const u of ["u1", "u2", "u3"]) setOptIn(u, true);
  const seen: WrappedRunStatus[] = [];
  const { client, log } = fakeClient({ onDm: () => seen.push(getWrappedStatus()) });
  const ctx = fakeCtx(client);

  expect(startWrappedRun(ctx, { year: YEAR, startedBy: "admin", sendDms: true })).toBe("started");
  expect(startWrappedRun(ctx, { year: YEAR, startedBy: "admin", sendDms: true })).toBe("already-running");
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
  expect(seen.map((s) => s.status)).toEqual(["sending", "sending", "sending"]);
  expect(seen.map((s) => s.processed)).toEqual([3, 3, 3]);
  expect(seen.map((s) => s.sent)).toEqual([0, 1, 2]);

  const end = getWrappedStatus();
  expect(end.status).toBe("done");
  expect(end.sent).toBe(3);
  expect(end.finishedAt).not.toBeNull();
  expect(log.dms.length).toBe(3);
});

test("with sendDms false no DM is attempted and the run ends done with sent 0", async () => {
  active("u1", "u2");
  setOptIn("u1", true);
  const { client, log } = fakeClient();
  const status = await run(fakeCtx(client), false);
  expect(status.status).toBe("done");
  expect(status.sent).toBe(0);
  expect(log.dms.length).toBe(0);
  expect(links().get("u1")!.dmStatus).toBe("pending");
});

test("a 50007 DM error marks that link failed, the others sent, and the run still ends done", async () => {
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
  expect(log.dms.map((d) => d.userId).sort()).toEqual(["u1", "u3"]);
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

test("resendWrappedDm sends to a member who has not opted in when an admin asks", async () => {
  active("u1");
  const { client, log } = fakeClient();
  await run(fakeCtx(client));
  expect(log.dms.length).toBe(0);
  expect(await resendWrappedDm(fakeCtx(client), "u1", YEAR)).toBe("sent");
  expect(log.dms.length).toBe(1);
});

/** A snapshot marker: a link holding it was not rebuilt. */
const UNTOUCHED = 999;

/**
 * Insert an interrupted processing run (last updated 121 s ago) and, for each
 * of `processedUserIds`, a link this run already processed, holding the
 * {@link UNTOUCHED} marker.
 */
function interruptedRun(opts: { total: number; processedUserIds: string[]; sendDms?: boolean }): number {
  const stale = nowSec() - 121;
  const id = db
    .insert(schema.activityWrappedRuns)
    .values({
      year: YEAR,
      status: "processing",
      total: opts.total,
      processed: opts.processedUserIds.length,
      sendDms: opts.sendDms === false ? 0 : 1,
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
  const id = interruptedRun({ total: 3, processedUserIds: ["u1"], sendDms: false });
  expect(getWrappedStatus().status).toBe("interrupted");

  const { client } = fakeClient();
  expect(resumeWrappedRun(fakeCtx(client))).toBe("resumed");
  await waitForWrappedRun();

  // u1 was processed before the interruption and is not processed twice.
  expect(storedMessages("u1")).toBe(UNTOUCHED);
  expect(storedMessages("u2")).toBe(1);
  expect(storedMessages("u3")).toBe(1);
  for (const row of links().values()) expect(row.processedRunId).toBe(id);
  const status = getWrappedStatus();
  expect(status.status).toBe("done");
  expect(status.processed).toBe(3);
  expect(status.total).toBe(3);
  expect(resumeWrappedRun(fakeCtx(client))).toBe("nothing-to-resume");
});

test("resume processes a member who became active meanwhile, even one sorting earlier", async () => {
  active("a", "c", "d");
  interruptedRun({ total: 3, processedUserIds: ["a", "c"], sendDms: false });
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
  interruptedRun({ total: 3, processedUserIds: ["a"], sendDms: false });
  recordMembership("c", "leave", nowSec());

  const { client } = fakeClient();
  expect(resumeWrappedRun(fakeCtx(client))).toBe("resumed");
  await waitForWrappedRun();

  expect([...links().keys()].sort()).toEqual(["a", "d"]);
  expect(storedMessages("d")).toBe(1);
  const status = getWrappedStatus();
  expect(status.status).toBe("done");
  expect(status.processed).toBe(2);
  // The total is never rewritten to a smaller number.
  expect(status.total).toBe(3);
});

test("a resumed processing run keeps the run's sendDms choice", async () => {
  active("u1", "u2");
  setOptIn("u1", true);
  setOptIn("u2", true);
  interruptedRun({ total: 2, processedUserIds: ["u1"], sendDms: true });
  const sending = fakeClient();
  expect(resumeWrappedRun(fakeCtx(sending.client))).toBe("resumed");
  await waitForWrappedRun();
  expect(sending.log.dms.map((d) => d.userId)).toEqual(["u1", "u2"]);

  resetWrappedTables();
  active("u1", "u2");
  setOptIn("u1", true);
  interruptedRun({ total: 2, processedUserIds: ["u1"], sendDms: false });
  const quiet = fakeClient();
  expect(resumeWrappedRun(fakeCtx(quiet.client))).toBe("resumed");
  await waitForWrappedRun();
  expect(quiet.log.dms.length).toBe(0);
  expect(getWrappedStatus().status).toBe("done");
});

test("startWrappedRun stores sendDms on the run", async () => {
  active("u1");
  const { client } = fakeClient();
  await run(fakeCtx(client), false);
  expect(runSendsDms(getWrappedStatus().id!)).toBe(false);
  await run(fakeCtx(client), true);
  expect(runSendsDms(getWrappedStatus().id!)).toBe(true);
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

test("resuming an interrupted send continues only the unsent DMs", async () => {
  active("u1", "u2", "u3");
  for (const u of ["u1", "u2", "u3"]) setOptIn(u, true);
  const { client: first } = fakeClient();
  await run(fakeCtx(first), false);
  // Pretend u1 was DM'd before the bot stopped in the middle of sending.
  db.update(schema.activityWrappedLinks)
    .set({ dmStatus: "sent" })
    .where(and(eq(schema.activityWrappedLinks.userId, "u1"), eq(schema.activityWrappedLinks.year, YEAR)))
    .run();
  const stale = nowSec() - 300;
  db.update(schema.activityWrappedRuns).set({ status: "sending", sendDms: 1, sent: 1, updatedAt: stale, finishedAt: null }).run();
  expect(getWrappedStatus().status).toBe("interrupted");

  const { client, log } = fakeClient();
  expect(resumeWrappedRun(fakeCtx(client))).toBe("resumed");
  await waitForWrappedRun();
  expect(log.dms.map((d) => d.userId).sort()).toEqual(["u2", "u3"]);
  expect(getWrappedStatus().sent).toBe(3);
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
  expect(log.dms.map((d) => d.userId)).toEqual(["u2"]);
  expect(status.sent).toBe(1);
  expect(status.skipped).toBe(2);
  expect(status.optedIn).toBe(1);
  expect(links().get("u1")!.dmStatus).toBe("skipped");
});

test("with nobody opted in a run sends no DM and still ends done", async () => {
  active("u1", "u2");
  const { client, log } = fakeClient();
  const status = await run(fakeCtx(client));
  expect(log.dms.length).toBe(0);
  expect(status.status).toBe("done");
  expect(status.skipped).toBe(2);
});

test("opting out after opting in stops the next run's DM", async () => {
  active("u1");
  setOptIn("u1", true);
  setOptIn("u1", false);
  const { client, log } = fakeClient();
  await run(fakeCtx(client));
  expect(log.dms.length).toBe(0);
});

test("a member opting in after a run gets their DM only when a later send starts", async () => {
  active("u1", "u2");
  setOptIn("u1", true);
  const { client, log } = fakeClient();
  await run(fakeCtx(client));
  expect(log.dms.map((d) => d.userId)).toEqual(["u1"]);

  setOptIn("u2", true);
  await new Promise((r) => setTimeout(r, 10));
  expect(log.dms.length).toBe(1);

  await run(fakeCtx(client));
  // u1 already has theirs; only u2 is written to.
  expect(log.dms.map((d) => d.userId)).toEqual(["u1", "u2"]);
});

test("the DM carries a link button to the member's own link, and the banner", async () => {
  active("u1");
  setOptIn("u1", true);
  const { client, log } = fakeClient();
  await run(fakeCtx(client));
  const token = links().get("u1")!.token;
  const buttons = allButtons(log.dms[0]!.payload.components);
  expect(buttons.length).toBe(1);
  expect(buttons[0]!.url).toBe(linkUrl(token));
  expect(allStrings(log.dms[0]!.payload.components).join("\n")).toContain("your 2026 is ready");
  const files = log.dms[0]!.payload.files as { name?: string }[] | undefined;
  expect(files?.map((f) => f.name)).toEqual(["wrapped-banner.png"]);
  expect(allStrings(log.dms[0]!.payload.components)).toContain("attachment://wrapped-banner.png");
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
  expect(allStrings(log.dms[0]!.payload.components)).toContain(`custom 2026 at ${linkUrl(token)}`);
});

test("a finished run posts exactly one wrapped.run-finished to the mod-log channel", async () => {
  setConfig({ modLogChannelId: "modlog" });
  active("u1", "u2");
  setOptIn("u1", true);
  const { client, log } = fakeClient();
  await run(fakeCtx(client));
  expect(log.posts.length).toBe(1);
  expect(log.posts[0]!.channelId).toBe("modlog");
  const text = allStrings(log.posts[0]!.payload.components).join("\n");
  expect(text).toContain("wrapped run finished");
  expect(text).toContain("» 2026, started by <@admin>");
  expect(text).toContain("» 1 sent, 0 failed, 1 not opted in");
});

test("no mod-log post when the channel is unset", async () => {
  active("u1");
  const { client, log } = fakeClient();
  await run(fakeCtx(client));
  expect(log.posts.length).toBe(0);
});
