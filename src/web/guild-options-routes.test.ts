import { describe, expect, test } from "bun:test";
import { ChannelType } from "discord.js";
import { guildOptionsRoutes, mapGuildOptions } from "./guild-options-routes.ts";

const G = "guild";
const ch = (id: string, name: string, type: number, parentId: string | null, rawPosition: number) => ({
  id,
  name,
  type,
  parentId,
  rawPosition,
});

describe("mapGuildOptions channels", () => {
  const channels = [
    ch("v1", "lounge", ChannelType.GuildVoice, "catB", 0),
    ch("t2", "second", ChannelType.GuildText, "catA", 1),
    ch("catB", "b side", ChannelType.GuildCategory, null, 1),
    ch("t1", "first", ChannelType.GuildText, "catA", 0),
    ch("catA", "a side", ChannelType.GuildCategory, null, 0),
    ch("free", "free", ChannelType.GuildText, null, 5),
    ch("ann", "news", ChannelType.GuildAnnouncement, "catB", 1),
    ch("st", "stage", ChannelType.GuildStageVoice, "catB", 2),
    ch("fo", "forum", ChannelType.GuildForum, "catB", 3),
    ch("th", "thread", ChannelType.PublicThread, "t1", 0),
    ch("pth", "private", ChannelType.PrivateThread, "t1", 0),
    ch("ath", "ann thread", ChannelType.AnnouncementThread, "ann", 0),
  ];
  const out = mapGuildOptions(channels, [], G).channels;

  test("excludes threads", () => {
    expect(out.map((c) => c.id)).not.toContain("th");
    expect(out.map((c) => c.id)).not.toContain("pth");
    expect(out.map((c) => c.id)).not.toContain("ath");
  });

  test("orders uncategorised first, then category and children by position", () => {
    expect(out.map((c) => c.id)).toEqual([
      "free",
      "catA",
      "t1",
      "t2",
      "catB",
      "v1",
      "ann",
      "st",
      "fo",
    ]);
  });

  test("maps kinds", () => {
    const kind = Object.fromEntries(out.map((c) => [c.id, c.kind]));
    expect(kind).toMatchObject({
      t1: "text",
      ann: "announcement",
      v1: "voice",
      st: "stage",
      fo: "forum",
      catA: "category",
    });
  });

  test("fills parent id and name, null for categories and uncategorised", () => {
    const by = Object.fromEntries(out.map((c) => [c.id, c]));
    expect(by.t1).toMatchObject({ parentId: "catA", parentName: "a side", position: 0 });
    expect(by.catA).toMatchObject({ parentId: null, parentName: null });
    expect(by.free).toMatchObject({ parentId: null, parentName: null });
  });

  test("treats a missing parent category as uncategorised", () => {
    const r = mapGuildOptions([ch("x", "x", ChannelType.GuildText, "gone", 0)], [], G);
    expect(r.channels[0]).toMatchObject({ parentId: null, parentName: null });
  });
});

describe("mapGuildOptions roles", () => {
  const roles = [
    { id: G, name: "@everyone", color: 0, position: 0 },
    { id: "low", name: "low", color: 0xff0000, position: 1 },
    { id: "bot", name: "bot", color: 0, position: 5, managed: true },
    { id: "high", name: "high", color: 0x00ff00, position: 9 },
  ];
  const out = mapGuildOptions([], roles, G).roles;

  test("excludes @everyone and sorts by position descending", () => {
    expect(out.map((r) => r.id)).toEqual(["high", "bot", "low"]);
  });

  test("maps colour and managed", () => {
    expect(out[0]).toEqual({ id: "high", name: "high", colour: 0x00ff00, position: 9, managed: false });
    expect(out[1]?.managed).toBe(true);
  });
});

describe("GET /api/guild-options", () => {
  const route = guildOptionsRoutes[0]!;

  test("is an admin GET route", () => {
    expect(route.method).toBe("GET");
    expect(route.path).toBe("/api/guild-options");
    expect(route.access).toBe("admin");
  });

  test("returns empty lists when the guild is not cached", async () => {
    const ctx = { client: { guilds: { cache: new Map() } }, guildId: G } as never;
    const res = await route.handle(new Request("http://x/api/guild-options"), ctx as never);
    expect(await res.json()).toEqual({ channels: [], roles: [] });
  });

  test("maps a cached guild", async () => {
    const guild = {
      channels: { cache: new Map([["a", ch("a", "a", ChannelType.GuildText, null, 0)]]) },
      roles: { cache: new Map([["r", { id: "r", name: "r", color: 1, position: 2, managed: false }]]) },
    };
    const ctx = { client: { guilds: { cache: new Map([[G, guild]]) } }, guildId: G };
    const res = await route.handle(new Request("http://x/api/guild-options"), ctx as never);
    const body = (await res.json()) as { channels: unknown[]; roles: unknown[] };
    expect(body.channels).toHaveLength(1);
    expect(body.roles).toHaveLength(1);
  });
});
