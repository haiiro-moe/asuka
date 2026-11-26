import { afterAll, afterEach, beforeAll, beforeEach, expect, test } from "bun:test";
import { and, eq } from "drizzle-orm";
import { db, initDb, schema } from "../../../db/index.ts";
import { nowSec } from "../../../core/util.ts";
import { closeVoiceSegment, openVoiceSegment, recordMessage } from "../record.ts";
import { wrappedRoutes } from "../api/wrapped.ts";
import type { PreviewStatus } from "../types/wrapped.ts";
import { wrappedCommands } from "./commands.ts";
import { getLinkByToken, getWrappedLink, listFailedDms } from "./links.ts";
import { setOptIn } from "./optin.ts";
import {
  discardWrappedPreview,
  getPreviewStatus,
  parseMemberIds,
  resumeWrappedPreview,
  startWrappedPreview,
  waitForWrappedPreviews,
} from "./preview.ts";
import { getWrappedStatus, startWrappedRun, startWrappedSend, waitForWrappedRun, wrappedRunTiming } from "./run.ts";
import { getServerRow, getServerWrappedByToken } from "./server.ts";
import type { FakeClientLog } from "./testing.ts";
import { allButtons, allStrings, fakeClient, fakeCtx, msg, resetWrappedTables, setConfig } from "./testing.ts";

const DAY = 86400;
/** Ten days ago, so every row lands in the current year (or late last year in early January). */
const T = nowSec() - 10 * DAY;
const YEAR = new Date(T * 1000).getUTCFullYear();
/** The admin who previews. */
const ADMIN = "900";

beforeAll(() => {
  initDb();
  wrappedRunTiming.sendDelayMs = 0;
});

beforeEach(() => {
  resetWrappedTables();
  // Channels are set, so any post would show up in the fake client's log.
  setConfig({ announcementChannelId: "ann", modLogChannelId: "modlog" });
});

afterEach(async () => {
  await waitForWrappedPreviews();
  await waitForWrappedRun();
});

afterAll(() => {
  resetWrappedTables();
});

/** `n` messages by `userId`. */
function talk(userId: string, n: number) {
  for (let i = 0; i < n; i++) recordMessage(msg(userId, T + i));
}

/** The admin plus members 101-106, 101 the most active. */
function seed() {
  talk(ADMIN, 2);
  talk("101", 9);
  talk("102", 8);
  talk("103", 7);
  talk("104", 6);
  talk("105", 5);
  talk("106", 4);
}

/** Start a preview as ADMIN and wait for it. */
async function preview(log: ReturnType<typeof fakeClient>, opts: { members?: string[]; all?: boolean; sample?: number } = {}) {
  const result = startWrappedPreview(fakeCtx(log.client), { ownerUserId: ADMIN, year: YEAR, ...opts });
  expect(result.result).toBe("started");
  await waitForWrappedPreviews();
  return getPreviewStatus(ADMIN);
}

/** The joined text of each DM. */
function dmTexts(log: FakeClientLog): string[] {
  return log.dms.map((d) => allStrings(d.payload.components).join("\n"));
}

/** Private link rows. */
function privateLinks() {
  return db.select().from(schema.activityWrappedLinks).where(eq(schema.activityWrappedLinks.private, 1)).all();
}

