import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import type { VoiceState } from "discord.js";
import { eq } from "drizzle-orm";
import { db, initDb, schema } from "../../../db/index.ts";
import type { VoiceSnapshot } from "../record.ts";
import { planVoice, snapshotOf } from "./voice.ts";
import type { OpenVoiceSegment } from "./voice.ts";

/** Write the excluded-channel list onto the singleton config row. */
function setExcluded(list: string) {
  db.update(schema.guildConfig)
    .set({ activityExcludedChannelIds: list })
    .where(eq(schema.guildConfig.id, 1))
    .run();
}

beforeAll(() => {
  initDb();
});

beforeEach(() => {
  setExcluded("");
});

afterAll(() => {
  setExcluded("");
});

/** Member A connected to `c1` with every flag off. */
const A: VoiceSnapshot = { channelId: "c1", muted: false, deafened: false, streaming: false, video: false };

/** A's snapshot as the open segment it produced. */
function open(s: VoiceSnapshot): OpenVoiceSegment {
  return { ...s, startedAt: 1_800_000_000 };
}

describe("planVoice", () => {
  test("joining opens a segment", () => {
    expect(planVoice(null, A)).toEqual([{ kind: "open", snapshot: A }]);
  });

  test("leaving closes the segment", () => {
    expect(planVoice(open(A), null)).toEqual([{ kind: "close" }]);
  });

  test("an unchanged state does nothing", () => {
    expect(planVoice(open(A), A)).toEqual([]);
  });

  test("a flag change closes and reopens", () => {
    const muted = { ...A, muted: true };
    expect(planVoice(open(A), muted)).toEqual([{ kind: "close" }, { kind: "open", snapshot: muted }]);
  });

  test("a channel move closes and reopens", () => {
    const moved = { ...A, channelId: "c2" };
    expect(planVoice(open(A), moved)).toEqual([{ kind: "close" }, { kind: "open", snapshot: moved }]);
  });

  test("not connected before or after does nothing", () => {
    expect(planVoice(null, null)).toEqual([]);
  });
});

/** A fake discord.js voice state. */
function state(over: Partial<Record<keyof VoiceState, unknown>> = {}): VoiceState {
  return {
    id: "u1",
    channelId: "c1",
    selfMute: false,
    serverMute: false,
    selfDeaf: false,
    serverDeaf: false,
    streaming: false,
    selfVideo: false,
    ...over,
  } as unknown as VoiceState;
}

describe("snapshotOf", () => {
  test("reads the channel and flags", () => {
    expect(snapshotOf(state())).toEqual(A);
  });

  test("self or server mute and deafen both count", () => {
    expect(snapshotOf(state({ serverMute: true, selfDeaf: true }))).toEqual({ ...A, muted: true, deafened: true });
    expect(snapshotOf(state({ selfMute: true, serverDeaf: true }))).toEqual({ ...A, muted: true, deafened: true });
  });

  test("streaming and video", () => {
    expect(snapshotOf(state({ streaming: true, selfVideo: true }))).toEqual({ ...A, streaming: true, video: true });
  });

  test("null flags count as off", () => {
    expect(snapshotOf(state({ selfMute: null, streaming: null, selfVideo: null }))).toEqual(A);
  });

  test("not in a channel gives null", () => {
    expect(snapshotOf(state({ channelId: null }))).toBeNull();
  });

  test("an excluded channel gives null", () => {
    setExcluded("c9,c1");
    expect(snapshotOf(state())).toBeNull();
  });
});
