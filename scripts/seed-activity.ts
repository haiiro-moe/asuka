#!/usr/bin/env bun
/**
 * Fill a throwaway database with fake activity, so the analytics views have
 * something to draw during development.
 *
 * It writes 20 fake members and 90 days of messages, replies, mentions, emoji,
 * reactions, voice segments, joins and leaves, command runs and Social Credits
 * changes. Everything goes through the activity write API
 * (src/plugins/activity/record.ts), and messages also through
 * `extractMessageFacts`, so the rows are what live capture would have written.
 *
 * The random numbers come from a fixed seed, so every run has the same members
 * behaving the same way. The 90 days end at the current time, and where the
 * weekends fall shifts the draws, so the exact rows depend on the day it is
 * run. Set `SEED_NOW` (unix seconds) to pin the end time: two runs with the same
 * `SEED_NOW` write identical rows.
 *
 * It refuses to touch the bot's own database: `DATABASE_PATH` must be set and
 * must not be a file named `asuka.sqlite` (the default path, and the one
 * deploy.sh sets up). On a refusal it prints why and exits 1.
 *
 * Usage (from the repo root):
 *   DATABASE_PATH=/tmp/asuka-seed.sqlite bun scripts/seed-activity.ts
 *   DATABASE_PATH=/tmp/asuka-seed.sqlite SEED_NOW=1800000000 bun scripts/seed-activity.ts
 *
 * The file is created and migrated if it does not exist. A database that
 * already holds the seed members is left alone (exit 0): delete the file to
 * seed again. See docs/activity/foundation.md.
 */
import { basename } from "node:path";
import type { SQLiteTable } from "drizzle-orm/sqlite-core";
import type { RawMessage } from "../src/plugins/activity/facts.ts";

/** File name of the bot's own database in every default setup. */
const BOT_DATABASE_NAME = "asuka.sqlite";

/**
 * Why the script must not run with the current environment.
 *
 * @returns The reason, or null when it is safe to run.
 */
function refusal(): string | null {
  const path = process.env.DATABASE_PATH?.trim() ?? "";
  if (path === "") {
    return "DATABASE_PATH is not set, so the bot's default database (./asuka.sqlite) would be used.";
  }
  if (basename(path) === BOT_DATABASE_NAME) {
    return `DATABASE_PATH is "${path}". A file named ${BOT_DATABASE_NAME} is the bot's own database (the default path, and the one deploy.sh sets up).`;
  }
  if (process.env.NODE_ENV === "production") {
    return "NODE_ENV is production. This script is for development databases only.";
  }
  if (process.env.NODE_ENV === "test") {
    return "NODE_ENV is test, so the database would be in memory and nothing would be kept.";
  }
  return null;
}

const reason = refusal();
if (reason !== null) {
  console.error("seed-activity: refusing to run.");
  console.error(reason);
  console.error("Point DATABASE_PATH at a throwaway file, for example:");
  console.error("  DATABASE_PATH=/tmp/asuka-seed.sqlite bun scripts/seed-activity.ts");
  process.exit(1);
}

// src/config/env.ts throws without these. The script never talks to Discord.
process.env.DISCORD_TOKEN ||= "seed-discord-token";
process.env.CLIENT_ID ||= "000000000000000001";
process.env.CLIENT_SECRET ||= "seed-client-secret";
process.env.GUILD_ID ||= "000000000000000002";

// Imported only now: importing the database module opens (and creates) the file.
const { db, initDb, schema } = await import("../src/db/index.ts");
const { inArray, sql } = await import("drizzle-orm");
const { parseEmoji } = await import("../src/plugins/activity/emoji.ts");
const { extractMessageFacts } = await import("../src/plugins/activity/facts.ts");
const {
  closeVoiceSegment,
  openVoiceSegment,
  recordCommand,
  recordCredit,
  recordMembership,
  recordMessage,
  recordReactionAdd,
  recordReactionRemove,
} = await import("../src/plugins/activity/record.ts");

// --- fixed parameters --------------------------------------------------------

