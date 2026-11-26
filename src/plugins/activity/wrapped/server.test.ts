import { afterAll, afterEach, beforeAll, beforeEach, expect, spyOn, test } from "bun:test";
import * as images from "../../../core/images/index.tsx";
import { eq } from "drizzle-orm";
import { db, initDb, schema } from "../../../db/index.ts";
import { isValidComponentsPayload } from "../../../core/components.ts";
import { getMessageDef, renderBotMessage } from "../../../core/messages.ts";
import { closeVoiceSegment, openVoiceSegment, recordMessage, recordReactionAdd } from "../record.ts";
import { wrappedRoutes } from "../api/wrapped.ts";
import { setOptIn } from "./optin.ts";
import { getWrappedStatus, postAnnouncement, startWrappedRun, startWrappedSend, waitForWrappedRun, wrappedRunTiming } from "./run.ts";
import type { ServerNameLookup } from "./server.ts";
import {
  buildServerWrapped,
  getOrCreateServerToken,
  getServerRow,
  getServerWrappedByToken,
  serverWrappedUrl,
  storeServerWrapped,
} from "./server.ts";
import { allButtons, allStrings, at, fakeClient, fakeCtx, msg, resetWrappedTables, setConfig } from "./testing.ts";
import { env } from "../../../config/env.ts";

beforeAll(() => {
  initDb();
  wrappedRunTiming.sendDelayMs = 0;
});

beforeEach(() => {
  resetWrappedTables();
});

afterEach(async () => {
  await waitForWrappedRun();
});

afterAll(() => {
  resetWrappedTables();
});

/** Names for the test ids: members `name-<id>`, channels `#<id>`, thread t1 under c1. */
const names: ServerNameLookup = {
  member: (id) => `name-${id}`,
  channel: (id) => (id === "t1" ? { name: "t1-name", parentName: "c1-name" } : { name: `${id}-name`, parentName: null }),
};

/** Open and close a voice segment. */
function voice(userId: string, channelId: string, from: number, to: number) {
  openVoiceSegment(userId, { channelId, muted: false, deafened: false, streaming: false, video: false }, from);
  closeVoiceSegment(userId, to);
}

/** A small 2026: u1 and u2 talk, reply and sit in voice together; u3 says one thing in a thread. */
function seed() {
  const t = at("2026-03-02T21:00:00Z"); // a Monday
  for (let i = 0; i < 4; i++) {
    recordMessage(msg("u1", t + i, { channelId: "c1", emoji: [{ emoji: "custom:1", name: "pog", count: 2 }] }));
  }
  for (let i = 0; i < 3; i++) recordMessage(msg("u2", t + 10 + i, { channelId: "c2", replyToUserId: "u1", replyToMessageId: `x${i}` }));
  recordMessage(msg("u3", t + 20, { channelId: "t1", parentChannelId: "c1" }));
  recordMessage(msg("u3", t + 21, { channelId: "t1", parentChannelId: "c1" }));
  recordReactionAdd({ messageId: "x0", userId: "u3", emoji: "😂", name: null, channelId: "c1", messageAuthorId: "u1", ts: t });
  voice("u1", "v1", t, t + 7200);
  voice("u2", "v1", t + 3600, t + 7200);
}

test("totals, top emoji, unused custom emoji, busiest hour and weekday", () => {
  seed();
  const s = buildServerWrapped(2026, { guildEmojiIds: ["1", "2", "3"], names })!;
  expect(s.year).toBe(2026);
  expect(s.messages).toBe(9);
  expect(s.speakers).toBe(3);
  expect(s.voiceHours).toBe(3);
  expect(s.topEmoji).toEqual([
    { emoji: "custom:1", name: "pog", count: 8 },
    { emoji: "😂", name: null, count: 1 },
  ]);
  expect(s.unusedCustomEmoji).toBe(2);
  expect(s.busiestHour).toBe(21);
  expect(s.busiestWeekday).toBe("monday");
  expect(buildServerWrapped(2020, { names })).toBeNull();
});

