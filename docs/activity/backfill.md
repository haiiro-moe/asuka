# Activity analytics: history backfill

Live capture only sees what happens while the bot is running. The backfill reads a channel's
message history from Discord and writes it into the same activity log, so the analytics and the
Wrapped cover the time before capture started. It lives in `src/plugins/activity/backfill/`.

## Starting it

An admin starts it from the dashboard, which calls the admin-only routes below.

| Route | Body | Reply |
|---|---|---|
| `POST /api/activity/backfill` | `{ "reactions": true }` (optional, default `false`) | `{ status: "started" \| "already-running", progress }` |
| `POST /api/activity/backfill/stop` | none | `{ status: "stopping" \| "not-running" }` |
| `GET /api/activity/backfill` | none | the `BackfillStatus` (see below) |

The run happens in the background, one at a time. The start route returns at once and never waits
for it. Reading a large server takes a while (up to 100 messages per request, 250 ms between pages),
so poll `GET` for progress.

## What it reads

The text, announcement and forum channels of the locked guild, and their active and archived
public threads (a forum has no messages of its own, only posts, which are threads). Private
threads and voice channels are not read.

- **Excluded channels are skipped**, and so are threads under an excluded parent. They are marked
  done without a single request. See `guild_config.activityExcludedChannelIds`.
- **Channels the bot cannot read** (Discord error 50001 or 50013) and **channels deleted during
  the run** (10003) are marked done and the run goes on.
- Any other error on a channel counts in `errors` and moves the run to the next channel. That
  channel stays unfinished, so the status ends as `stopped`; start again to retry it.
- **Rows for channels that are gone.** A row whose channel is no longer listed (deleted, or no longer
  visible to the bot) is marked done at the start of the next run, so it cannot keep the status at `stopped`.
- **Memory.** Pages are fetched with `cache: false` and dropped from the channel cache, so reading a
  large history does not grow the process.
- Bots, webhooks and system messages are dropped by the same rules as live capture
  (`extractMessageFacts(raw, "backfill")`).

## Resumable and safe to repeat

- After every page the oldest message id of that page is saved in `activity_backfill.beforeId`.
  Stopping, a crash or a restart loses at most one page of work; starting again continues from the
  cursor.
- Every message goes through `recordMessage`, which ignores an id that is already stored. Running
  the backfill twice, or while live capture is on, never counts a message twice. Rows are marked
  `source = 'backfill'`.
- A channel that is done is not read again. To re-read one, delete its `activity_backfill` row.
  Messages that arrived since are covered by live capture.

## Status

`GET` replies with:

| Field | Meaning |
|---|---|
| `status` | `idle` (no rows yet), `running`, `stopped` (unfinished rows, no live run), `done` (every row done, and every row's reaction pass too when the run had `reactions: true`), `failed` (the last run could not list the channels) |
| `channelsDone`, `channelsTotal`, `scanned` | counted from the `activity_backfill` rows, so right after a restart too |
| `current` | name of the channel being read, such as `#general`; null when no run is live |
| `startedAt`, `elapsedSec`, `errors` | about the run of this process only; null/0 after a restart |
| `reactions` | whether the reaction pass is on for the run |

Stopping finishes the page in progress and keeps every cursor; the status then reads `stopped`.

## Reactions (optional)

With `reactions: true`, after a channel's messages are done the run reads its history a second time
and records one reaction per member and emoji (`recordReactionAdd`), then sets `reactionsDoneAt`.
Bot reactors are skipped, and a message by a bot is recorded with no author. This pass is slow:
one request per reaction per 100 reactors. It keeps no cursor, so an interrupted pass restarts that
channel; the writes are idempotent. Discord does not tell when a reaction was added, so each is
stamped with the time of its message.

If the reaction pass is stopped or fails, the status reads `stopped`, not `done`: start again with
`reactions: true` to finish it. After a restart the status cannot know whether the last run asked
for reactions, so it assumes it did once any channel has had its pass.

## What cannot be backfilled

- **Voice time.** Discord keeps no history of who sat in which voice channel. Voice analytics start
  when capture does.
- **Removed reactions, joins and leaves, commands run and credits.** Only messages (with their
  mentions, replies and emoji) and, optionally, the reactions still on them exist in history.
- **Deleted messages** are gone from Discord and so from the backfill.

## Code map

| File | Role |
|---|---|
| `backfill/types.ts` | `BackfillStatus` and the other plain data types; imports nothing, safe for the web app |
| `backfill/channel.ts` | `FetchPage` and `BackfillChannel` (server only: they mention `RawMessage`) |
| `backfill/runner.ts` | `backfillChannel`, `backfillReactions`, `startBackfill`, `stopBackfill`, `getBackfillStatus` |
| `backfill/discord.ts` | lists channels and threads, builds the page fetchers from discord.js |
| `api/backfill.ts` | the three routes |
