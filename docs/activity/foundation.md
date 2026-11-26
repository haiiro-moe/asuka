# Activity analytics: foundation

The `activity` plugin records what happens in the guild as a raw, timestamped event log, and
everything else (the tiered analytics views, the history backfill, the yearly Wrapped) reads that
log. This page covers the foundation: the tables, the two config columns, the shared helpers, the
write API that every row goes through, the seed script and how the plugin is laid out.

## Rules that hold for every table

- **Derived facts only.** No message text is stored, only counts, ids, kinds and domains.
- **Timestamps are unix seconds**, like the rest of the schema.
- **Bots are never recorded.** Channels listed in `guild_config.activityExcludedChannelIds` are
  never recorded, never backfilled and are filtered from every query.
- **Rows are kept.** Nothing prunes the log. Summary tables, if a view ever needs one, are a cache
  that can be dropped and rebuilt from these tables.
- Column names are camelCase in TypeScript and snake_case in SQL (`messageId` is `message_id`).

## Tables

All are defined in `src/db/schema.ts` and created by migration `0016`. Migration `0017` adds
`parent_channel_id` to `activity_mentions`, `activity_emoji` and `activity_reactions`. Migration
`0018` adds `send_dms` to `activity_wrapped_runs` and `processed_run_id` to
`activity_wrapped_links`. Migration `0019` adds `activity_wrapped_server` and
`activity_wrapped_signup`, adds `announce` to `activity_wrapped_runs` and drops `send_dms` again
(processing and sending became separate steps). Migrations `0020` and `0021` add private previews:
`kind`, `owner_user_id`, `preview` and `server_token` on `activity_wrapped_runs`, `private` and
`owner_user_id` on `activity_wrapped_links` (0020), and make the links key (`user_id`, `year`,
`owner_user_id`) (0021; generated separately so the table copy reads the new columns).

### Event log

| Export | SQL table | One row per | Purpose |
|---|---|---|---|
| `activityMessages` | `activity_messages` | message | Who wrote where and when, reply target, mention count, attachment kinds, link domains, sticker count, text length, and whether the row came from live capture or the backfill. |
| `activityMentions` | `activity_mentions` | mentioned user per message | The mention edges of the reply/mention web (`fromUserId` to `toUserId`). The reply edges are `activityMessages.replyToUserId`; a reply's own ping writes no row here. |
| `activityEmoji` | `activity_emoji` | distinct emoji per message | Emoji used in message text, with how often it appears in that message. |
| `activityReactions` | `activity_reactions` | member, emoji and message | Reactions. A removal sets `removedAt` and keeps the row, so the net count is the rows where `removedAt` is null. |
| `activityVoice` | `activity_voice` | voice session | Connected time per member and channel, with muted, deafened, streaming and video flags. |
| `activityMembership` | `activity_membership` | join or leave | Membership changes. |
| `activityCommands` | `activity_commands` | slash command run | Command usage and whether it succeeded (`ok`). |
| `activityCredits` | `activity_credits` | balance change | Social Credits ledger: the signed `delta` and the balance afterwards. |

### Bookkeeping

| Export | SQL table | One row per | Purpose |
|---|---|---|---|
| `activityBackfill` | `activity_backfill` | channel or thread | Backfill cursor. `beforeId` is where to continue, `doneAt` marks the message pass finished, `reactionsDoneAt` the optional reaction pass. |
| `activityWrappedRuns` | `activity_wrapped_runs` | Wrapped run | A run's status (`processing`, `processed`, `sending`, `done`, `failed`), whether its send step announces the server Wrapped (`announce`, 1 or 0) and its progress counters. |
| `activityWrappedLinks` | `activity_wrapped_links` | member and year | The member's personal link: its token, the JSON snapshot of their year, the DM status, how often the link was opened, and the run that last built the snapshot (`processedRunId`, so a resumed run knows who is left). |
| `activityWrappedOptins` | `activity_wrapped_optins` | opted-in member | Members who want their Wrapped link by DM. |
| `activityWrappedServer` | `activity_wrapped_server` | year | The server Wrapped: its reusable public token, the JSON snapshot of the server's year (null until built) and when it was announced (`announcedAt`). |
| `activityWrappedSignup` | `activity_wrapped_signup` | year | The sign-up message (channel and message ids, posted with buttons or not) and whether sign-ups are closed. |