/** Seed of the random generator. Change it and every run changes with it. */
const RANDOM_SEED = 20261126;
/** How many fake members. */
const USER_COUNT = 20;
/** How many days of history, ending now. */
const DAYS = 90;
const DAY = 86400;
const HOUR = 3600;
/** Messages older than this many days are marked as written by the backfill. */
const BACKFILL_AFTER_DAYS = 45;
/** Messages a day of the most active member; the others fall off from there. */
const TOP_MESSAGES_PER_DAY = 14;
/** Discord's epoch (2015-01-01) in unix milliseconds, for snowflake-shaped ids. */
const DISCORD_EPOCH_MS = 1_420_070_400_000n;

/** End of the seeded period, in unix seconds. */
const now = process.env.SEED_NOW ? Number(process.env.SEED_NOW) : Math.floor(Date.now() / 1000);
if (!Number.isInteger(now) || now <= DAYS * DAY) {
  console.error(`seed-activity: SEED_NOW must be a unix time in seconds, got "${process.env.SEED_NOW}".`);
  process.exit(1);
}
/** 00:00 UTC of the last seeded day. */
const today = Math.floor(now / DAY) * DAY;

// --- random helpers ----------------------------------------------------------

/**
 * A small seeded generator (mulberry32).
 *
 * @param seed - Any 32-bit integer.
 * @returns A function giving the next number in [0, 1).
 */
