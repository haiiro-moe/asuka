import { beforeAll, beforeEach, expect, test } from "bun:test";
import type { ApiContext, ApiRoute } from "../../../core/plugin.ts";
import { nowSec } from "../../../core/util.ts";
import { db, initDb, schema } from "../../../db/index.ts";
import { recordCommand, recordMessage } from "../record.ts";
import { adminRoutes, withChannelNames } from "./admin.ts";

/** Find a route by its path after `/api/activity/admin/`. */
function route(path: string): ApiRoute {
  const r = adminRoutes.find((x) => x.path === `/api/activity/admin/${path}`);
  if (!r) throw new Error(`no route ${path}`);
  return r;
}

/** Call a route the way the dispatcher does, as an admin. */
async function call(path: string, query = "", params: Record<string, string> = {}) {
  const ctx = { params, session: { userId: "1", role: "admin" } } as unknown as ApiContext;
  const res = await route(path).handle(new Request(`http://x/api/activity/admin/${path}${query}`), ctx);
  return { status: res.status, body: (await res.json()) as unknown };
}

beforeAll(() => {
  initDb();
});

beforeEach(() => {
  db.delete(schema.activityCommands).run();
  db.delete(schema.activityMessages).run();
});

test("every route is an admin GET under /api/activity/admin/", () => {
  const paths = adminRoutes.map((r) => r.path.replace("/api/activity/admin/", ""));
  expect(paths).toEqual([
    "moderation",
    "offenders",
    "newcomers",
    "drift",
    "channels",
    "economy",
    "clubs-events",
    "bot",
    "relations",
    "inspect/:userId",
  ]);
  for (const r of adminRoutes) {
    expect(r.method).toBe("GET");
    expect(r.access).toBe("admin");
  }
});

test("answers JSON for a known period", async () => {
  recordCommand("1", "profile", false, nowSec() - 60);
  const res = await call("bot", "?period=7d");
  expect(res).toEqual({ status: 200, body: [{ name: "profile", uses: 1, failures: 1 }] });
});

test("an unknown period is a 400 with { error }", async () => {
  const res = await call("drift", "?period=decade");
  expect(res.status).toBe(400);
  expect(res.body).toEqual({ error: "unknown period: decade" });
});

test("relations rejects an unknown kind and defaults to replies", async () => {
  expect((await call("relations", "?kind=hugs")).status).toBe(400);
  expect(await call("relations")).toEqual({ status: 200, body: [] });
});

test("inspect rejects a non-numeric id with 400", async () => {
  const bad = await call("inspect/:userId", "", { userId: "abc" });
  expect(bad.status).toBe(400);
  const ok = await call("inspect/:userId", "", { userId: "123" });
  expect(ok).toEqual({ status: 200, body: { sent: 0, received: 0, ties: 0, busiestHour: null, closest: [] } });
});

/** A fake guild channel cache: `ctx.client.guilds.cache.get(guildId).channels.cache`. */
function fakeClient(guildId: string, names: Record<string, string>) {
  const channels = new Map(Object.entries(names).map(([id, name]) => [id, { id, name }]));
  return { guilds: { cache: new Map([[guildId, { channels: { cache: channels } }]]) } };
}

test("channels adds name and parentName from the guild's channel cache", async () => {
  const ts = nowSec() - 3600;
  const base = { parentChannelId: null, replyToUserId: null, replyToMessageId: null, mentionedUserIds: [], attachmentKinds: [], linkDomains: [], stickerCount: 0, length: 3, emoji: [], source: "live" as const };
  recordMessage({ ...base, messageId: "r1", userId: "1", channelId: "100", ts });
  recordMessage({ ...base, messageId: "r2", userId: "1", channelId: "100", ts });
  recordMessage({ ...base, messageId: "r3", userId: "1", channelId: "200", parentChannelId: "100", ts });
  recordMessage({ ...base, messageId: "r4", userId: "1", channelId: "300", ts }); // gone from the cache

  const ctx = {
    params: {},
    session: { userId: "1", role: "admin" },
    guildId: "g1",
    client: fakeClient("g1", { "100": "general", "200": "art dump" }),
  } as unknown as ApiContext;
  const res = await route("channels").handle(new Request("http://x/api/activity/admin/channels?period=7d"), ctx);
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual([
    { channelId: "100", parentChannelId: null, messages: 2, unansweredPct: 100, medianReplySec: null, name: "general", parentName: null },
    { channelId: "200", parentChannelId: "100", messages: 1, unansweredPct: 100, medianReplySec: null, name: "art dump", parentName: "general" },
    { channelId: "300", parentChannelId: null, messages: 1, unansweredPct: 100, medianReplySec: null, name: null, parentName: null },
  ]);
});

test("withChannelNames takes an injected lookup", () => {
  const rows = [{ channelId: "1", parentChannelId: "2", messages: 1, unansweredPct: 0, medianReplySec: 5 }];
  expect(withChannelNames(rows, (id) => (id === "2" ? "parent" : null))).toEqual([{ ...rows[0]!, name: null, parentName: "parent" }]);
});
