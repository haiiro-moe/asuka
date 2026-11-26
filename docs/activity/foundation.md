# Activity analytics: foundation

The `activity` plugin records what happens in the guild as a raw, timestamped event log, and
everything else (the tiered analytics views, the history backfill, the yearly Wrapped) reads that
log. This page covers the foundation: the tables, the two config columns and how the plugin is
laid out.

## Rules that hold for every table

- **Derived facts only.** No message text is stored, only counts, ids, kinds and domains.
- **Timestamps are unix seconds**, like the rest of the schema.
- **Bots are never recorded.** Channels listed in `guild_config.activityExcludedChannelIds` are
  never recorded, never backfilled and are filtered from every query.
- **Rows are kept.** Nothing prunes the log. Summary tables, if a view ever needs one, are a cache
  that can be dropped and rebuilt from these tables.
- Column names are camelCase in TypeScript and snake_case in SQL (`messageId` is `message_id`).

## Tables

All are defined in `src/db/schema.ts` and created by migration `0016`.

### Event log

| Export | SQL table | One row per | Purpose |
|---|---|---|---|
| `activityMessages` | `activity_messages` | message | Who wrote where and when, reply target, mention count, attachment kinds, link domains, sticker count, text length, and whether the row came from live capture or the backfill. |
| `activityMentions` | `activity_mentions` | mentioned user per message | The edges of the reply/mention web (`fromUserId` to `toUserId`). |
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
| `activityWrappedRuns` | `activity_wrapped_runs` | Wrapped run | A run's status (`processing`, `sending`, `done`, `failed`) and its progress counters. |
| `activityWrappedLinks` | `activity_wrapped_links` | member and year | The member's personal link: its token, the JSON snapshot of their year, the DM status and how often the link was opened. |
| `activityWrappedOptins` | `activity_wrapped_optins` | opted-in member | Members who want their Wrapped link by DM. |

### Keys and indexes

| Table | Unique | Indexes |
|---|---|---|
| `activity_messages` | `message_id` | `ts`; (`user_id`, `ts`); `channel_id` |
| `activity_mentions` | (`message_id`, `to_user_id`) | `ts` |
| `activity_emoji` | (`message_id`, `emoji`) | (`emoji`, `ts`) |
| `activity_reactions` | (`message_id`, `user_id`, `emoji`) | `added_at` |
| `activity_voice` | | (`user_id`, `started_at`); (`channel_id`, `started_at`) |
| `activity_backfill` | `channel_id` (primary key) | |
| `activity_wrapped_links` | (`user_id`, `year`) (primary key); `token` | |
| `activity_wrapped_optins` | `user_id` (primary key) | |

The unique keys are what make writes idempotent. Live capture and the backfill can both see the
same message, so they insert with `onConflictDoNothing()` and a message is never counted twice.

### Things worth knowing

- **`activityMessages.source` has no default.** A writer must say `live` or `backfill`, so a
  backfilled row can never be mistaken for a live one.
- **Event timestamps have no default** (`ts`, `addedAt`, `startedAt` and `lastSeenAt` of a voice
  session). They are the time the thing happened, which for a backfilled row is not now.
  Bookkeeping timestamps (`updatedAt`, `createdAt`, `optedInAt`, a run's `startedAt`) default to
  the current time. `updatedAt` is not maintained by SQLite: set it on every update.
- **`emoji` identifies the emoji**: the unicode emoji itself, or a custom emoji's id. `name` is
  the custom emoji's name and is null for unicode emoji.
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
| `activityEnabled` | integer, 1 or 0 | `1` | Whether activity is recorded at all. |
| `activityExcludedChannelIds` | text | `""` | Comma-separated channel ids that are excluded. |

Read them with `getConfig()` inside a handler, never at module top level: plugin modules are
loaded before `initDb()` has run.

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
  schema.test.ts        the tables, config defaults and plugin registration
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