test("topChannels lists a thread as its own channel with its parent's name", () => {
  seed();
  const s = buildServerWrapped(2026, { names })!;
  expect(s.topChannels).toEqual([
    { channelId: "c1", name: "c1-name", parentName: null, count: 4 },
    { channelId: "c2", name: "c2-name", parentName: null, count: 3 },
    { channelId: "t1", name: "t1-name", parentName: "c1-name", count: 2 },
  ]);
});

test("bestPair is named only when both members opted in", () => {
  seed();
  expect(buildServerWrapped(2026, { names })!.bestPair).toBeNull();
  setOptIn("u1", true);
  expect(buildServerWrapped(2026, { names })!.bestPair).toBeNull();
  setOptIn("u2", true);
  expect(buildServerWrapped(2026, { names })!.bestPair).toEqual({
    aId: "u1",
    aName: "name-u1",
    bId: "u2",
    bName: "name-u2",
    replies: 3,
    voiceHours: 1,
  });
});

test("bestClub names its founder; president names whoever held the chair longest", () => {
  seed();
  db.insert(schema.clubs).values({ id: 1, name: "club one", ownerId: "founder", status: "approved", channelId: "c2" }).run();
  db.insert(schema.clubMembers).values({ clubId: 1, userId: "a", accepted: 1 }).run();
  db.insert(schema.clubMembers).values({ clubId: 1, userId: "b", accepted: 1 }).run();
  db.insert(schema.elections)
    .values({ id: 1, status: "closed", startsAt: at("2025-12-20T00:00:00Z"), endsAt: at("2026-01-01T00:00:00Z"), winnerId: "p1" })
    .run();
  db.insert(schema.elections)
    .values({ id: 2, status: "closed", startsAt: at("2026-01-11T00:00:00Z"), endsAt: at("2026-01-18T00:00:00Z"), winnerId: "p2" })
    .run();
  db.insert(schema.candidates).values({ electionId: 1, userId: "p1", voteCount: 2 }).run();
  db.insert(schema.candidates).values({ electionId: 2, userId: "p2", voteCount: 3 }).run();
  db.insert(schema.candidates).values({ electionId: 2, userId: "p1", voteCount: 1 }).run();

  const s = buildServerWrapped(2026, { names })!;
  expect(s.bestClub).toEqual({ name: "club one", founderName: "name-founder", members: 2, messages: 3 });
  expect(s.president!.name).toBe("name-p2");
  expect(s.president!.terms).toBe(1);
  // Election 2 started in 2026 (election 1 in 2025); p2 and p1 stood in it.
  expect(s.president!.elections).toBe(1);
  expect(s.president!.candidates).toBe(2);
});

test("a run builds the server snapshot and keeps the server token on a rerun", async () => {
  seed();
  const { client } = fakeClient();
  startWrappedRun(fakeCtx(client), { year: 2026, startedBy: "admin" });
  await waitForWrappedRun();
  const token = getOrCreateServerToken(2026);
  expect(getServerWrappedByToken(token)!.data.messages).toBe(9);

  recordMessage(msg("u1", at("2026-07-01T12:00:00Z")));
  startWrappedRun(fakeCtx(client), { year: 2026, startedBy: "admin" });
  await waitForWrappedRun();
  expect(getOrCreateServerToken(2026)).toBe(token);
  expect(getServerWrappedByToken(token)!.data.messages).toBe(10);
  expect(db.select().from(schema.activityWrappedServer).all().length).toBe(1);
  expect(serverWrappedUrl(token)).toBe(`${env.PUBLIC_URL}/wrapped/s/${token}`);
});

test("with announce on, a finished send posts wrapped.announce once with the server link and sets announcedAt", async () => {
  seed();
  setConfig({ announcementChannelId: "ann", modLogChannelId: "modlog" });
  const { client, log } = fakeClient();
  startWrappedRun(fakeCtx(client), { year: 2026, startedBy: "admin" });
  await waitForWrappedRun();
  expect(log.posts.filter((p) => p.channelId === "ann").length).toBe(0);
  expect(startWrappedSend(fakeCtx(client), { startedBy: "admin", announce: true })).toBe("started");
  await waitForWrappedRun();

  const posts = log.posts.filter((p) => p.channelId === "ann");
  expect(posts.length).toBe(1);
  const token = getOrCreateServerToken(2026);
  expect(allStrings(posts[0]!.payload.components).join("\n")).toContain("wrapped is out");
  expect(allButtons(posts[0]!.payload.components).map((b) => b.url)).toEqual([serverWrappedUrl(token)]);
  expect((posts[0]!.payload.files as unknown as { name?: string }[]).map((f) => f.name)).toEqual(["wrapped-banner.png"]);
  const row = db.select().from(schema.activityWrappedServer).where(eq(schema.activityWrappedServer.year, 2026)).get()!;
  expect(row.announcedAt).not.toBeNull();
  const status = getWrappedStatus();
  expect(status.announce).toBe(true);
  expect(status.announcedAt).toBe(row.announcedAt);

  const modlog = log.posts.filter((p) => p.channelId === "modlog");
  expect(allStrings(modlog[0]!.payload.components).join("\n")).toContain("» announced in the announcements channel.");
});

