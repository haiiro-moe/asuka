import { beforeAll, beforeEach, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import type { BotContext } from "../../../core/plugin.ts";
import { db, initDb, schema } from "../../../db/index.ts";
import type { RawMessage } from "../facts.ts";
import {
  backfillChannel,
  backfillReactions,
  getBackfillStatus,
  resetBackfillRun,
  startBackfill,
  stopBackfill,
  whenBackfillSettled,
} from "./runner.ts";
import type { BackfillChannel } from "./channel.ts";
import type { ReactionMessage } from "./types.ts";

beforeAll(() => {
  initDb();
});

beforeEach(async () => {
  await whenBackfillSettled();
  resetBackfillRun();
  db.delete(schema.activityBackfill).run();
  db.delete(schema.activityMessages).run();
  db.delete(schema.activityMentions).run();
  db.delete(schema.activityEmoji).run();
  db.delete(schema.activityReactions).run();
  setExcluded("");
});

/** Write the excluded-channel list onto the singleton config row. */
function setExcluded(list: string) {
  db.update(schema.guildConfig).set({ activityExcludedChannelIds: list }).where(eq(schema.guildConfig.id, 1)).run();
}

/** A plain message by a member; the id doubles as the order (higher is newer). */
function msg(id: number, channelId = "c1", parentChannelId: string | null = null): RawMessage {
  return {
    id: String(id),
    author: { id: "u1", bot: false },
    webhookId: null,
    system: false,
    guildId: "g1",
    channelId,
    parentChannelId,
    createdTimestamp: 1_800_000_000_000 + id * 1000,
    content: "hello",
    replyToMessageId: null,
    repliedUserId: null,
    mentionedUserIds: [],
    attachmentTypes: [],
    stickerCount: 0,
  };
}

/** Pages of messages, newest first: page 0 holds ids 30..21, and so on. */
function pagesOf(sizes: number[], channelId = "c1", top = 100): RawMessage[][] {
  const pages: RawMessage[][] = [];
  let next = top;
  for (const size of sizes) {
    const page: RawMessage[] = [];
    for (let i = 0; i < size; i++) page.push(msg(next--, channelId));
    pages.push(page);
  }
  return pages;
}

/** A fetchPage over fixed pages that records the `before` it was called with. */
function fakeFetch(pages: RawMessage[][], calls: (string | null)[] = []) {
  return async (before: string | null) => {
    calls.push(before);
    if (before === null) return pages[0] ?? [];
    const i = pages.findIndex((p) => p.at(-1)!.id === before);
    return pages[i + 1] ?? [];
  };
}

const noSleep = async () => {};
const fast = { sleep: noSleep };

function row(channelId: string) {
  return db.select().from(schema.activityBackfill).where(eq(schema.activityBackfill.channelId, channelId)).get();
}

function messageCount() {
  return db.select().from(schema.activityMessages).all().length;
}

test("three pages then empty insert every message once and mark the channel done", async () => {
  const pages = pagesOf([3, 3, 3]);
  const cursors: (string | null | undefined)[] = [];
  const base = fakeFetch(pages);
  const fetchPage = async (before: string | null) => {
    cursors.push(row("c1")?.beforeId);
    return base(before);
  };
  const result = await backfillChannel("c1", null, fetchPage, fast);

  expect(result).toEqual({ scanned: 9, done: true });
  expect(messageCount()).toBe(9);
  const r = row("c1")!;
  expect(r.doneAt).not.toBeNull();
  expect(r.scanned).toBe(9);
  // Before each fetch, the saved cursor is the oldest id of the page before it.
  expect(cursors).toEqual([null, "98", "95", "92"]);
  expect(db.select().from(schema.activityMessages).all().every((m) => m.source === "backfill")).toBe(true);
});

test("a fetchPage that throws leaves the cursor after page 1 and a second call resumes", async () => {
  const pages = pagesOf([3, 3]);
  const base = fakeFetch(pages);
  let n = 0;
  const flaky = async (before: string | null) => {
    if (++n === 2) throw new Error("boom");
    return base(before);
  };
  await expect(backfillChannel("c1", null, flaky, fast)).rejects.toThrow("boom");
  expect(row("c1")!.beforeId).toBe("98");
  expect(row("c1")!.doneAt).toBeNull();
  expect(messageCount()).toBe(3);

  const calls: (string | null)[] = [];
  const result = await backfillChannel("c1", null, fakeFetch(pages, calls), fast);
  expect(calls[0]).toBe("98");
  expect(result.done).toBe(true);
  expect(messageCount()).toBe(6);
  expect(row("c1")!.scanned).toBe(6);
});

test("a done channel never calls fetchPage", async () => {
  await backfillChannel("c1", null, fakeFetch(pagesOf([2])), fast);
  const calls: (string | null)[] = [];
  const result = await backfillChannel("c1", null, fakeFetch(pagesOf([2]), calls), fast);
  expect(calls).toEqual([]);
  expect(result).toEqual({ scanned: 0, done: true });
});

test("an excluded channel, or a thread under one, is marked done without fetching", async () => {
  setExcluded("c1, p1");
  const calls: (string | null)[] = [];
  expect(await backfillChannel("c1", null, fakeFetch(pagesOf([2]), calls), fast)).toEqual({ scanned: 0, done: true });
  expect(await backfillChannel("t1", "p1", fakeFetch(pagesOf([2], "t1"), calls), fast)).toEqual({ scanned: 0, done: true });
  expect(calls).toEqual([]);
  expect(row("c1")!.doneAt).not.toBeNull();
  expect(row("t1")!.doneAt).not.toBeNull();
  expect(messageCount()).toBe(0);
});

test("two runs over overlapping pages give the same row count", async () => {
  await backfillChannel("c1", null, fakeFetch(pagesOf([3, 3])), fast);
  db.delete(schema.activityBackfill).run();
  // Pages shifted by two: ids 102..94, of which 100..95 are already stored.
  await backfillChannel("c1", null, fakeFetch(pagesOf([3, 3, 3], "c1", 102)), fast);
  expect(messageCount()).toBe(9);
  const again = messageCount();
  db.delete(schema.activityBackfill).run();
  await backfillChannel("c1", null, fakeFetch(pagesOf([3, 3, 3], "c1", 102)), fast);
  expect(messageCount()).toBe(again);
});

test("it sleeps pageDelayMs (default 250) between pages and honours maxPages", async () => {
  const slept: number[] = [];
  const sleep = async (ms: number) => {
    slept.push(ms);
  };
  await backfillChannel("c1", null, fakeFetch(pagesOf([2, 2])), { sleep });
  expect(slept).toEqual([250, 250]);

  db.delete(schema.activityBackfill).run();
  slept.length = 0;
  const result = await backfillChannel("c1", null, fakeFetch(pagesOf([2, 2, 2])), { sleep, pageDelayMs: 5, maxPages: 2 });
  expect(result).toEqual({ scanned: 4, done: false });
  expect(row("c1")!.doneAt).toBeNull();
  expect(slept).toEqual([5]);
});

/** A channel whose pages wait for the test to release them. */
function gatedChannel(id: string, pages: RawMessage[][], gate?: Promise<void>): BackfillChannel {
  const base = fakeFetch(pages);
  return {
    id,
    name: `#${id}`,
    parentId: null,
    fetchPage: async (before) => {
      if (gate) await gate;
      return base(before);
    },
    fetchReactionPage: async () => [],
  };
}

const ctx = {} as BotContext;

/** A complete listing of the given channels. */
const full = (channels: BackfillChannel[]) => ({ channels, complete: true });

test("startBackfill reports already-running, and status follows the run", async () => {
  expect(getBackfillStatus().status).toBe("idle");

  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  const channels = [gatedChannel("c1", pagesOf([3, 3]), gate), gatedChannel("c2", pagesOf([2], "c2", 50))];
  const deps = { listChannels: async () => full(channels), sleep: noSleep };

  expect(startBackfill(ctx, { reactions: false }, deps)).toBe("started");
  expect(startBackfill(ctx, { reactions: false }, deps)).toBe("already-running");
  // Let the run list channels and reach the first (gated) page.
  await Bun.sleep(10);
  const mid = getBackfillStatus();
  expect(mid.status).toBe("running");
  expect(mid.current).toBe("#c1");
  expect(mid.channelsTotal).toBe(2);
  expect(mid.channelsDone).toBe(0);
  expect(mid.startedAt).not.toBeNull();

  release();
  await whenBackfillSettled();
  const end = getBackfillStatus();
  expect(end.status).toBe("done");
  expect(end.channelsDone).toBe(2);
  expect(end.channelsTotal).toBe(2);
  expect(end.scanned).toBe(8);
  expect(end.current).toBeNull();
  expect(end.errors).toBe(0);
  expect(messageCount()).toBe(8);
});

test("stop finishes the current page, keeps the cursor, and a restart resumes from it", async () => {
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  const pages = pagesOf([3, 3, 3]);
  const c1 = gatedChannel("c1", pages, gate);
  const deps = { listChannels: async () => full([c1]), sleep: noSleep };

  startBackfill(ctx, { reactions: false }, deps);
  await Bun.sleep(10);
  expect(stopBackfill()).toBe("stopping");
  release();
  await whenBackfillSettled();

  const stopped = getBackfillStatus();
  expect(stopped.status).toBe("stopped");
  expect(stopped.channelsDone).toBe(0);
  expect(stopped.scanned).toBe(3);
  expect(row("c1")!.beforeId).toBe("98");
  expect(stopBackfill()).toBe("not-running");

  const calls: (string | null)[] = [];
  const resumed: BackfillChannel = { ...c1, fetchPage: fakeFetch(pages, calls) };
  expect(startBackfill(ctx, { reactions: false }, { listChannels: async () => full([resumed]), sleep: noSleep })).toBe("started");
  await whenBackfillSettled();
  expect(calls[0]).toBe("98");
  expect(getBackfillStatus().status).toBe("done");
  expect(messageCount()).toBe(9);
});

test("status is derived from the rows when no run is live", () => {
  db.insert(schema.activityBackfill).values({ channelId: "a", scanned: 5, doneAt: 100 }).run();
  db.insert(schema.activityBackfill).values({ channelId: "b", scanned: 7, beforeId: "9" }).run();
  const stopped = getBackfillStatus();
  expect(stopped).toMatchObject({ status: "stopped", channelsDone: 1, channelsTotal: 2, scanned: 12, startedAt: null });
  db.update(schema.activityBackfill).set({ doneAt: 200 }).where(eq(schema.activityBackfill.channelId, "b")).run();
  expect(getBackfillStatus().status).toBe("done");
});

test("channels the bot cannot see or that vanish are marked done and do not abort the run", async () => {
  const denied = (code: number) => Object.assign(new Error("discord"), { code });
  const failing = (id: string, code: number): BackfillChannel => ({
    id,
    name: `#${id}`,
    parentId: null,
    fetchPage: async () => {
      throw denied(code);
    },
    fetchReactionPage: async () => [],
  });
  const broken: BackfillChannel = {
    id: "bad",
    name: "#bad",
    parentId: null,
    fetchPage: async () => {
      throw new Error("network");
    },
    fetchReactionPage: async () => [],
  };
  const channels = [failing("no-view", 50001), failing("no-perm", 50013), failing("gone", 10003), broken, gatedChannel("ok", pagesOf([2], "ok"))];
  startBackfill(ctx, { reactions: false }, { listChannels: async () => full(channels), sleep: noSleep });
  await whenBackfillSettled();

  for (const id of ["no-view", "no-perm", "gone", "ok"]) expect(row(id)!.doneAt).not.toBeNull();
  // A message-only run never stamps the reaction pass, not even on the skip path.
  expect(db.select().from(schema.activityBackfill).all().every((r) => r.reactionsDoneAt === null)).toBe(true);
  expect(row("bad")!.doneAt).toBeNull();
  const s = getBackfillStatus();
  expect(s.errors).toBe(1);
  expect(s.channelsDone).toBe(4);
  expect(s.channelsTotal).toBe(5);
  expect(s.status).toBe("stopped");
  expect(messageCount()).toBe(2);
});

test("a run that cannot list the channels ends failed", async () => {
  startBackfill(ctx, { reactions: false }, {
    listChannels: async () => {
      throw new Error("no guild");
    },
  });
  await whenBackfillSettled();
  expect(getBackfillStatus().status).toBe("failed");
});

/** A fake message with reactions by the given users. */
function reacted(id: number, authorBot = false): ReactionMessage {
  const users = (ids: string[]) => async () => ids.map((u) => ({ id: u, bot: u.startsWith("bot") }));
  return {
    id: String(id),
    authorId: "author",
    authorBot,
    createdTimestamp: 1_800_000_000_000,
    reactions: [
      { emoji: "👍", name: null, users: users(["u1", "u2"]) },
      { emoji: "custom:77", name: "pog", users: users(["u1", "bot9"]) },
    ],
  };
}

test("the reaction pass writes one row per reactor, skips bots and marks reactionsDoneAt", async () => {
  const pages = [[reacted(5), reacted(4, true)]];
  const fetchPage = async (before: string | null) => (before === null ? pages[0]! : []);
  await backfillReactions("c1", null, fetchPage, fast);

  const rows = db.select().from(schema.activityReactions).all();
  expect(rows.length).toBe(6);
  const first = rows.filter((r) => r.messageId === "5");
  expect(first.map((r) => `${r.userId}:${r.emoji}`).sort()).toEqual(["u1:custom:77", "u1:👍", "u2:👍"]);
  expect(first.every((r) => r.messageAuthorId === "author")).toBe(true);
  expect(rows.filter((r) => r.messageId === "4").every((r) => r.messageAuthorId === null)).toBe(true);
  expect(row("c1")!.reactionsDoneAt).not.toBeNull();

  // Running it again adds nothing.
  db.update(schema.activityBackfill).set({ reactionsDoneAt: null }).run();
  await backfillReactions("c1", null, fetchPage, fast);
  expect(db.select().from(schema.activityReactions).all().length).toBe(6);
});

test("the reaction pass skips an excluded parent channel and carries the parent id", async () => {
  const fetchPage = async (before: string | null) => (before === null ? [reacted(5)] : []);
  await backfillReactions("t1", "p1", fetchPage, fast);
  expect(db.select().from(schema.activityReactions).all().every((r) => r.parentChannelId === "p1")).toBe(true);

  db.delete(schema.activityReactions).run();
  setExcluded("p1");
  const calls: (string | null)[] = [];
  await backfillReactions("t2", "p1", async (b) => (calls.push(b), []), fast);
  expect(calls).toEqual([]);
  expect(row("t2")!.reactionsDoneAt).not.toBeNull();
});

test("startBackfill with reactions runs the reaction pass after the messages", async () => {
  const ch: BackfillChannel = {
    ...gatedChannel("c1", pagesOf([2])),
    fetchReactionPage: async (before) => (before === null ? [reacted(100)] : []),
  };
  startBackfill(ctx, { reactions: true }, { listChannels: async () => full([ch]), sleep: noSleep });
  await whenBackfillSettled();
  expect(row("c1")!.reactionsDoneAt).not.toBeNull();
  expect(db.select().from(schema.activityReactions).all().length).toBe(3);
  expect(getBackfillStatus().reactions).toBe(true);
});

test("a row for a channel that is no longer listed does not pin the status", async () => {
  db.insert(schema.activityBackfill).values({ channelId: "deleted", scanned: 4, beforeId: "9" }).run();
  startBackfill(ctx, { reactions: false }, { listChannels: async () => full([gatedChannel("c1", pagesOf([2]))]), sleep: noSleep });
  await whenBackfillSettled();
  expect(row("deleted")!.doneAt).not.toBeNull();
  expect(getBackfillStatus()).toMatchObject({ status: "done", channelsDone: 2, channelsTotal: 2 });
});

test("a stopped reaction pass reads stopped, and finishing it reads done", async () => {
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  const ch: BackfillChannel = {
    ...gatedChannel("c1", pagesOf([2])),
    fetchReactionPage: async (before) => {
      await gate;
      return before === null ? [reacted(100)] : [];
    },
  };
  const deps = { listChannels: async () => full([ch]), sleep: noSleep };
  startBackfill(ctx, { reactions: true }, deps);
  await Bun.sleep(10);
  // The messages are read; the run is waiting on the reaction pass.
  expect(row("c1")!.doneAt).not.toBeNull();
  expect(stopBackfill()).toBe("stopping");
  release();
  await whenBackfillSettled();
  expect(row("c1")!.reactionsDoneAt).toBeNull();
  expect(getBackfillStatus()).toMatchObject({ status: "stopped", channelsDone: 1, reactions: true });

  // Starting again with reactions finishes the pass.
  startBackfill(ctx, { reactions: true }, deps);
  await whenBackfillSettled();
  expect(row("c1")!.reactionsDoneAt).not.toBeNull();
  expect(getBackfillStatus().status).toBe("done");
});

test("a message-only run reads done without any reaction pass", async () => {
  startBackfill(ctx, { reactions: false }, { listChannels: async () => full([gatedChannel("c1", pagesOf([2]))]), sleep: noSleep });
  await whenBackfillSettled();
  expect(row("c1")!.reactionsDoneAt).toBeNull();
  expect(getBackfillStatus()).toMatchObject({ status: "done", reactions: false });
});

test("a skippable error on a reaction run marks both passes done", async () => {
  const gone: BackfillChannel = {
    id: "gone",
    name: "#gone",
    parentId: null,
    fetchPage: async () => {
      throw Object.assign(new Error("unknown channel"), { code: 10003 });
    },
    fetchReactionPage: async () => [],
  };
  startBackfill(ctx, { reactions: true }, { listChannels: async () => full([gone]), sleep: noSleep });
  await whenBackfillSettled();
  expect(row("gone")!.reactionsDoneAt).not.toBeNull();
  expect(getBackfillStatus().status).toBe("done");
});

test("a partial listing leaves unfinished rows untouched and still reads the listed channels", async () => {
  db.insert(schema.activityBackfill).values({ channelId: "archived-thread", scanned: 4, beforeId: "9" }).run();
  startBackfill(ctx, { reactions: false }, {
    listChannels: async () => ({ channels: [gatedChannel("c1", pagesOf([2]))], complete: false }),
    sleep: noSleep,
  });
  await whenBackfillSettled();
  expect(row("archived-thread")!.doneAt).toBeNull();
  expect(row("c1")!.doneAt).not.toBeNull();
  expect(messageCount()).toBe(2);
  expect(getBackfillStatus()).toMatchObject({ status: "stopped", channelsDone: 1, channelsTotal: 2 });

  // Once a complete listing no longer has it, the row is closed.
  startBackfill(ctx, { reactions: false }, { listChannels: async () => full([gatedChannel("c1", pagesOf([2]))]), sleep: noSleep });
  await whenBackfillSettled();
  expect(row("archived-thread")!.doneAt).not.toBeNull();
  expect(getBackfillStatus().status).toBe("done");
});