test("a default preview: the admin plus the 3 most active; only the admin is DM'd and nothing is posted", async () => {
  seed();
  setOptIn("101", true);
  const fake = fakeClient();
  const status = await preview(fake);

  expect(status.status).toBe("done");
  expect(status.sampled.map((m) => m.userId)).toEqual([ADMIN, "101", "102", "103"]);
  expect(status.sampled.map((m) => m.displayName)).toEqual([`name-${ADMIN}`, "name-101", "name-102", "name-103"]);
  expect(status.links.map((l) => l.userId).sort()).toEqual([ADMIN, "101", "102", "103"].sort());
  expect(status.serverToken).not.toBeNull();
  expect(status.expiresAt).toBe(status.startedAt! + 14 * DAY);

  // No member DM, no channel post: every DM goes to the admin.
  expect(fake.log.posts).toEqual([]);
  expect(new Set(fake.log.dms.map((d) => d.userId))).toEqual(new Set([ADMIN]));
  // intro, four member previews, the announcement, the server link
  const texts = dmTexts(fake.log);
  expect(texts.length).toBe(7);
  expect(texts[0]).toContain(`preview of the wrapped for ${YEAR}`);
  expect(texts[0]).toContain("nothing was sent to anyone");
  expect(texts[1]).toContain(`preview for name-${ADMIN}`);
  expect(texts[2]).toContain("preview for name-101");
  expect(texts[2]).not.toContain("would not be sent");
  expect(texts[3]).toContain("would not be sent: not opted in");
  // Each member preview is the real DM, carrying the member's private link.
  const link101 = status.links.find((l) => l.userId === "101")!.token;
  expect(allButtons(fake.log.dms[2]!.payload.components).map((b) => b.url)).toEqual([expect.stringContaining(link101)]);
  expect(texts[2]).toContain(`your ${YEAR} is ready`);
  // The announcement, buttons disabled, with a preview line.
  expect(texts[5]).toContain("wrapped is out");
  expect(texts[5]).toContain("preview");
  expect(allButtons(fake.log.dms[5]!.payload.components).every((b) => b.disabled === true)).toBe(true);
  // The server-wide private link.
  expect(allButtons(fake.log.dms[6]!.payload.components).map((b) => b.url)).toEqual([
    expect.stringContaining(`/wrapped/s/${status.serverToken}`),
  ]);
});

test("sample size: default 3, capped at 10; an explicit list replaces the sample", async () => {
  seed();
  for (let i = 0; i < 12; i++) talk(`2${String(i).padStart(2, "0")}`, 1);
  const big = await preview(fakeClient(), { sample: 50 });
  expect(big.sampled.length).toBe(11); // the admin plus 10

  const list = await preview(fakeClient(), { members: ["105", "999"] });
  expect(list.sampled.map((m) => [m.userId, m.hasLink])).toEqual([
    ["105", true],
    ["999", false],
  ]);
});

test("member lists: more than 10 ids or a non-numeric id are invalid", () => {
  const { client } = fakeClient();
  const ids = Array.from({ length: 11 }, (_, i) => String(300 + i));
  expect(startWrappedPreview(fakeCtx(client), { ownerUserId: ADMIN, year: YEAR, members: ids }).result).toBe("invalid");
  expect(startWrappedPreview(fakeCtx(client), { ownerUserId: ADMIN, year: YEAR, members: ["12ab"] }).result).toBe("invalid");
  expect(parseMemberIds("<@101>, <@!102> 103")).toEqual(["101", "102", "103"]);
  expect(parseMemberIds("101 nope")).toBeNull();
  expect(parseMemberIds(ids.join(" "))).toBeNull();
});

test("opt-ins are ignored for generation and reported as wouldSkip", async () => {
  seed();
  setOptIn("102", true);
  const status = await preview(fakeClient());
  expect(status.sampled.map((m) => [m.userId, m.wouldSkip])).toEqual([
    [ADMIN, true],
    ["101", true],
    ["102", false],
    ["103", true],
  ]);
  expect(status.wouldSkip).toBe(3);
  // Links exist for members who never opted in.
  expect(status.links.length).toBe(4);
});

test("the voice rule applies: with under two months of voice the preview has no voice figures", async () => {
  seed();
  openVoiceSegment("101", { channelId: "v1", muted: false, deafened: false, streaming: false, video: false }, T);
  closeVoiceSegment("101", T + 20 * 3600);
  const status = await preview(fakeClient());
  const token = status.links.find((l) => l.userId === "101")!.token;
  const link = getLinkByToken(token)!;
  expect(link.data.voiceHours).toBeNull();
  expect(link.data.voiceReady).toBe(false);
  expect(getServerWrappedByToken(status.serverToken!)!.data.voiceHours).toBeNull();
});

test("all: every member is processed for the counts, but only the sample is DM'd", async () => {
  seed();
  const fake = fakeClient();
  const status = await preview(fake, { all: true });
  expect(status.all).toBe(true);
  expect(status.total).toBe(7);
  expect(status.done).toBe(7);
  expect(privateLinks().length).toBe(7);
  expect(status.wouldSkip).toBe(7);
  // intro + 4 previews + announcement + server link
  expect(fake.log.dms.length).toBe(7);
  expect(new Set(fake.log.dms.map((d) => d.userId))).toEqual(new Set([ADMIN]));
});