function mulberry32(seed: number): () => number {
  let state = seed | 0;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

const random = mulberry32(RANDOM_SEED);

/** Random integer from `min` to `max`, both included. */
function int(min: number, max: number): number {
  return min + Math.floor(random() * (max - min + 1));
}

/** True with probability `p`. */
function chance(p: number): boolean {
  return random() < p;
}

/** One random item of a non-empty list. */
function pick<T>(items: readonly T[]): T {
  return items[Math.floor(random() * items.length)]!;
}

/** One random item, the earlier ones much more likely than the later ones. */
function pickSkewed<T>(items: readonly T[]): T {
  return items[Math.floor(random() ** 2.2 * items.length)]!;
}

/** `count` distinct random items (fewer when the list is shorter). */
function sample<T>(items: readonly T[], count: number): T[] {
  const pool = [...items];
  const out: T[] = [];
  while (out.length < count && pool.length > 0) {
    out.push(pool.splice(Math.floor(random() * pool.length), 1)[0]!);
  }
  return out;
}

/** A Poisson-distributed count with mean `mean` (Knuth's method; fine for small means). */
function poisson(mean: number): number {
  const limit = Math.exp(-mean);
  let count = 0;
  let product = random();
  while (product > limit) {
    count += 1;
    product *= random();
  }
  return count;
}

/** A roughly normal number with mean 0 and standard deviation 1. */
function gauss(): number {
  return (random() + random() + random() + random() - 2) * Math.sqrt(3);
}

// --- the fake guild ----------------------------------------------------------

/** A snowflake-shaped id: `base` plus a small number. */
function fakeId(base: bigint, n: number): string {
  return (base + BigInt(n)).toString();
}

/** One fake member and how they behave. */
interface SeedUser {
  id: string;
  /** Mean messages a day while active. */
  rate: number;
  /** UTC hour their messages centre on. */
  peakHour: number;
  /** The channel they post in most. */
  home: SeedChannel;
  /** First and last day they are active, as days before today (90 = oldest). */
  fromDaysAgo: number;
  toDaysAgo: number;
  /** When they joined, in unix seconds. */
  joinedAt: number;
}

/** A text channel or a thread. */
interface SeedChannel {
  id: string;
  parentId: string | null;
}

const textChannels: SeedChannel[] = Array.from({ length: 6 }, (_, i) => ({
  id: fakeId(800_000_000_000_000_000n, i + 1),
  parentId: null,
}));
const threads: SeedChannel[] = [0, 2].map((parent, i) => ({
  id: fakeId(800_000_000_000_000_100n, i + 1),
  parentId: textChannels[parent]!.id,
}));
const channels = [...textChannels, ...threads];
const voiceChannelIds = [1, 2, 3].map((n) => fakeId(810_000_000_000_000_000n, n));

const users: SeedUser[] = Array.from({ length: USER_COUNT }, (_, i) => {
  const user: SeedUser = {
    id: fakeId(900_000_000_000_000_000n, i + 1),
    rate: TOP_MESSAGES_PER_DAY / (i + 1) ** 0.8,
    peakHour: int(13, 23),
    home: pickSkewed(channels),
    fromDaysAgo: DAYS,
    toDaysAgo: 0,
    joinedAt: today - int(100, 400) * DAY,
  };
  // One night owl and one early bird, for the awards.
  if (i === 3) user.peakHour = 2;
  if (i === 7) user.peakHour = 6;
  // Four members who went quiet more than 30 days ago.
  if (i >= 13 && i <= 16) user.toDaysAgo = 35 + (i - 13) * 8;
  // Three newcomers.
  if (i >= 17) {
    user.fromDaysAgo = 12 - (i - 17) * 4;
    user.joinedAt = today - user.fromDaysAgo * DAY;
    user.rate = 5;
  }
  return user;
});

/** Whether a member is around on the day `daysAgo` days before today. */
function activeOn(user: SeedUser, daysAgo: number): boolean {
  return daysAgo <= user.fromDaysAgo && daysAgo >= user.toDaysAgo;
}

/** Custom emoji of the fake guild, as written in a message. */
const customEmoji = ["pog", "blobwave", "kekw", "sadge", "copium"].map(
  (name, i) => `<:${name}:${fakeId(700_000_000_000_000_000n, i + 1)}>`,
);
/** Emoji members type and react with, the popular ones first. */
const emojiPool = [
  "😂",
  customEmoji[0]!,
  "❤️",
  "🔥",
  customEmoji[2]!,
  "👍",
  "💀",
  customEmoji[1]!,
  "🎉",
  "😭",
  "👀",
  customEmoji[3]!,
  "✨",
  "🙂",
  customEmoji[4]!,
];
const linkPool = [
  "https://youtu.be/dQw4w9WgXcQ",
  "https://anilist.co/anime/1",
  "https://github.com/haiiro-moe/asuka",
  "https://example.com/post/42",
  "https://www.youtube.com/watch?v=abc",
  "https://en.wikipedia.org/wiki/Discord",
];
const wordPool = "the quick brown fox jumps over a lazy dog while nobody is watching it at all".split(" ");
const commandPool = ["profile", "leaderboard", "club", "store", "al", "wrapped"];

// --- generators --------------------------------------------------------------

/** A planned message: who, where and when. The rest is decided when it is written. */
interface PlannedMessage {
  user: SeedUser;
  channel: SeedChannel;
  /** Unix milliseconds. */
  tsMs: number;
}

/** Decide who writes where and when over the whole period, oldest first. */
function planMessages(): PlannedMessage[] {
  const planned: PlannedMessage[] = [];
  for (let daysAgo = DAYS; daysAgo >= 0; daysAgo--) {
    const dayStart = today - daysAgo * DAY;
    const weekday = new Date(dayStart * 1000).getUTCDay();
    const weekend = weekday === 0 || weekday === 6 ? 1.5 : 1;
    for (const user of users) {
      if (!activeOn(user, daysAgo)) continue;
      const count = poisson(user.rate * weekend);
      for (let i = 0; i < count; i++) {
        const hour = (((user.peakHour + Math.round(gauss() * 3)) % 24) + 24) % 24;
        const tsMs = (dayStart + hour * HOUR + int(0, HOUR - 1)) * 1000 + int(0, 999);
        const channel = chance(0.5) ? user.home : pickSkewed(channels);
        planned.push({ user, channel, tsMs });
      }
    }
  }
  // The draws above happen on every run; only what lies in the future is dropped.
  return planned.filter((m) => m.tsMs < now * 1000).sort((a, b) => a.tsMs - b.tsMs);
}

/** Some filler text with, now and then, emoji and a link. */
function fakeContent(): string {
  const parts: string[] = [];
  const words = int(1, 30);
  for (let i = 0; i < words; i++) parts.push(pick(wordPool));
  if (chance(0.3)) {
    const emoji = pickSkewed(emojiPool);
    parts.push(emoji);
    if (chance(0.25)) parts.push(emoji);
    if (chance(0.3)) parts.push(pickSkewed(emojiPool));
  }
  if (chance(0.06)) parts.push(pick(linkPool));
  return parts.join(" ");
}

/** Attachment MIME types of a message: usually none. */
function fakeAttachments(): (string | null)[] {
  if (!chance(0.08)) return [];
  const roll = random();
  const type = roll < 0.8 ? "image/png" : roll < 0.92 ? "video/mp4" : roll < 0.95 ? "audio/ogg" : "application/pdf";
  return chance(0.15) ? [type, "image/jpeg"] : [type];
}

/** Write every message, with replies and mentions, and the reactions it gets. */
function seedMessages(): void {
  /** The last few messages of each channel, as reply targets. */
  const recent = new Map<string, { id: string; userId: string; tsMs: number }[]>();
  let sequence = 0;

  for (const planned of planMessages()) {
    const { user, channel, tsMs } = planned;
    const daysAgo = Math.floor((today - Math.floor(tsMs / 1000 / DAY) * DAY) / DAY);
    const id = (((BigInt(tsMs) - DISCORD_EPOCH_MS) << 22n) | BigInt(sequence++ % 4_194_304)).toString();
    const others = users.filter((u) => u.id !== user.id && activeOn(u, daysAgo));

    const mentioned: string[] = [];
    let replyTo: { id: string; userId: string } | null = null;
    const history = recent.get(channel.id) ?? [];
    const candidates = history.filter((m) => m.userId !== user.id && tsMs - m.tsMs < 2 * HOUR * 1000);
    if (candidates.length > 0 && chance(0.28)) {
      replyTo = pick(candidates);
      // A reply pings its target unless the member turned that off.
      if (chance(0.7)) mentioned.push(replyTo.userId);
    }
    if (others.length > 0 && chance(0.07)) {
      for (const other of sample(others, int(1, 2))) mentioned.push(other.id);
    }

    const raw: RawMessage = {
      id,
      author: { id: user.id, bot: false },
      webhookId: null,
      system: false,
      guildId: process.env.GUILD_ID!,
      channelId: channel.id,
      parentChannelId: channel.parentId,
      createdTimestamp: tsMs,
      content: fakeContent(),
      replyToMessageId: replyTo?.id ?? null,
      repliedUserId: replyTo?.userId ?? null,
      mentionedUserIds: mentioned,
      attachmentTypes: fakeAttachments(),
      stickerCount: chance(0.02) ? 1 : 0,
    };
    const facts = extractMessageFacts(raw, daysAgo > BACKFILL_AFTER_DAYS ? "backfill" : "live");
    if (!facts || !recordMessage(facts)) continue;

    history.push({ id, userId: user.id, tsMs });
    if (history.length > 8) history.shift();
    recent.set(channel.id, history);

    if (others.length > 0 && chance(0.18)) {
      for (const reactor of sample(others, int(1, 4))) {
        const [emoji] = parseEmoji(pickSkewed(emojiPool));
        const addedAt = Math.min(facts.ts + int(5, HOUR), now);
        recordReactionAdd({
          messageId: id,
          userId: reactor.id,
          emoji: emoji!.emoji,
          name: emoji!.name,
          channelId: channel.id,
          messageAuthorId: user.id,
          ts: addedAt,
        });
        if (chance(0.06)) {
          recordReactionRemove(id, reactor.id, emoji!.emoji, Math.min(addedAt + int(10, 600), now));
        }
      }
    }
  }
}

/** Write voice sessions: a few members together in a channel most evenings. */
function seedVoice(): void {
  for (let daysAgo = DAYS; daysAgo >= 0; daysAgo--) {
    const dayStart = today - daysAgo * DAY;
    const around = users.filter((u) => activeOn(u, daysAgo));
    // Members are dealt out to sessions, so nobody is in two at once.
    const free = sample(around, around.length);
    const sessions = int(0, 3);

    for (let s = 0; s < sessions; s++) {
      const channelId = voiceChannelIds[s]!;
      const start = dayStart + int(15, 22) * HOUR + int(0, HOUR - 1);
      const members = free.splice(0, int(1, 5));

      for (const member of members) {
        const joined = start + int(0, 20 * 60);
        const left = Math.min(joined + int(20 * 60, 3 * HOUR), now);
        if (joined >= left) continue;

        const state = {
          channelId,
          muted: chance(0.2),
          deafened: chance(0.05),
          streaming: chance(0.15),
          video: chance(0.1),
        };
        openVoiceSegment(member.id, state, joined);
        // A mute toggle partway through ends one segment and starts the next.
        if (chance(0.3)) {
          const toggled = joined + Math.floor((left - joined) / 2);
          closeVoiceSegment(member.id, toggled);
          openVoiceSegment(member.id, { ...state, muted: !state.muted }, toggled);
        }
        closeVoiceSegment(member.id, left);
      }
    }
  }
}

/** Write joins (one per member) and one leave. */
function seedMembership(): void {
  for (const user of users) recordMembership(user.id, "join", user.joinedAt);
  // The longest-quiet member also left.
  recordMembership(users[16]!.id, "leave", today - 20 * DAY);
}

/** Write command runs and Social Credits changes, a few a day. */
function seedCommandsAndCredits(): void {
  const balance = new Map<string, number>();

  for (let daysAgo = DAYS; daysAgo >= 0; daysAgo--) {
    const dayStart = today - daysAgo * DAY;
    const around = users.filter((u) => activeOn(u, daysAgo));

    for (let i = poisson(4); i > 0; i--) {
      const ts = dayStart + int(0, DAY - 1);
      const user = pickSkewed(around);
      const name = pickSkewed(commandPool);
      const ok = !chance(0.05);
      if (ts < now) recordCommand(user.id, name, ok, ts);
    }

    for (let i = poisson(3); i > 0; i--) {
      const ts = dayStart + int(0, DAY - 1);
      const user = pickSkewed(around);
      const before = balance.get(user.id) ?? 0;
      const spend = before >= 150 && chance(0.25);
      const delta = spend ? -int(20, 150) : int(10, 60);
      if (ts >= now) continue;
      balance.set(user.id, before + delta);
      recordCredit(user.id, delta, before + delta, ts);
    }
  }
}

// --- run ---------------------------------------------------------------------

initDb();

const userIds = users.map((u) => u.id);
const alreadySeeded = db
  .select({ id: schema.activityMembership.id })
  .from(schema.activityMembership)
  .where(inArray(schema.activityMembership.userId, userIds))
  .limit(1)
  .get();
if (alreadySeeded) {
  console.log(`seed-activity: ${process.env.DATABASE_PATH} already holds the seed members. Nothing written.`);
  console.log("Delete the file to seed again.");
  process.exit(0);
}

// One transaction: the seed lands whole or not at all, and it is much faster.
db.transaction(() => {
  seedMembership();
  seedMessages();
  seedVoice();
  seedCommandsAndCredits();
});

/** Number of rows in a table. */
function rows(table: SQLiteTable): number {
  return db.select({ n: sql<number>`count(*)` }).from(table).get()?.n ?? 0;
}

console.log(`seed-activity: seeded ${process.env.DATABASE_PATH}`);
console.log(`  period      ${new Date((today - DAYS * DAY) * 1000).toISOString()} to ${new Date(now * 1000).toISOString()}`);
console.log(`  members     ${USER_COUNT}`);
console.log(`  messages    ${rows(schema.activityMessages)}`);
console.log(`  mentions    ${rows(schema.activityMentions)}`);
console.log(`  emoji       ${rows(schema.activityEmoji)}`);
console.log(`  reactions   ${rows(schema.activityReactions)}`);
console.log(`  voice       ${rows(schema.activityVoice)}`);
console.log(`  membership  ${rows(schema.activityMembership)}`);
console.log(`  commands    ${rows(schema.activityCommands)}`);
console.log(`  credits     ${rows(schema.activityCredits)}`);
