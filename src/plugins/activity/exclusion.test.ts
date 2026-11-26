import { afterAll, beforeAll, beforeEach, expect, test } from "bun:test";
import { and, eq } from "drizzle-orm";
import { db, initDb, schema } from "../../db/index.ts";
import { excludedChannelIds, isExcluded, notExcluded } from "./exclusion.ts";

/** Write the excluded-channel list onto the singleton config row. */
function setExcluded(list: string) {
  db.update(schema.guildConfig)
    .set({ activityExcludedChannelIds: list })
    .where(eq(schema.guildConfig.id, 1))
    .run();
}

/** Insert one message row in `channelId`, optionally as a thread under `parentChannelId`. */
function seedMessage(messageId: string, channelId: string, parentChannelId: string | null = null) {
  db.insert(schema.activityMessages)
    .values({ messageId, userId: "u1", channelId, parentChannelId, ts: 1_800_000_000, source: "live" })
    .run();
}

/** The message ids `notExcluded` lets through, sorted. */
function visibleIds(withParent: boolean): string[] {
  const filter = withParent
    ? notExcluded(schema.activityMessages.channelId, schema.activityMessages.parentChannelId)
    : notExcluded(schema.activityMessages.channelId);
  return db
    .select({ messageId: schema.activityMessages.messageId })
    .from(schema.activityMessages)
    .where(filter)
    .all()
    .map((row) => row.messageId)
    .sort();
}

// bun test runs with NODE_ENV=test, so the database is in-memory.
beforeAll(() => {
  initDb();
});

beforeEach(() => {
  db.delete(schema.activityMessages).run();
  setExcluded("");
});

// Other test files share this database: leave the config row as seeded.
afterAll(() => {
  db.delete(schema.activityMessages).run();
  setExcluded("");
});

test("excludedChannelIds parses the comma list", () => {
  expect(excludedChannelIds()).toEqual(new Set());
  setExcluded("c1, c2,,c3 ");
  expect(excludedChannelIds()).toEqual(new Set(["c1", "c2", "c3"]));
});

test("excludedChannelIds reads the config on every call", () => {
  setExcluded("c1");
  expect(excludedChannelIds().has("c1")).toBe(true);
  setExcluded("c2");
  expect(excludedChannelIds()).toEqual(new Set(["c2"]));
});

test("isExcluded matches the channel or its parent", () => {
  setExcluded("c1");
  expect(isExcluded("c1")).toBe(true);
  expect(isExcluded("x", "c1")).toBe(true);
  expect(isExcluded("c2")).toBe(false);
  expect(isExcluded("c2", null)).toBe(false);
  expect(isExcluded("c2", "c3")).toBe(false);
});

test("nothing is excluded with an empty list", () => {
  expect(isExcluded("c1")).toBe(false);
  expect(isExcluded("x", "c1")).toBe(false);
});

test("notExcluded keeps every row when the list is empty", () => {
  seedMessage("m1", "c1");
  seedMessage("m2", "c2");
  seedMessage("m3", "t1", "c1");
  expect(visibleIds(false)).toEqual(["m1", "m2", "m3"]);
  expect(visibleIds(true)).toEqual(["m1", "m2", "m3"]);
});

test("notExcluded hides rows in an excluded channel", () => {
  seedMessage("m1", "c1");
  seedMessage("m2", "c2");
  seedMessage("m3", "c3");
  setExcluded("c1,c3");
  expect(visibleIds(false)).toEqual(["m2"]);
  expect(visibleIds(true)).toEqual(["m2"]);
});

test("notExcluded hides a thread whose parent channel is excluded", () => {
  seedMessage("m-channel", "c2");
  seedMessage("m-thread-excluded", "t1", "c1");
  seedMessage("m-thread-open", "t2", "c2");
  setExcluded("c1");
  expect(visibleIds(true)).toEqual(["m-channel", "m-thread-open"]);
  // Without the parent column only the channel itself is checked.
  expect(visibleIds(false)).toEqual(["m-channel", "m-thread-excluded", "m-thread-open"]);
});

test("notExcluded hides an excluded thread under an open parent", () => {
  seedMessage("m-thread", "t1", "c2");
  seedMessage("m-other", "t2", "c2");
  setExcluded("t1");
  expect(visibleIds(true)).toEqual(["m-other"]);
});

test("notExcluded combines with other conditions through and()", () => {
  seedMessage("m1", "c1");
  seedMessage("m2", "c2");
  seedMessage("m3", "c2");
  setExcluded("c1");
  const rows = db
    .select({ messageId: schema.activityMessages.messageId })
    .from(schema.activityMessages)
    .where(
      and(
        eq(schema.activityMessages.messageId, "m2"),
        notExcluded(schema.activityMessages.channelId, schema.activityMessages.parentChannelId),
      ),
    )
    .all();
  expect(rows).toEqual([{ messageId: "m2" }]);
});

test("a channel excluded after rows were written drops out", () => {
  seedMessage("m1", "c1");
  expect(visibleIds(true)).toEqual(["m1"]);
  setExcluded("c1");
  expect(visibleIds(true)).toEqual([]);
});
