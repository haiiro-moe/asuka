import { afterAll, beforeAll, beforeEach, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import type { ApiContext } from "../../core/plugin.ts";
import { db, initDb, schema } from "../../db/index.ts";
import { userRoutes } from "./api/user.ts";
import { clearUserMemo, userMemo } from "./api/memo.ts";
import { excludedChannelIds, exclusionSignature } from "./exclusion.ts";
import { recordMessage } from "./record.ts";
import { clearWrappedSharedMemo, rememberWrappedShared, sharedFor, wrappedShared } from "./wrapped/data.ts";
import { at, msg } from "./wrapped/testing.ts";

/** Save the excluded list the way `PUT /api/config` does: a patch on the singleton row. */
function putExcluded(list: string) {
  const patch = { activityExcludedChannelIds: list, updatedAt: Math.floor(Date.now() / 1000) };
  db.update(schema.guildConfig).set(patch).where(eq(schema.guildConfig.id, 1)).run();
}

beforeAll(() => {
  initDb();
});

beforeEach(() => {
  for (const t of [schema.activityMessages, schema.activityEmoji, schema.activityReactions, schema.activityMentions, schema.clubs]) {
    db.delete(t).run();
  }
  putExcluded("");
  clearUserMemo();
  clearWrappedSharedMemo();
});

afterAll(() => {
  putExcluded("");
  clearUserMemo();
  clearWrappedSharedMemo();
});

test("exclusionSignature is stable across order, spacing and duplicates", () => {
  putExcluded("b, a,b ,c");
  expect(exclusionSignature()).toBe("a,b,c");
  putExcluded("");
  expect(exclusionSignature()).toBe("");
});

test("userMemo recomputes when the exclusion list changes, and still hits when it does not", () => {
  let runs = 0;
  const compute = () => {
    runs += 1;
    return [...excludedChannelIds()];
  };
  const key = { route: "x", period: "all" };
  expect(userMemo(key, compute, 1000)).toEqual([]);
  expect(userMemo(key, compute, 1001)).toEqual([]);
  expect(runs).toBe(1);
  putExcluded("c1");
  expect(userMemo(key, compute, 1002)).toEqual(["c1"]);
  expect(runs).toBe(2);
  expect(userMemo(key, compute, 1003)).toEqual(["c1"]);
  expect(runs).toBe(2);
});

test("an excluded channel leaves the channels route on the very next call", async () => {
  const route = userRoutes.find((r) => r.path === "/api/activity/user/channels")!;
  const ctx = { client: { guilds: { cache: new Map() } }, guildId: "g1", params: {}, session: { userId: "u1", role: "user" } } as unknown as ApiContext;
  const call = async () => (await route.handle(new Request("http://x/api/activity/user/channels?period=all"), ctx)).json() as Promise<{ channelId: string }[]>;
  recordMessage(msg("u1", at("2026-06-01T12:00:00Z"), { channelId: "cA" }));
  recordMessage(msg("u2", at("2026-06-01T12:00:00Z"), { channelId: "cB" }));
  const before = JSON.stringify(await call());
  expect(before).toContain("cA");
  expect(before).toContain("cB");
  putExcluded("cA");
  const after = JSON.stringify(await call());
  expect(after).not.toContain("cA");
  expect(after).toContain("cB");
});

/** An approved club whose channel is `cA`, with a message in it. */
function seedClub() {
  db.insert(schema.clubs).values({ id: 1, name: "club", ownerId: "f", status: "approved", channelId: "cA" }).run();
  recordMessage(msg("f", at("2026-06-01T12:00:00Z"), { channelId: "cA" }));
}

test("sharedFor computes once for an unchanged list, then rebuilds without the excluded channel", () => {
  seedClub();
  const first = sharedFor(2026, false);
  expect(sharedFor(2026, false)).toBe(first);
  expect(first.clubs[0]!.messages).toBe(1);
  putExcluded("cA");
  const second = sharedFor(2026, false);
  expect(second).not.toBe(first);
  expect(second.clubs[0]!.messages).toBe(0);
  expect(sharedFor(2026, false)).toBe(second);
});

test("aggregates built under an old list are not served after the list changes", () => {
  seedClub();
  const built = wrappedShared(2026, false);
  putExcluded("cA");
  expect(rememberWrappedShared(2026, built)).toBe(built);
  const served = sharedFor(2026, false);
  expect(served).not.toBe(built);
  expect(served.clubs[0]!.messages).toBe(0);
});
