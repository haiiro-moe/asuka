import { describe, expect, test } from "bun:test";
import type { ServerWrapped, WrappedData } from "../../../../plugins/activity/types/wrapped.ts";
import {
  STEPS_PER_SLIDE,
  emojiKeyLabel,
  emojiLabel,
  go,
  hourLabel,
  keyAction,
  ordinal,
  personalSlides,
  readoutSize,
  segmentFill,
  serverSlides,
  tick,
  veilFrame,
  type StoryState,
} from "./story.ts";

/** A member with a full year: every optional part present. */
function fullData(over: Partial<WrappedData> = {}): WrappedData {
  return {
    year: 2026,
    messages: 1200,
    voiceHours: 40.5,
    topEmoji: [{ emoji: "🐟", name: null, count: 30 }],
    busiestHour: 21,
    busiestDay: "tuesday",
    soulmateId: "2",
    mostRepliedToId: "3",
    topChannelId: "10",
    xpLevel: 12,
    club: { clubId: 1, name: "tea", members: 5, messages: 300, messagesRank: 1, membersRank: 2, voiceRank: 1, clubs: 4 },
    presidency: {
      terms: 1,
      daysInOffice: 90,
      votes: 12,
      votePercent: 60,
      messagesInOffice: 400,
      perDay: 4.4,
      serverActivityPercent: 12,
      topEmojiInOffice: "🐟",
    },
    titles: [{ key: "night-owl", label: "night owl", detail: "1st of 43, most after midnight" }],
    voiceReady: true,
    ...over,
  };
}

/** A member with almost nothing: no messages, no voice, no counterpart. */
function emptyData(): WrappedData {
  return fullData({
    messages: 0,
    voiceHours: null,
    topEmoji: [],
    busiestHour: null,
    busiestDay: null,
    soulmateId: null,
    mostRepliedToId: null,
    topChannelId: null,
    club: null,
    presidency: null,
    titles: [],
    voiceReady: false,
  });
}

function serverData(over: Partial<ServerWrapped> = {}): ServerWrapped {
  return {
    year: 2026,
    voiceReady: true,
    messages: 50000,
    speakers: 120,
    voiceHours: 900.5,
    topEmoji: [{ emoji: "🐟", name: null, count: 300 }],
    unusedCustomEmoji: 4,
    topChannels: [{ channelId: "1", name: "general", parentName: null, count: 20000 }],
    busiestHour: 20,
    busiestWeekday: "friday",
    bestPair: { aId: "1", aName: "a", bId: "2", bName: "b", replies: 300, voiceHours: 10 },
    bestClub: { name: "tea", founderName: "c", members: 9, messages: 900 },
    president: { name: "d", terms: 1, daysInOffice: 90, serverActivityPercent: 5, elections: 2, candidates: 5 },
    ...over,
  };
}

describe("personalSlides", () => {
  test("includes every slide in order for a full year", () => {
    expect(personalSlides(fullData())).toEqual([
      "intro",
      "messages",
      "hour",
      "emoji",
      "voice",
      "soulmate",
      "club",
      "president",
      "titles",
      "outro",
    ]);
  });

  test("omits club, president and titles when the data has none", () => {
    const slides = personalSlides(fullData({ club: null, presidency: null, titles: [] }));
    expect(slides).toEqual(["intro", "messages", "hour", "emoji", "voice", "soulmate", "outro"]);
  });

  test("skips the voice slide when voice hours are withheld", () => {
    expect(personalSlides(fullData({ voiceHours: null }))).not.toContain("voice");
  });

  test("shows a zero voice figure only when it is a real zero", () => {
    expect(personalSlides(fullData({ voiceHours: 0 }))).toContain("voice");
  });

  test("a member with almost nothing still gets the intro and the outro", () => {
    expect(personalSlides(emptyData())).toEqual(["intro", "outro"]);
  });

  test("keeps the soulmate slide when only a most-replied-to member is known", () => {
    expect(personalSlides(fullData({ soulmateId: null }))).toContain("soulmate");
  });
});

describe("serverSlides", () => {
  test("has the fixed nine slides when every part is present", () => {
    expect(serverSlides(serverData())).toEqual([
      "intro",
      "totals",
      "emoji",
      "channels",
      "rhythm",
      "pair",
      "club",
      "president",
      "outro",
    ]);
  });

  test("skips pair, club and president when they are null", () => {
    expect(serverSlides(serverData({ bestPair: null, bestClub: null, president: null }))).toEqual([
      "intro",
      "totals",
      "emoji",
      "channels",
      "rhythm",
      "outro",
    ]);
  });
});

