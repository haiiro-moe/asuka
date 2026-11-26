import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, setSystemTime, spyOn, test } from "bun:test";
import { db, initDb, schema } from "../../../db/index.ts";
import { nowSec } from "../../../core/util.ts";
import { WrappedCard } from "../../../core/images/components/wrapped-card.tsx";
import { WrappedServerCard } from "../../../core/images/components/wrapped-server-card.tsx";
import { renderWrappedCardPng, renderWrappedServerCardPng } from "../../../core/images/index.tsx";
import { closeVoiceSegment, openVoiceSegment, recordMessage } from "../record.ts";
import * as voiceReadyModule from "../voice-ready.ts";
import { buildWrapped } from "./data.ts";
import { setOptIn } from "./optin.ts";
import { startWrappedRun, waitForWrappedRun, wrappedRunTiming } from "./run.ts";
import { buildServerWrapped } from "./server.ts";
import { startWrappedPreview, waitForWrappedPreviews } from "./preview.ts";
import { getWrappedLink } from "./links.ts";
import { allStrings, fakeClient, fakeCtx, msg, resetWrappedTables } from "./testing.ts";

const DAY = 86400;
/** Ten days ago: recent enough that voice recorded from then is not ready. */
const T = nowSec() - 10 * DAY;
/** The UTC year of {@link T}. */
const YEAR = new Date(T * 1000).getUTCFullYear();

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

/** Open and close a voice segment. */
function voice(userId: string, channelId: string, from: number, to: number) {
  openVoiceSegment(userId, { channelId, muted: false, deafened: false, streaming: false, video: false }, from);
  closeVoiceSegment(userId, to);
}

/**
 * u1 spends 20 hours in voice with u2 (club c1's voice channel) and replies to
 * u3 twice; u3 replies to u1 once. All within the last ten days.
 */
function seed() {
  db.insert(schema.clubs).values({ id: 1, name: "club one", ownerId: "u1", status: "approved", channelId: "cc", voiceChannelId: "v1" }).run();
  db.insert(schema.clubs).values({ id: 2, name: "club two", ownerId: "u9", status: "approved", channelId: "cc2" }).run();
  for (let i = 0; i < 2; i++) recordMessage(msg("u1", T + i, { replyToUserId: "u3", replyToMessageId: `p${i}` }));
  recordMessage(msg("u3", T + 5, { replyToUserId: "u1", replyToMessageId: "q0" }));
  voice("u1", "v1", T, T + 20 * 3600);
  voice("u2", "v1", T, T + 20 * 3600);
  setOptIn("u1", true);
  setOptIn("u2", true);
  setOptIn("u3", true);
}

/** A segment old enough (100 days, over two whole months) to make voice ready. */
function oldVoice() {
  voice("old", "elsewhere", nowSec() - 100 * DAY, nowSec() - 100 * DAY + 60);
}

test("with no voice rows the member snapshot has no voice figure", () => {
  recordMessage(msg("u1", T));
  const data = buildWrapped("u1", YEAR)!;
  expect(data.voiceHours).toBeNull();
  expect(data.voiceReady).toBe(false);
});

test("with under two whole months of voice: no voice hours, no voice titles, soulmate without voice, no club voice rank", () => {
  seed();
  const data = buildWrapped("u1", YEAR)!;
  expect(data.voiceReady).toBe(false);
  expect(data.voiceHours).toBeNull();
  // u2 shares 20 hours of calls with u1, but only replies count: u3.
  expect(data.soulmateId).toBe("u3");
  for (const key of ["longest-voice", "most-voice-hours", "club-most-voice"]) {
    expect(data.titles.map((t) => t.key)).not.toContain(key);
  }
  expect(data.club!.voiceRank).toBeNull();

  const server = buildServerWrapped(YEAR)!;
  expect(server.voiceReady).toBe(false);
  expect(server.voiceHours).toBeNull();
  // Chosen by replies alone: u1 and u3.
  expect(server.bestPair).toMatchObject({ aId: "u1", bId: "u3", replies: 3, voiceHours: null });
});