### Keys and indexes

| Table | Unique | Indexes |
|---|---|---|
| `activity_messages` | `message_id` | `ts`; (`user_id`, `ts`); `channel_id` |
| `activity_mentions` | (`message_id`, `to_user_id`) | `ts` |
| `activity_emoji` | (`message_id`, `emoji`) | (`emoji`, `ts`) |
| `activity_reactions` | (`message_id`, `user_id`, `emoji`) | `added_at` |
| `activity_voice` | | (`user_id`, `started_at`); (`channel_id`, `started_at`) |
| `activity_backfill` | `channel_id` (primary key) | |
| `activity_wrapped_links` | (`user_id`, `year`, `owner_user_id`) (primary key); `token` | |
| `activity_wrapped_optins` | `user_id` (primary key) | |
| `activity_wrapped_server` | `year` (primary key); `token` | |
| `activity_wrapped_signup` | `year` (primary key) | |

The unique keys are what make writes idempotent. Live capture and the backfill can both see the
same message, so they insert with `onConflictDoNothing()` and a message is never counted twice.

### Things worth knowing

- **`activityMessages.source` has no default.** A writer must say `live` or `backfill`, so a
  backfilled row can never be mistaken for a live one.
- **Event timestamps have no default** (`ts`, `addedAt`, `startedAt` and `lastSeenAt` of a voice
  session). They are the time the thing happened, which for a backfilled row is not now.
  Bookkeeping timestamps (`updatedAt`, `createdAt`, `optedInAt`, a run's `startedAt`) default to
  the current time. `updatedAt` is not maintained by SQLite: set it on every update.
- **Rows that belong to a message carry its channel and its parent channel.** `activityMessages`,
  `activityMentions`, `activityEmoji` and `activityReactions` all have `channelId` and a nullable
  `parentChannelId`, which is the parent of the thread the message is in and null outside a
  thread. A query on any of them filters with `notExcluded(channelId, parentChannelId)` and needs
  no join, and a thread under a channel that is excluded later disappears with it.
- **`emoji` identifies the emoji**: the unicode emoji itself, or `custom:<id>` for a custom emoji.
  It is `ParsedEmoji.emoji` stored verbatim (see "Emoji keys" below). `name` is the custom emoji's
  name and is null for unicode emoji.
- **`attachmentKinds` and `linkDomains` are comma lists** stored as text (`image,video`,
  `example.com,youtu.be`), empty when there are none. `attachmentKinds` uses `image`, `video`,
  `audio` and `other`.
- **`activityVoice` is not `voiceSessions`.** `voice_sessions` is the short-lived table the XP
  tick uses. `activity_voice` is history: `endedAt` is null while a session is open, and
  `lastSeenAt` is the last time it was known to be live, so a session left open by a restart can
  be closed at that time.
- **A Wrapped link is never deleted on open.** It is reusable; opening it raises `opens` and sets
  `lastOpenedAt`.
- **A DM only goes to an opted-in member.** A run creates a link row for every member with
  activity, but only members with a row in `activity_wrapped_optins` are written to. Opting out
  deletes the row.

## Config columns

Two columns on the singleton `guild_config` row, both editable from the dashboard (they are in
`EDITABLE_CONFIG` in `src/web/routes.ts`):

| Column | Type | Default | Meaning |
|---|---|---|---|
| `activityEnabled` | integer, 1 or 0 | `0` | Whether activity is recorded at all. Off until an admin turns it on; migration 0023 also set existing installs to 0. |
| `activityExcludedChannelIds` | text | `""` | Comma-separated channel ids that are excluded. |

Read them with `getConfig()` inside a handler, never at module top level: plugin modules are
loaded before `initDb()` has run.

## Shared helpers

Four small modules that capture, the backfill, every query tier and Wrapped import. They hold the
rules that must be the same everywhere, so use them instead of writing the rule again.

### Emoji keys (`emoji.ts`)

`parseEmoji(text)` returns one `ParsedEmoji { emoji, name, count }` per distinct emoji in a
message, in order of first appearance. `emoji` is the key written to the `emoji` columns as is:

| Emoji | `emoji` | `name` |
|---|---|---|
| Custom, `<:pog:123>` or animated `<a:pog:123>` | `custom:123` | `pog` |
| Unicode | the emoji itself, with U+FE0F removed | null |

- Fenced code blocks and inline code are skipped.
- A sequence joined by U+200D (a family, the rainbow flag) is one emoji. A skin tone stays part of
  its emoji, so a thumbs up with a skin tone and one without are two keys. A flag and a keycap are
  one emoji each.
- U+FE0F is removed so the same emoji typed with and without it shares a key.
- Unicode emoji are found by the `Extended_Pictographic` property, so a few symbols that are
  usually drawn as text (`©`, `®`, `™`) count as emoji.

### Periods (`time.ts`)

A `Period` is `{ from, to }` in unix seconds, `from` inclusive and `to` exclusive. All buckets are
UTC: `weekdayHour(ts)` gives the UTC weekday (0 is Monday, 6 is Sunday) and hour.

`parsePeriodParam(value, now?)` turns a `?period=` query value into a `Period` ending at `now`:

| Value | Period |
|---|---|
| absent (null) | the last 30 days |
| `7d` or `week` | the last 7 days |
| `30d` | the last 30 days |
| `term` | `termPeriod()`: from `president.termStart`, or the last 90 days when there is none |
| `year` | the last 365 days (rolling, not the calendar year) |
| `all` | from 0 |

Anything else, the empty string included, throws `RangeError`. A route catches it and answers 400.

`QUIET_DAYS` is 30: a member has gone quiet after 30 days with no message and no voice.

### Voice readiness (`voice-ready.ts`)

The voice recorder is young, so everything derived from voice is withheld until the voice log
holds at least `VOICE_MIN_WHOLE_MONTHS` (2) whole UTC calendar months. This module is the single
place that decides; lanes import it and never compare dates themselves.

- `voiceReadyAtFor(firstTs)` is pure. The month of the first segment is partial, so counting starts
  at the next month start, unless `firstTs` is exactly a month start at 00:00:00 (then that month
  counts). Voice is ready at the start of the day after the two whole months: a first segment on
  27 Nov 2026 gives 1 Feb 2027 (Dec and Jan are whole); one at exactly 1 Nov 2026 gives 1 Jan 2027.
- `voiceReadiness(now?)` returns `{ ready, since, readyAt }`. `since` is the earliest
  `activity_voice.startedAt`, one `min()` query that ignores excluded channels (exclusion changes
  what is shown, not how long the recorder has run). With no rows, `ready` is false and both times
  are null. `ready` is `now >= readyAt`.
- `voiceReady(now?)` is `voiceReadiness(now).ready`.

While `voiceReady()` is false a voice-derived output is empty or null, never zero-filled, and a
page says that voice stats unlock on `readyAt` instead of showing a 0.

### Excluded channels (`exclusion.ts`)

- `excludedChannelIds()` parses `guild_config.activityExcludedChannelIds` into a set.
- `isExcluded(channelId, parentChannelId?)` is for writers (capture and the backfill). Pass the
  parent channel for a thread: a thread under an excluded channel is excluded too.
- `notExcluded(channelColumn, parentColumn?)` is the Drizzle filter for queries. Combine it with
  the other conditions through `and(...)`, and pass the parent-channel column on tables that have
  one (`parentChannelId` on `activityMessages`, `activityMentions`, `activityEmoji` and
  `activityReactions`), or threads under an excluded channel stay visible. It is true for every
  row when the list is empty, and a null column never counts as excluded.

All three read the config when called, so a channel excluded today drops out of the next query
even though its rows are still in the log. Call them inside the query or handler, never at module
top level.

### Privacy rules (`privacy.ts`)

The president tier gets numbers, never names or ids. A small number can still point at one person
("1 member went quiet"), so two rules apply to everything that tier returns:

- **No count of 1 or 2.** `MIN_GROUP` is 3. Every count goes through `hideSmall(n)`, which returns
  null for 1 and 2 and the number otherwise. 0 is returned as 0, because it identifies nobody. The
  dashboard draws null as "off", never as 0.
- **Groups under 3 are merged.** `mergeSmallGroups(sizes)` returns the sizes of 3 or more as
  `shown` and adds the rest up into `other`. `other` also goes through `hideSmall`, so it is null
  when the merged total is itself 1 or 2: `[14, 9, 2, 1, 5]` gives `{ shown: [14, 9, 5], other: 3 }`
  and `[14, 2]` gives `{ shown: [14], other: null }`.
- **Fixed periods only.** President routes accept `week` and `term` and answer 400 for anything
  else. With free ranges, two requests a day apart could be subtracted to recover the small count
  the threshold hides.

The user tier names people only in leaderboards and awards. Admins see names.

## Message facts (`facts.ts`)

A message is reduced to facts in two steps, and live capture and the backfill both use them, so
they agree on every rule:

```ts
const facts = extractMessageFacts(toRawMessage(message), "live"); // or "backfill"
if (facts) recordMessage(facts);
```

- `toRawMessage(message)` copies what matters out of a discord.js `Message` into a plain
  `RawMessage`. Only a message of type `Reply` counts as a reply: a forward, a crosspost and a
  thread's starter message carry a reference too, but answer nobody. `parentChannelId` is the
  parent of a thread, read from the cached channel, and null otherwise. **Bots are left out as
  targets too**: a mentioned bot is not in `mentionedUserIds`, and a reply to a bot's message
  keeps `replyToMessageId` but has a null `repliedUserId`.
- `extractMessageFacts(raw, source)` returns `MessageFacts`, or **null when the message is not
  recorded**: the author is a bot, a webhook sent it, it is a system message, it is a DM (no
  guild), or its channel or its thread's parent channel is excluded.

`RawMessage` is plain data, so tests and the seed script build one by hand. What the facts hold:

| Field | Rule |
|---|---|
| `ts` | `createdTimestamp` (milliseconds) in whole unix seconds. |
| `replyToUserId`, `replyToMessageId` | The reply target. `replyToUserId` is null when Discord did not send the replied-to message (it was deleted) and when its author is a bot (a member answering one of the bot's cards); `replyToMessageId` is kept in both cases. A reply to yourself is kept. |
| `mentionedUserIds` | The users Discord lists as mentioned, each once, without the author. **The ping of a reply is not a mention**: a reply pings its target by default and Discord then lists the target as mentioned, so the target is taken out again unless the text names them with `<@id>` (or `<@!id>`). The reply itself stays in `replyToUserId`. Another user mentioned in a reply is kept. |
| `attachmentKinds` | One of `image`, `video`, `audio` per attachment, by the first part of its MIME type; `other` for anything else and for an unknown type. |
| `linkDomains` | The hostname of every `http://` or `https://` link: lowercase, no port, each once, in order of first appearance. Punctuation after a link (`.,;:!?*_~\|`, as in `https://example.com,` or `**https://example.com**`) is trimmed first, and a hostname with anything but letters, digits, dots and hyphens is dropped, so a domain is never stored with punctuation in it. An international domain is stored as punycode (`xn--...`). `www.` is kept, so `www.youtube.com` and `youtube.com` are two domains. |
| `length` | Characters (code points) of the text, so an emoji counts once. |
| `emoji` | `parseEmoji(content)`. |

The text is read here and goes no further.

## Write API (`record.ts`)

Every row in the event tables is written through these functions. Capture, the backfill and the
seed script call them; nothing else inserts into those tables.

| Function | Writes |
|---|---|
| `recordMessage(facts): boolean` | The message row, one `activity_mentions` row per mentioned user and one `activity_emoji` row per distinct emoji, in one transaction. The mention and emoji rows get the message's `channelId` and `parentChannelId`. Returns false, with nothing written, when the message is already recorded or its channel (or its thread's parent) is excluded. |
| `recordReactionAdd({ messageId, userId, emoji, name, channelId, parentChannelId?, messageAuthorId, ts })` | One row per member, emoji and message. Adding it again keeps the row and clears `removedAt`. `parentChannelId` is optional: pass it for a reaction in a thread. |
| `recordReactionRemove(messageId, userId, emoji, ts)` | Stamps `removedAt` on the live row. Nothing happens when the reaction was never recorded. |
| `recordMembership(userId, kind, ts)` | A `join` or a `leave`. |
| `openVoiceSegment(userId, snapshot, ts)` | A new open voice segment (`endedAt` null, `lastSeenAt` = `ts`). |
| `closeVoiceSegment(userId, ts)` | Ends the member's open segment at `ts`. |
| `touchVoiceSegments(ts)` | The heartbeat: sets `lastSeenAt` on every open segment. |
| `closeDanglingVoiceSegments(): number` | Ends every open segment at its own `lastSeenAt` and returns how many. Call it once on boot. |
| `recordCommand(userId, name, ok, ts?)` | One slash command run. `ts` defaults to now. |
| `recordCredit(userId, delta, balanceAfter, ts?)` | One Social Credits change. `ts` defaults to now. |

What holds for all of them:

- **They are synchronous** and return as soon as the row is written. Timestamps are unix seconds.
- **A duplicate is not an error.** A second write of the same message or reaction hits the unique
  key and changes nothing (`onConflictDoNothing`), which is what lets capture and the backfill
  overlap. A database error that is not a duplicate still throws, so a gateway handler wraps its
  calls in try/catch.
- **They do not check `activityEnabled`.** The caller decides whether to record at all.
- **Call them after `initDb()`**, inside a handler: they read the excluded-channel list.

Details that matter to a caller:

- **Reaction emoji use the same key as text emoji**: the unicode emoji without U+FE0F, or
  `custom:<id>`, with `name` set for a custom emoji only. Build it the way `parseEmoji` does, or
  text use and reaction use of one emoji will not add up.
- **Re-adding a reaction keeps the first `addedAt`.** Only `removedAt` is cleared. A message author
  or a parent channel that was unknown (null) is filled in by a later add that knows it.
- **No bot id is ever stored**, as an author or as a target. No table records which ids are
  bots, so one that got in could not be filtered out later. `extractMessageFacts` drops a bot's
  message and `toRawMessage` drops bots from the mentions and the reply target. The `record*`
  functions take plain ids and cannot check, so **capture must do the same for reactions**: skip a
  reaction a bot added, and pass `messageAuthorId: null` to `recordReactionAdd` when the author of
  the reacted-to message is a bot.
- **Excluded channels.** `recordMessage` and `recordReactionAdd` check the channel and the
  thread's parent (`isExcluded(channelId, parentChannelId)`) and write nothing when either is
  excluded. `openVoiceSegment` checks its voice channel.
- **Pass `parentChannelId` to `recordReactionAdd` for a reaction in a thread.** It is stored on the
  row. Without it the reaction is recorded even though the thread's parent is excluded, and
  `notExcluded` cannot hide it when the parent is excluded later.
- **A voice segment is one stretch with nothing changing**: one member, one channel, one set of
  flags (`VoiceSnapshot`: `channelId`, `muted`, `deafened`, `streaming`, `video`). A channel move or
  a mute toggle is a close followed by an open at the same second.
- **A member has at most one open segment.** `openVoiceSegment` first closes an open one at `ts`,
  so a member's segments never overlap even if a leave was missed.
- **After a restart**, `closeDanglingVoiceSegments()` ends what was left open at the last
  heartbeat, not at the time the bot came back, so downtime is not counted as voice time.
- **`mentionCount`** on the message row is the number of mention rows written for it.

## Seed data (`scripts/seed-activity.ts`)

Fills a throwaway database with fake activity, so the views have something to draw:

```sh
DATABASE_PATH=/tmp/asuka-seed.sqlite nix develop -c bun scripts/seed-activity.ts
```

Run it from the repo root. The file is created and migrated if it does not exist. To look at the
result, start the bot with the same `DATABASE_PATH`.

- **It refuses to touch the bot's own database** and exits 1 with the reason: when
  `DATABASE_PATH` is not set (the default `./asuka.sqlite` would be used), when it names a file
  called `asuka.sqlite` (the default path and the one `deploy.sh` sets up, in any directory), and
  when `NODE_ENV` is `production` or `test`. Nothing is opened or created on a refusal.
- **What it writes:** 20 fake members (ids `900000000000000001` to `...020`) over 90 days ending
  now, in six channels, two threads and three voice channels: about 6,000 messages with replies,
  mentions, emoji, links, attachments and stickers, about 2,900 reactions (some removed), a few
  hundred voice segments, a join per member and one leave, command runs and Social Credits changes.
  Messages older than 45 days are marked `backfill`, the rest `live`.
- **The members are not all alike**, so each view has something to show: activity falls off from
  the first member to the last, one member is a night owl and one an early bird, four went quiet
  more than 30 days ago (one of them left), and three joined in the last two weeks.
- **Everything goes through the write API**, and messages through `extractMessageFacts`, so the
  rows are what capture would have written.
- **Fixed random seed.** Every run has the same members behaving the same way. The exact rows
  depend on the day it is run, because the 90 days end now. Set `SEED_NOW` (unix seconds) to pin
  the end time: two runs with the same `SEED_NOW` write identical rows.
- **It seeds once.** A database that already holds the seed members is left alone (exit 0).
  Delete the file to seed again.
- The fake members exist only in the activity tables. They have no `members` row and are not on
  Discord.

## Plugin layout

```
src/plugins/activity/
  index.ts              the Plugin ("activity"); only wires the parts below together
  api.ts                activityRoutes: the five route lists in api/, concatenated
  api/
    user.ts             userRoutes        everyone tier
    president.ts        presidentRoutes   president tier, aggregate numbers only
    admin.ts            adminRoutes       admin tier, with names
    backfill.ts         backfillRoutes    start the backfill, report progress
    wrapped.ts          wrappedRoutes     Wrapped runs and the personal link
  capture/index.ts      captureListeners, captureSchedules   live recording
  wrapped/
    commands.ts         wrappedCommands   the /wrapped slash commands
    listeners.ts        wrappedListeners  opt-in and opt-out buttons
  types/                response types shared with the web app, one file per tier
    user.ts  president.ts  admin.ts  wrapped.ts
  emoji.ts              parseEmoji: the emoji in a message and their keys
  time.ts               Period, weekdayHour, lastDays, termPeriod, parsePeriodParam, QUIET_DAYS
  privacy.ts            MIN_GROUP, hideSmall, mergeSmallGroups
  exclusion.ts          excludedChannelIds, isExcluded, notExcluded
  voice-ready.ts        VOICE_MIN_WHOLE_MONTHS, voiceReadyAtFor, voiceReadiness, voiceReady
  facts.ts              RawMessage, MessageFacts, toRawMessage, extractMessageFacts
  record.ts             the write API: recordMessage, reactions, voice segments, membership,
                        commands, credits
  *.test.ts             one per module above, plus schema.test.ts (tables, config defaults,
                        plugin registration)
scripts/
  seed-activity.ts      fake activity for a throwaway database (and its refusal test)
```

The lists start empty and each has one owner, so work on capture, a tier's routes or Wrapped adds
to its own file and leaves `index.ts` and `api.ts` alone. The plugin is registered last in
`src/plugins/index.ts`, after `linkfixer`.

## Changing the schema

Edit `src/db/schema.ts`, then generate and commit the migration:

```sh
nix develop -c bun run db:generate
```

This writes `src/db/migrations/00NN_<name>.sql` and updates `meta/`. Commit all of it. Migrations
are applied on boot by `initDb()`.

## Tests

```sh
nix develop -c bun test
```

`bun test` runs with `NODE_ENV=test`, so `src/db/index.ts` opens an in-memory database and the
real file is never touched. `bunfig.toml` preloads `src/test-setup.ts`, which sets placeholder
values for `DISCORD_TOKEN`, `CLIENT_ID`, `CLIENT_SECRET` and `GUILD_ID`. Without them
`src/config/env.ts` throws on import and any test that touches the database fails before it runs.
A test that needs the tables calls `initDb()` once in `beforeAll`.

All test files run in one process and share that database. A file empties the tables it writes to
in `beforeEach`, and a file that changes a singleton row (`guild_config.activityExcludedChannelIds`,
`president.termStart`) puts it back in `beforeEach` and again in `afterAll`, so the next file
starts from the seeded defaults.