test("with announce off or no announcement channel, nothing is announced", async () => {
  seed();
  setConfig({ announcementChannelId: "ann", modLogChannelId: "modlog" });
  const off = fakeClient();
  startWrappedRun(fakeCtx(off.client), { year: 2026, startedBy: "admin" });
  await waitForWrappedRun();
  startWrappedSend(fakeCtx(off.client), { startedBy: "admin", announce: false });
  await waitForWrappedRun();
  expect(off.log.posts.filter((p) => p.channelId === "ann").length).toBe(0);
  expect(allStrings(off.log.posts[0]!.payload.components).join("\n")).toContain("» not announced.");
  expect(getWrappedStatus().announcedAt).toBeNull();

  setConfig({ announcementChannelId: null });
  const none = fakeClient();
  startWrappedSend(fakeCtx(none.client), { startedBy: "admin", announce: true });
  await waitForWrappedRun();
  expect(none.log.posts.filter((p) => p.channelId !== "modlog").length).toBe(0);
  expect(getWrappedStatus().announcedAt).toBeNull();
});

test("the public server route returns the snapshot for its token, 404 otherwise, and no member's personal data", async () => {
  seed();
  const { client } = fakeClient();
  startWrappedRun(fakeCtx(client), { year: 2026, startedBy: "admin" });
  await waitForWrappedRun();
  const token = getOrCreateServerToken(2026);
  const route = wrappedRoutes.find((r) => r.path === "/api/activity/wrapped/s/:token")!;
  expect(route.access).toBe("public");
  const ctx = { ...fakeCtx(client), session: null };

  const ok = await route.handle(new Request("http://x/"), { ...ctx, params: { token } });
  expect(ok.status).toBe(200);
  const text = await ok.text();
  const body = JSON.parse(text) as { data: { messages: number } };
  expect(body.data.messages).toBe(9);
  // Nobody opted in: no member id, and nothing from the personal snapshots.
  for (const id of ["u1", "u2", "u3"]) expect(text).not.toContain(`"${id}"`);
  expect(text).not.toContain("soulmate");

  for (const bad of [token.slice(0, -1), "nope"]) {
    expect((await route.handle(new Request("http://x/"), { ...ctx, params: { token: bad } })).status).toBe(404);
  }
  const card = wrappedRoutes.find((r) => r.path === "/api/activity/wrapped/s/:token/card.png")!;
  expect(card.access).toBe("public");
  const png = await card.handle(new Request("http://x/"), { ...ctx, params: { token } });
  expect(png.headers.get("content-type")).toBe("image/png");
  expect((await card.handle(new Request("http://x/"), { ...ctx, params: { token: "nope" } })).status).toBe(404);
});

test("wrapped.announce is valid, lowercase, without ! and renders every param", async () => {
  const def = getMessageDef("wrapped.announce")!;
  expect(def.category).toBe("Wrapped");
  expect(def.params.map((p) => p.name).sort()).toEqual(["url", "year"]);
  expect(isValidComponentsPayload(def.defaultComponents)).toBe(true);
  const strings = allStrings(def.defaultComponents);
  expect(strings).toContain("## wrapped is out");
  for (const s of strings) expect(s).not.toContain("!");
  const { client } = fakeClient();
  const rendered = await renderBotMessage("wrapped.announce", fakeCtx(client), { year: 2026, url: "https://x/wrapped/s/t" });
  for (const s of allStrings(rendered.components)) expect(s).not.toMatch(/\{[a-zA-Z_]\w*\}/);
  expect(allButtons(rendered.components).map((b) => [b.label, b.url])).toEqual([["open the server wrapped", "https://x/wrapped/s/t"]]);
});