test("a private run changes nothing of the real run", async () => {
  seed();
  setOptIn("101", true);
  await preview(fakeClient());
  expect(getWrappedStatus().status).toBe("idle");
  expect(getWrappedLink("101", YEAR)).toBeNull();
  expect(listFailedDms(YEAR).items).toEqual([]);
  expect(getServerRow(YEAR)).toBeUndefined();

  // A real run after it: its counts and status ignore the private rows.
  const real = fakeClient();
  startWrappedRun(fakeCtx(real.client), { year: YEAR, startedBy: "admin" });
  await waitForWrappedRun();
  const processed = getWrappedStatus();
  expect(processed.status).toBe("processed");
  expect(processed.total).toBe(7);
  startWrappedSend(fakeCtx(real.client), { startedBy: "admin", announce: false });
  await waitForWrappedRun();
  const done = getWrappedStatus();
  expect(done.sent).toBe(1);
  expect(done.skipped).toBe(6);
  // The member has a real link and a separate preview link.
  const realToken = getWrappedLink("101", YEAR)!.token;
  const previewToken = getPreviewStatus(ADMIN).links.find((l) => l.userId === "101")!.token;
  expect(realToken).not.toBe(previewToken);
  expect(getLinkByToken(realToken)!.preview).toBe(false);
  expect(getLinkByToken(previewToken)!.preview).toBe(true);
  // Private links were never DM'd or marked by the real send.
  for (const row of privateLinks()) expect(row.dmStatus).toBe("pending");
  expect(real.log.dms.filter((d) => d.userId !== "admin").map((d) => d.userId)).toEqual(["101"]);
});

test("a real run in progress is not touched by a preview, and vice versa", async () => {
  seed();
  const real = fakeClient();
  startWrappedRun(fakeCtx(real.client), { year: YEAR, startedBy: "admin" });
  const fake = fakeClient();
  expect(startWrappedPreview(fakeCtx(fake.client), { ownerUserId: ADMIN, year: YEAR }).result).toBe("started");
  await waitForWrappedRun();
  await waitForWrappedPreviews();
  expect(getWrappedStatus().status).toBe("processed");
  expect(getWrappedStatus().total).toBe(7);
  expect(getPreviewStatus(ADMIN).status).toBe("done");
  expect(fake.log.posts).toEqual([]);
});

test("one active preview per admin; another admin can preview at the same time", async () => {
  seed();
  const { client } = fakeClient();
  expect(startWrappedPreview(fakeCtx(client), { ownerUserId: ADMIN, year: YEAR }).result).toBe("started");
  expect(startWrappedPreview(fakeCtx(client), { ownerUserId: ADMIN, year: YEAR }).result).toBe("already-running");
  expect(startWrappedPreview(fakeCtx(client), { ownerUserId: "901", year: YEAR }).result).toBe("started");
  await waitForWrappedPreviews();
  expect(getPreviewStatus("901").status).toBe("done");
  // Each admin sees only their own preview.
  expect(getPreviewStatus("902").status).toBe("idle");
});

test("discard deletes the preview, its links and its server story", async () => {
  seed();
  const status = await preview(fakeClient());
  const token = status.links[0]!.token;
  expect(getLinkByToken(token)).not.toBeNull();
  expect(discardWrappedPreview(ADMIN)).toBe("discarded");
  expect(getLinkByToken(token)).toBeNull();
  expect(getServerWrappedByToken(status.serverToken!)).toBeNull();
  expect(privateLinks()).toEqual([]);
  expect(getPreviewStatus(ADMIN).status).toBe("idle");
  expect(discardWrappedPreview(ADMIN)).toBe("nothing");
});

test("preview links expire after 14 days: a uniform 404, deleted at the next preview start", async () => {
  seed();
  const status = await preview(fakeClient());
  const token = status.links[0]!.token;
  db.update(schema.activityWrappedRuns)
    .set({ startedAt: nowSec() - 15 * DAY })
    .where(eq(schema.activityWrappedRuns.kind, "private"))
    .run();
  expect(getLinkByToken(token)).toBeNull();
  expect(getServerWrappedByToken(status.serverToken!)).toBeNull();
  const route = wrappedRoutes.find((r) => r.path === "/api/activity/wrapped/t/:token")!;
  const { client } = fakeClient();
  const res = await route.handle(new Request("http://x/"), { ...fakeCtx(client), params: { token }, session: null });
  expect(res.status).toBe(404);
  expect(await res.json()).toEqual({ error: "not found" });

  // The next preview start (by anyone) deletes the expired rows.
  await (async () => {
    expect(startWrappedPreview(fakeCtx(client), { ownerUserId: "901", year: YEAR }).result).toBe("started");
    await waitForWrappedPreviews();
  })();
  const left = db
    .select()
    .from(schema.activityWrappedLinks)
    .where(and(eq(schema.activityWrappedLinks.private, 1), eq(schema.activityWrappedLinks.ownerUserId, ADMIN)))
    .all();
  expect(left).toEqual([]);
});