test("with an earliest segment three months old everything is normal", () => {
  seed();
  oldVoice();
  const data = buildWrapped("u1", YEAR)!;
  expect(data.voiceReady).toBe(true);
  expect(data.voiceHours).toBe(20);
  expect(data.soulmateId).toBe("u2");
  expect(data.titles.map((t) => t.key)).toEqual(expect.arrayContaining(["longest-voice", "most-voice-hours"]));
  expect(data.club!.voiceRank).toBe(1);

  const server = buildServerWrapped(YEAR)!;
  expect(server.voiceReady).toBe(true);
  expect(typeof server.voiceHours).toBe("number");
  expect(server.bestPair).toMatchObject({ aId: "u1", bId: "u2", voiceHours: 20 });
});

test("a run checks voice readiness once, not once per member", async () => {
  seed();
  for (let i = 0; i < 5; i++) recordMessage(msg(`m${i}`, T + 100 + i));
  const spy = spyOn(voiceReadyModule, "voiceReadinessForYear");
  try {
    const { client } = fakeClient();
    startWrappedRun(fakeCtx(client), { year: YEAR, startedBy: "admin" });
    await waitForWrappedRun();
    expect(spy).toHaveBeenCalledTimes(1);
  } finally {
    spy.mockRestore();
  }
});

test("the cards render without voice figures when voice is not ready", async () => {
  seed();
  const data = buildWrapped("u1", YEAR)!;
  const card = WrappedCard({ data, displayName: "u1", avatarDataUri: null });
  expect(allStrings(card)).not.toContain("in voice");
  expect(await renderWrappedCardPng(data, "u1")).toBeInstanceOf(Buffer);

  const server = buildServerWrapped(YEAR)!;
  expect(allStrings(WrappedServerCard({ data: server }))).not.toContain("in voice");
  expect(await renderWrappedServerCardPng(server)).toBeInstanceOf(Buffer);

  // With voice ready the voice row is there.
  oldVoice();
  const ready = buildWrapped("u1", YEAR)!;
  expect(allStrings(WrappedCard({ data: ready, displayName: "u1", avatarDataUri: null }))).toContain("in voice");
});

describe("voice readiness at the year's end", () => {
  /** Voice from 15 Nov 2026: ready on 1 Feb 2027, so never ready inside 2026. */
  function lateVoice(a = "u1", b = "u2") {
    voice(a, "v1", Date.UTC(2026, 10, 15) / 1000, Date.UTC(2026, 10, 15, 20) / 1000);
    voice(b, "v1", Date.UTC(2026, 10, 15) / 1000, Date.UTC(2026, 10, 15, 20) / 1000);
    recordMessage(msg(a, Date.UTC(2026, 10, 16) / 1000));
  }

  afterEach(() => {
    setSystemTime();
  });

  test("voiceReadinessForYear judges a finished year at its last second", () => {
    lateVoice();
    setSystemTime(new Date("2027-03-01T00:00:00Z"));
    expect(voiceReadyModule.voiceReadiness().ready).toBe(true);
    expect(voiceReadyModule.voiceReadinessForYear(2026).ready).toBe(false);
    expect(voiceReadyModule.voiceReadinessForYear(2027).ready).toBe(true);
  });

  test("processing 2026 in March 2027 shows no voice in the member, server and run snapshots", async () => {
    lateVoice();
    setSystemTime(new Date("2027-03-01T00:00:00Z"));
    const data = buildWrapped("u1", 2026)!;
    expect(data.voiceReady).toBe(false);
    expect(data.voiceHours).toBeNull();
    expect(buildServerWrapped(2026)!.voiceHours).toBeNull();

    const { client } = fakeClient();
    startWrappedRun(fakeCtx(client), { year: 2026, startedBy: "admin" });
    await waitForWrappedRun();
    const row = db.select().from(schema.activityWrappedLinks).all().find((l) => l.userId === "u1" && l.private === 0)!;
    expect(JSON.parse(row.data).voiceReady).toBe(false);
    expect(getWrappedLink("u2", 2026)).toBeNull();
  });

  test("the private preview of 2026 in March 2027 shows no voice either", async () => {
    lateVoice("11", "12");
    setSystemTime(new Date("2027-03-01T00:00:00Z"));
    const { client } = fakeClient();
    expect(startWrappedPreview(fakeCtx(client), { ownerUserId: "11", year: 2026, members: ["11"] }).result).toBe("started");
    await waitForWrappedPreviews();
    const run = db.select().from(schema.activityWrappedRuns).all().find((r) => r.kind === "private")!;
    expect(JSON.parse(run.preview!).voiceReady).toBe(false);
  });
});