describe("tick", () => {
  const start: StoryState = { slide: 0, step: 0, paused: false };

  test("six ticks move to the next slide", () => {
    let s = start;
    for (let i = 0; i < STEPS_PER_SLIDE; i++) s = tick(s, 10);
    expect(s).toEqual({ slide: 1, step: 0, paused: false });
  });

  test("one tick adds a step", () => {
    expect(tick(start, 10)).toEqual({ slide: 0, step: 1, paused: false });
  });

  test("a paused state is unchanged", () => {
    const paused = { slide: 2, step: 3, paused: true };
    expect(tick(paused, 10)).toBe(paused);
  });

  test("the last slide never advances", () => {
    let s: StoryState = { slide: 9, step: 0, paused: false };
    for (let i = 0; i < 20; i++) s = tick(s, 10);
    expect(s.slide).toBe(9);
  });
});

describe("go", () => {
  const s: StoryState = { slide: 3, step: 4, paused: true };

  test("clamps to the first and last slide", () => {
    expect(go(s, -3, 7).slide).toBe(0);
    expect(go(s, 99, 7).slide).toBe(6);
  });

  test("resets the step and keeps the pause", () => {
    expect(go(s, 4, 7)).toEqual({ slide: 4, step: 0, paused: true });
  });
});

describe("veilFrame", () => {
  test("three frames over 300 ms, then nothing", () => {
    expect(veilFrame(0)).toBe(1);
    expect(veilFrame(99)).toBe(1);
    expect(veilFrame(100)).toBe(2);
    expect(veilFrame(150)).toBe(2);
    expect(veilFrame(250)).toBe(3);
    expect(veilFrame(300)).toBe(0);
    expect(veilFrame(-1)).toBe(0);
  });
});

describe("segmentFill", () => {
  test("past segments are full, later ones empty, the current one stepped", () => {
    const s: StoryState = { slide: 2, step: 3, paused: false };
    expect(segmentFill(s, 1, 5)).toBe(100);
    expect(segmentFill(s, 3, 5)).toBe(0);
    expect(segmentFill(s, 2, 5)).toBe(50);
  });

  test("the last slide's segment is full once reached", () => {
    expect(segmentFill({ slide: 4, step: 0, paused: false }, 4, 5)).toBe(100);
  });
});

describe("keyAction", () => {
  test("arrows move and space toggles", () => {
    expect(keyAction("ArrowLeft")).toBe("prev");
    expect(keyAction("ArrowRight")).toBe("next");
    expect(keyAction(" ")).toBe("toggle");
    expect(keyAction("Enter")).toBeNull();
  });
});

describe("labels", () => {
  test("hourLabel pads the UTC hour", () => {
    expect(hourLabel(7)).toBe("07:00");
    expect(hourLabel(21)).toBe("21:00");
  });

  test("ordinal", () => {
    expect([1, 2, 3, 4, 11, 12, 13, 21, 22, 101, 111].map(ordinal)).toEqual([
      "1st",
      "2nd",
      "3rd",
      "4th",
      "11th",
      "12th",
      "13th",
      "21st",
      "22nd",
      "101st",
      "111th",
    ]);
  });

  test("emojiLabel shows a custom emoji by name and a unicode one as itself", () => {
    expect(emojiLabel({ emoji: "custom:99", name: "fish" })).toBe(":fish:");
    expect(emojiLabel({ emoji: "custom:99", name: null })).toBe(":custom:");
    expect(emojiLabel({ emoji: "🐟", name: null })).toBe("🐟");
  });

  test("emojiKeyLabel resolves a custom key from the known emoji", () => {
    const known = [{ emoji: "custom:99", name: "fish", count: 1 }];
    expect(emojiKeyLabel("custom:99", known)).toBe(":fish:");
    expect(emojiKeyLabel("custom:7", known)).toBe(":custom:");
    expect(emojiKeyLabel("🐟", known)).toBe("🐟");
  });

  test("readoutSize keeps short readouts at 86px and never goes below 64px", () => {
    expect(readoutSize("2026")).toBe(86);
    expect(readoutSize("1,234,567")).toBe(64);
  });
});