test("an interrupted preview resumes: the DMs not yet sent go out, nothing twice", async () => {
  seed();
  const first = fakeClient();
  await preview(first);
  expect(first.log.dms.length).toBe(7);
  // Pretend the bot stopped after the third DM.
  const run = db.select().from(schema.activityWrappedRuns).where(eq(schema.activityWrappedRuns.kind, "private")).get()!;
  const state = JSON.parse(run.preview!) as { dmStep: number };
  state.dmStep = 3;
  db.update(schema.activityWrappedRuns)
    .set({ status: "sending", preview: JSON.stringify(state), updatedAt: nowSec() - 300, finishedAt: null })
    .where(eq(schema.activityWrappedRuns.id, run.id))
    .run();
  expect(getPreviewStatus(ADMIN).status).toBe("interrupted");

  const second = fakeClient();
  expect(resumeWrappedPreview(fakeCtx(second.client), ADMIN)).toBe("resumed");
  await waitForWrappedPreviews();
  expect(second.log.dms.length).toBe(4);
  expect(getPreviewStatus(ADMIN).status).toBe("done");
  expect(resumeWrappedPreview(fakeCtx(second.client), ADMIN)).toBe("nothing-to-resume");
});

test("an interrupted processing step resumes and only builds the missing members", async () => {
  seed();
  await preview(fakeClient());
  const run = db.select().from(schema.activityWrappedRuns).where(eq(schema.activityWrappedRuns.kind, "private")).get()!;
  // Pretend 103's snapshot was never built.
  db.delete(schema.activityWrappedLinks)
    .where(and(eq(schema.activityWrappedLinks.userId, "103"), eq(schema.activityWrappedLinks.private, 1)))
    .run();
  const before = getPreviewStatus(ADMIN).links.find((l) => l.userId === "101")!.token;
  db.update(schema.activityWrappedRuns)
    .set({ status: "processing", processed: 3, updatedAt: nowSec() - 300, finishedAt: null })
    .where(eq(schema.activityWrappedRuns.id, run.id))
    .run();
  const again = fakeClient();
  expect(resumeWrappedPreview(fakeCtx(again.client), ADMIN)).toBe("resumed");
  await waitForWrappedPreviews();
  const status = getPreviewStatus(ADMIN);
  expect(status.status).toBe("done");
  expect(status.links.map((l) => l.userId).sort()).toEqual([ADMIN, "101", "102", "103"].sort());
  expect(status.links.find((l) => l.userId === "101")!.token).toBe(before);
});

test("closed DMs: the failure is recorded in the status, with no retry", async () => {
  seed();
  let attempts = 0;
  const fake = fakeClient({ closedDms: [ADMIN], onDm: () => attempts++ });
  const status = await preview(fake);
  expect(status.status).toBe("done");
  expect(status.dmFailed).toBe(true);
  expect(status.error).toContain("dms");
  expect(attempts).toBe(1);
  // The links still work from the dashboard.
  expect(status.links.length).toBe(4);
});

test("the public routes serve preview links with preview: true", async () => {
  seed();
  const status = await preview(fakeClient());
  const { client } = fakeClient();
  const ctx = { ...fakeCtx(client), session: null };
  const t = wrappedRoutes.find((r) => r.path === "/api/activity/wrapped/t/:token")!;
  const s = wrappedRoutes.find((r) => r.path === "/api/activity/wrapped/s/:token")!;
  const personal = (await (await t.handle(new Request("http://x/"), { ...ctx, params: { token: status.links[0]!.token } })).json()) as {
    preview: boolean;
  };
  expect(personal.preview).toBe(true);
  const server = (await (await s.handle(new Request("http://x/"), { ...ctx, params: { token: status.serverToken! } })).json()) as {
    preview: boolean;
    data: { messages: number };
  };
  expect(server.preview).toBe(true);
  expect(server.data.messages).toBe(41);
});

