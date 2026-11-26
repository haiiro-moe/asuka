import { afterAll, afterEach, beforeAll, beforeEach, expect, setSystemTime, spyOn, test } from "bun:test";
import type { ApiContext } from "../../../core/plugin.ts";
import { db, initDb, schema } from "../../../db/index.ts";
import { recordMessage, recordReactionAdd } from "../record.ts";
import * as queries from "../queries/user.ts";
import { msg } from "../wrapped/testing.ts";
import { USER_MEMO_MAX_ENTRIES, clearUserMemo, userMemo, userMemoSize } from "./memo.ts";
import { userRoutes } from "./user.ts";

const GUILD = "g1";

/** A context whose guild cache holds a few channels and custom emoji. */
function ctx(): ApiContext {
  const channels = new Map<string, { name: string }>([
    ["c1", { name: "general" }],
    ["t1", { name: "side-quest" }],
  ]);
  const emojis = new Map<string, { id: string; name: string | null }>([
    ["e1", { id: "e1", name: "pog" }],
    ["e2", { id: "e2", name: null }],
  ]);
  const guild = { channels: { cache: channels }, emojis: { cache: emojis } };
  return {
    client: { guilds: { cache: new Map([[GUILD, guild]]) } },
    guildId: GUILD,
    params: {},
    session: { userId: "u1", role: "user" },
  } as unknown as ApiContext;
}

/** Call a user route with `?period=`. */
async function call(name: string, period = "all", c: ApiContext = ctx()) {
  const route = userRoutes.find((r) => r.path === `/api/activity/user/${name}`)!;
  const res = await route.handle(new Request(`http://x/api/activity/user/${name}?period=${period}`), c);
  return res.json();
}

beforeAll(() => {
  initDb();
});

beforeEach(() => {
  for (const t of [schema.activityMessages, schema.activityEmoji, schema.activityReactions, schema.activityMentions]) {
    db.delete(t).run();
  }
  clearUserMemo();
});

afterEach(() => {
  setSystemTime();
});

afterAll(() => {
  clearUserMemo();
});

/** Each memoised route and the query behind it. */
const MEMOISED: [string, keyof typeof queries][] = [
  ["awards", "awards"],
  ["emoji", "emojiLeaderboard"],
  ["emoji-trend", "emojiTrend"],
  ["emoji-graveyard", "emojiGraveyard"],
  ["channels", "channelFavourites"],
  ["sharing", "sharing"],
  ["rhythm", "rhythm"],
  ["reacted", "mostReacted"],
  ["voice", "voiceFavourites"],
];

test("a second call in the same ten minutes does not run the query again, for every heavy route", async () => {
  setSystemTime(new Date("2026-06-01T12:00:00Z"));
  for (const [route, fn] of MEMOISED) {
    const spy = spyOn(queries, fn);
    try {
      const first = await call(route);
      const second = await call(route);
      expect(second).toEqual(first);
      expect(spy).toHaveBeenCalledTimes(1);
    } finally {
      spy.mockRestore();
    }
  }
});

test("a call after the ten-minute window runs the query again; another period is its own entry", async () => {
  setSystemTime(new Date("2026-06-01T12:00:00Z"));
  const spy = spyOn(queries, "awards");
  try {
    await call("awards", "all");
    await call("awards", "7d");
    expect(spy).toHaveBeenCalledTimes(2);
    setSystemTime(new Date("2026-06-01T12:10:00Z"));
    await call("awards", "all");
    expect(spy).toHaveBeenCalledTimes(3);
  } finally {
    spy.mockRestore();
  }
});

test("a user-keyed result never crosses users", () => {
  let runs = 0;
  const compute = (userId: string) => () => {
    runs += 1;
    return { mine: userId };
  };
  expect(userMemo({ route: "x", period: "all", userId: "u1" }, compute("u1"), 1000)).toEqual({ mine: "u1" });
  expect(userMemo({ route: "x", period: "all", userId: "u2" }, compute("u2"), 1000)).toEqual({ mine: "u2" });
  expect(userMemo({ route: "x", period: "all", userId: "u1" }, compute("u1"), 1000)).toEqual({ mine: "u1" });
  expect(runs).toBe(2);
});

test("the memo is bounded and drops the least recently used result first", () => {
  let runs = 0;
  const compute = () => ++runs;
  userMemo({ route: "keep", period: "all" }, compute, 1000);
  for (let i = 0; i < USER_MEMO_MAX_ENTRIES + 10; i++) {
    userMemo({ route: `r${i}`, period: "all" }, compute, 1000);
    // Touch "keep" so it stays recent.
    userMemo({ route: "keep", period: "all" }, compute, 1000);
  }
  expect(userMemoSize()).toBe(USER_MEMO_MAX_ENTRIES);
  const before = runs;
  userMemo({ route: "keep", period: "all" }, compute, 1000);
  expect(runs).toBe(before);
  userMemo({ route: "r0", period: "all" }, compute, 1000);
  expect(runs).toBe(before + 1);
});

test("emoji-graveyard items carry the custom emoji's name, null when unknown", async () => {
  expect(await call("emoji-graveyard")).toEqual([
    { id: "e1", name: "pog" },
    { id: "e2", name: null },
  ]);
});

test("reacted rows carry the channel and thread parent names, null when unknown", async () => {
  recordMessage(msg("u1", 1000, { messageId: "a", channelId: "t1", parentChannelId: "c1" }));
  recordMessage(msg("u1", 1000, { messageId: "b", channelId: "gone" }));
  const react = (messageId: string, channelId: string, parentChannelId: string | null, userId: string) =>
    recordReactionAdd({ messageId, userId, emoji: "x", name: null, channelId, parentChannelId, messageAuthorId: "u1", ts: 1001 });
  react("a", "t1", "c1", "u2");
  react("a", "t1", "c1", "u3");
  react("b", "gone", null, "u2");
  expect(await call("reacted")).toEqual([
    { messageId: "a", channelId: "t1", parentChannelId: "c1", authorId: "u1", net: 2, channelName: "side-quest", parentChannelName: "general" },
    { messageId: "b", channelId: "gone", parentChannelId: null, authorId: "u1", net: 1, channelName: null, parentChannelName: null },
  ]);
});