/** Process 2026 and wait. */
async function processYear(client: ReturnType<typeof fakeClient>["client"]) {
  startWrappedRun(fakeCtx(client), { year: 2026, startedBy: "admin" });
  await waitForWrappedRun();
}

test("a member who opts out after processing is not named: the public route and the card route drop the pair", async () => {
  seed();
  setOptIn("u1", true);
  setOptIn("u2", true);
  // Built with names, as a run would build it from the guild cache.
  storeServerWrapped(2026, buildServerWrapped(2026, { names })!);
  const token = getOrCreateServerToken(2026);
  const { client } = fakeClient();
  const ctx = { ...fakeCtx(client), session: null };
  const route = wrappedRoutes.find((r) => r.path === "/api/activity/wrapped/s/:token")!;
  const card = wrappedRoutes.find((r) => r.path === "/api/activity/wrapped/s/:token/card.png")!;

  // Both still opted in: the pair is served.
  const named = await (await route.handle(new Request("http://x/"), { ...ctx, params: { token } })).text();
  expect(named).toContain('"aId":"u1"');
  expect(named).toContain("name-u2");

  setOptIn("u2", false);
  const text = await (await route.handle(new Request("http://x/"), { ...ctx, params: { token } })).text();
  for (const leak of ['"u1"', '"u2"', "name-u1", "name-u2"]) expect(text).not.toContain(leak);
  expect((JSON.parse(text) as { data: { bestPair: unknown } }).data.bestPair).toBeNull();

  // The card route reads through the same check; its JSON fallback shows it.
  const render = spyOn(images, "renderWrappedServerCardPng").mockResolvedValue(null);
  try {
    const fallback = await (await card.handle(new Request("http://x/"), { ...ctx, params: { token } })).text();
    expect(render).toHaveBeenCalledTimes(1);
    expect((render.mock.calls[0]![0] as { bestPair: unknown }).bestPair).toBeNull();
    for (const leak of ['"u1"', '"u2"', "name-u1", "name-u2"]) expect(fallback).not.toContain(leak);
  } finally {
    render.mockRestore();
  }
});

test("two concurrent postAnnouncement calls post exactly once", async () => {
  seed();
  setConfig({ announcementChannelId: "ann" });
  const { client, log } = fakeClient();
  await processYear(client);
  const results = await Promise.all([postAnnouncement(fakeCtx(client), 2026), postAnnouncement(fakeCtx(client), 2026)]);
  expect(results.sort()).toEqual(["already-announced", "posted"]);
  expect(log.posts.filter((p) => p.channelId === "ann").length).toBe(1);
});

test("a failed announcement post releases the claim so it can be retried", async () => {
  seed();
  setConfig({ announcementChannelId: "ann" });
  const failing = fakeClient({ failPosts: ["ann"] });
  await processYear(failing.client);
  expect(await postAnnouncement(fakeCtx(failing.client), 2026)).toBe("failed");
  expect(getServerRow(2026)!.announcedAt).toBeNull();

  const working = fakeClient();
  expect(await postAnnouncement(fakeCtx(working.client), 2026)).toBe("posted");
  expect(working.log.posts.length).toBe(1);
  expect(getServerRow(2026)!.announcedAt).not.toBeNull();
});

test("a previewed but never processed year cannot be announced", async () => {
  seed();
  setConfig({ announcementChannelId: "ann" });
  const { client, log } = fakeClient();
  const preview = wrappedRoutes.find((r) => r.path === "/api/activity/wrapped/server-link")!;
  const res = await preview.handle(new Request("http://x/api/activity/wrapped/server-link?year=2026"), {
    ...fakeCtx(client),
    params: {},
    session: { userId: "admin", role: "admin" },
  });
  expect(res.status).toBe(200);
  expect(getServerRow(2026)!.data).not.toBeNull();
  expect(await postAnnouncement(fakeCtx(client), 2026)).toBe("not-processed");
  expect(log.posts.length).toBe(0);
});
