import { afterAll, beforeAll, beforeEach, expect, test } from "bun:test";
import { and, eq } from "drizzle-orm";
import { db, initDb, schema } from "../../../db/index.ts";
import { env } from "../../../config/env.ts";
import { recordMessage } from "../record.ts";
import type { WrappedData } from "../types/wrapped.ts";
import { ensureWrappedLink, getLinkByToken, linkUrl, newToken, upsertWrappedLink } from "./links.ts";
import { at, msg, resetWrappedTables } from "./testing.ts";

beforeAll(() => {
  initDb();
});

beforeEach(() => {
  resetWrappedTables();
});

afterAll(() => {
  resetWrappedTables();
});

/** A snapshot with `messages` set. */
function snapshot(messages: number): WrappedData {
  return {
    year: 2026,
    messages,
    voiceHours: 0,
    topEmoji: [],
    busiestHour: null,
    busiestDay: null,
    closestFriendId: null,
    mostRepliedToId: null,
    topChannelId: null,
    xpLevel: 0,
  };
}

/** The stored link row of a member. */
function linkRow(userId: string) {
  return db
    .select()
    .from(schema.activityWrappedLinks)
    .where(and(eq(schema.activityWrappedLinks.userId, userId), eq(schema.activityWrappedLinks.year, 2026)))
    .get();
}

test("newToken is 32 random bytes in base64url", () => {
  const a = newToken();
  const b = newToken();
  expect(a).toMatch(/^[A-Za-z0-9_-]{43}$/);
  expect(Buffer.from(a, "base64url").length).toBe(32);
  expect(a).not.toBe(b);
});

test("linkUrl is the public /wrapped/<token> page", () => {
  expect(linkUrl("abc")).toBe(`${env.PUBLIC_URL}/wrapped/abc`);
});

test("getLinkByToken returns the same data on every open and counts the opens", () => {
  const token = upsertWrappedLink("u1", 2026, snapshot(12));

  const first = getLinkByToken(token);
  const second = getLinkByToken(token);
  expect(first).toEqual({ userId: "u1", year: 2026, data: snapshot(12) });
  expect(second).toEqual(first);

  const row = linkRow("u1")!;
  expect(row.opens).toBe(2);
  expect(row.lastOpenedAt).not.toBeNull();
});

test("a token only ever returns its own member's snapshot", () => {
  const a = upsertWrappedLink("ua", 2026, snapshot(1));
  const b = upsertWrappedLink("ub", 2026, snapshot(2));
  expect(getLinkByToken(a)!.userId).toBe("ua");
  expect(getLinkByToken(a)!.data.messages).toBe(1);
  expect(getLinkByToken(b)!.userId).toBe("ub");
  expect(getLinkByToken(b)!.data.messages).toBe(2);
});

test("an unknown or truncated token returns null", () => {
  const token = upsertWrappedLink("u1", 2026, snapshot(1));
  expect(getLinkByToken(newToken())).toBeNull();
  expect(getLinkByToken(token.slice(0, -1))).toBeNull();
  expect(getLinkByToken(token.slice(0, 10))).toBeNull();
  expect(getLinkByToken("")).toBeNull();
  expect(getLinkByToken(`${token}x`)).toBeNull();
  // A failed lookup does not count as an open.
  expect(linkRow("u1")!.opens).toBe(0);
});

test("upserting again keeps the token and replaces the snapshot", () => {
  const first = upsertWrappedLink("u1", 2026, snapshot(1));
  const second = upsertWrappedLink("u1", 2026, snapshot(5));
  expect(second).toBe(first);
  expect(getLinkByToken(first)!.data.messages).toBe(5);
});

test("ensureWrappedLink makes a snapshot only for a member with activity", () => {
  expect(ensureWrappedLink("u1", 2026)).toBeNull();
  recordMessage(msg("u1", at("2026-03-02T10:00:00Z")));
  const token = ensureWrappedLink("u1", 2026)!;
  expect(getLinkByToken(token)!.data.messages).toBe(1);
  // An existing link is returned as it is.
  recordMessage(msg("u1", at("2026-03-02T11:00:00Z")));
  expect(ensureWrappedLink("u1", 2026)).toBe(token);
  expect(getLinkByToken(token)!.data.messages).toBe(1);
});

/** Call a wrapped route by method and path pattern. */
async function callRoute(method: string, path: string, params: Record<string, string>, url = "http://x/") {
  const { wrappedRoutes } = await import("../api/wrapped.ts");
  const { fakeClient, fakeCtx } = await import("./testing.ts");
  const route = wrappedRoutes.find((r) => r.method === method && r.path === path)!;
  const { client } = fakeClient();
  return route.handle(new Request(url, { method }), { ...fakeCtx(client), params, session: null });
}

test("the public token routes are public, return only the token's snapshot, and 404 otherwise", async () => {
  const { wrappedRoutes } = await import("../api/wrapped.ts");
  const publicPaths = wrappedRoutes.filter((r) => r.access === "public").map((r) => r.path).sort();
  expect(publicPaths).toEqual(["/api/activity/wrapped/t/:token", "/api/activity/wrapped/t/:token/card.png"]);
  for (const r of wrappedRoutes.filter((r) => r.access !== "public")) expect(r.access).toBe("admin");

  const a = upsertWrappedLink("ua", 2026, snapshot(1));
  upsertWrappedLink("ub", 2026, snapshot(2));
  const ok = await callRoute("GET", "/api/activity/wrapped/t/:token", { token: a });
  expect(ok.status).toBe(200);
  const body = (await ok.json()) as { data: WrappedData; displayName: string };
  expect(body.data).toEqual(snapshot(1));
  expect(JSON.stringify(body)).not.toContain("ub");

  for (const token of [a.slice(0, -1), newToken(), "x"]) {
    expect((await callRoute("GET", "/api/activity/wrapped/t/:token", { token })).status).toBe(404);
    expect((await callRoute("GET", "/api/activity/wrapped/t/:token/card.png", { token })).status).toBe(404);
  }
});

test("the card route returns a PNG for a known token without counting an open", async () => {
  const a = upsertWrappedLink("ua", 2026, snapshot(3));
  const res = await callRoute("GET", "/api/activity/wrapped/t/:token/card.png", { token: a });
  expect(res.status).toBe(200);
  expect(res.headers.get("content-type")).toBe("image/png");
  expect(linkRow("ua")!.opens).toBe(0);
});