test("the preview command and routes are admin only, and the session user owns the preview", async () => {
  seed();
  for (const path of ["/api/activity/wrapped/preview", "/api/activity/wrapped/preview/discard"]) {
    for (const r of wrappedRoutes.filter((x) => x.path === path)) expect(r.access).toBe("admin");
  }
  const { client } = fakeClient();
  const post = wrappedRoutes.find((r) => r.method === "POST" && r.path === "/api/activity/wrapped/preview")!;
  const get = wrappedRoutes.find((r) => r.method === "GET" && r.path === "/api/activity/wrapped/preview")!;
  const asAdmin = (userId: string) => ({ ...fakeCtx(client), params: {}, session: { userId, role: "admin" as const } });

  // The owner is the session user, never a body field.
  const started = await post.handle(
    new Request("http://x/", { method: "POST", body: JSON.stringify({ year: YEAR, ownerUserId: "666" }) }),
    asAdmin(ADMIN),
  );
  expect(started.status).toBe(202);
  await waitForWrappedPreviews();
  const mine = (await (await get.handle(new Request("http://x/"), asAdmin(ADMIN))).json()) as PreviewStatus;
  expect(mine.status).toBe("done");
  const theirs = (await (await get.handle(new Request("http://x/"), asAdmin("666"))).json()) as PreviewStatus;
  expect(theirs.status).toBe("idle");
  const bad = await post.handle(
    new Request("http://x/", { method: "POST", body: JSON.stringify({ members: ["abc"] }) }),
    asAdmin(ADMIN),
  );
  expect(bad.status).toBe(400);

  // The command: forbidden to a member, deferred for an admin.
  const order: string[] = [];
  const replies: { components?: unknown }[] = [];
  const interaction = (admin: boolean) => ({
    options: {
      getSubcommand: () => "preview",
      getInteger: () => null,
      getBoolean: () => null,
      getString: () => null,
      getUser: () => null,
    },
    user: { id: "777" },
    member: { permissions: { has: () => admin } },
    deferred: false,
    replied: false,
    async reply(p: { components?: unknown }) {
      order.push("reply");
      replies.push(p);
    },
    async editReply(p: { components?: unknown }) {
      order.push("editReply");
      replies.push(p);
    },
    async deferReply() {
      order.push("deferReply");
      this.deferred = true;
    },
  });
  await wrappedCommands[0]!.execute(interaction(false) as never, fakeCtx(client));
  expect(allStrings(replies[0]!.components).join("\n")).toContain("forbidden");
  expect(getPreviewStatus("777").status).toBe("idle");

  order.length = 0;
  await wrappedCommands[0]!.execute(interaction(true) as never, fakeCtx(client));
  expect(order).toEqual(["deferReply", "editReply"]);
  expect(allStrings(replies[1]!.components).join("\n")).toContain("preview started");
  await waitForWrappedPreviews();
  expect(getPreviewStatus("777").status).toBe("done");
});

test("real-run counts, the failed list and the status ignore private links whatever their DM status", async () => {
  seed();
  for (const u of ["101", "102", "103"]) setOptIn(u, true);
  await preview(fakeClient());
  // Make the private rows look like sent and failed DMs.
  db.update(schema.activityWrappedLinks).set({ dmStatus: "failed" }).where(eq(schema.activityWrappedLinks.private, 1)).run();
  db.update(schema.activityWrappedLinks)
    .set({ dmStatus: "sent" })
    .where(and(eq(schema.activityWrappedLinks.private, 1), eq(schema.activityWrappedLinks.userId, "101")))
    .run();
  expect(listFailedDms(YEAR).items).toEqual([]);

  const real = fakeClient();
  startWrappedRun(fakeCtx(real.client), { year: YEAR, startedBy: "admin" });
  await waitForWrappedRun();
  startWrappedSend(fakeCtx(real.client), { startedBy: "admin", announce: false });
  await waitForWrappedRun();
  const status = getWrappedStatus();
  expect(status.sent).toBe(3);
  expect(status.failed).toBe(0);
  expect(status.skipped).toBe(4);
  expect(listFailedDms(YEAR).items).toEqual([]);
  // The private rows kept their own statuses.
  const priv = privateLinks();
  expect(priv.filter((r) => r.dmStatus === "failed").length).toBe(3);
  expect(priv.filter((r) => r.dmStatus === "sent").length).toBe(1);
});
