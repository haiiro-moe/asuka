# Activity analytics: admin-tier queries

The admin tier shows every view with names (user ids; the dashboard turns them into names). The
queries are in `src/plugins/activity/queries/admin.ts`, the routes in `api/admin.ts` and the
response shapes in `types/admin.ts` (pure types, shared with the web app). The foundation they
build on (tables, `Period`, `notExcluded`, the write API) is in [foundation.md](foundation.md).

## Routes

All are `GET`, `access: "admin"`, and take `?period=7d|week|30d|term|year|all` (absent means
`30d`, see `parsePeriodParam`). An unknown period is answered with 400 and `{ "error": "..." }`.

| Route | Query | Returns |
|---|---|---|
| `/api/activity/admin/moderation` | `moderationSeries(p)` | `ModerationSeries` |
| `/api/activity/admin/offenders` | `repeatOffenders(p)` | `OffenderRow[]` |
| `/api/activity/admin/newcomers` | `newcomers(p)` | `NewcomerRow[]` |
| `/api/activity/admin/drift` | `drift(p)` | `DriftRow[]` |
| `/api/activity/admin/channels` | `channelHealth(p)`, then `withChannelNames` | `NamedChannelHealthRow[]` |
| `/api/activity/admin/economy` | `economy(p)` | `Economy` |
| `/api/activity/admin/clubs-events` | `clubsAndEvents(p)` | `ClubsAndEvents` |
| `/api/activity/admin/bot` | `botUsage(p)` | `CommandUsageRow[]` |
| `/api/activity/admin/relations?kind=` | `relations(p, kind)` | `RelationPair[]` |
| `/api/activity/admin/inspect/:userId` | `memberInspect(userId, p)` | `MemberInspect` |

`relations` takes `kind=replies|mentions|voice` (absent means `replies`; anything else is a 400).
`inspect/:userId` answers 400 when the id is not all digits. `channels` adds display names in the
route layer, so the query stays free of discord.js (see "Channel health" below).

## Rules every query follows

- **Excluded channels are hidden at query time.** Every query on a table with a channel filters
  with `notExcluded(channelId, parentChannelId)` (messages, mentions) or `notExcluded(channelId)`
  (voice, which has no parent). A channel excluded today drops out of the next request, threads
  under it included, although its rows stay in the log.
- **Voice waits for two whole months of data.** Anything derived from voice is withheld until
  `voiceReadiness()` (`voice-ready.ts`) says the voice log holds two whole UTC months. Until then
  it is empty, never zero-filled. Only two admin views read voice: `relations(p, "voice")`
  returns `[]`, and `drift` judges members on messages alone, so nobody looks quiet or active
  because of voice that was not reliably recorded. `memberInspect`, `channelHealth`, `newcomers`
  and `clubsAndEvents` count messages only and are not affected (a club's voice-channel id counts
  the text chat in that channel, not voice segments). Once ready, nothing changes. The routes
  compute readiness once per request and pass it to `drift(p, voice)` and
  `relations(p, kind, voice)`; called without it, the queries use `voiceReady(p.to)`. The page
  reads the unlock date from `GET /api/activity/user/voice-status` (user tier), so the admin
  tier adds no route for it.
- **Periods are `from` inclusive, `to` exclusive**, in unix seconds; all buckets are UTC.
- **Weekly series** (`moderationSeries().weekly`, `economy().weekly`) are 7-day UTC buckets. Each
  series comes with `start` (unix seconds, the start of its first bucket) so the page can label
  the weeks. Both series of one period always get the same `start` (`seriesStart(p)`), so they
  line up bucket by bucket. Bucket `i` covers `start + i * 7 days` up to the next one, the last
  may be partial, and weeks without rows are zeros.
  - A bounded period (`7d`, `week`, `30d`, `term`, `year`) starts at `p.from`.
  - `all` (`from` 0) starts at the week of the earliest row any series covers (the earliest
    `activity_messages.ts`, `mod_log.created_at` or `activity_credits.ts`), rounded down to a
    multiple of 7 days since the epoch, which is the same grid `all`'s buckets would use. Data from
    two weeks ago gives about 3 buckets, not one per week since 1970. With no data at all it
    starts one week before the week that contains `p.to`, so the arrays are short (2 buckets) but
    never empty.
- **Aggregation happens in SQL.** These queries run synchronously in the bot's process, next to the
  Discord gateway, so they never load a period's rows into JavaScript: counts, sums, weekly buckets
  and top lists are `GROUP BY`s, and only grouped rows come back (the one exception is the list of
  answered messages' reply delays, which `channelHealth` needs for a median).
- **Sorting is stable:** biggest first, ties broken by id or name, so two requests with the same
  data give the same order.

## The views

### Moderation (`moderationSeries`, `repeatOffenders`)

`mod_log` also holds economy and event entries, so only the moderation actions count
(`MOD_ACTIONS`: timeout, untimeout, kick, ban, unban, warn, censor). `weekly` counts them per week,
`byAction` per kind.

A repeat offender has 2 or more offences in the period (`REPEAT_MIN`). An offence is a row in
`warnings` or a timeout, kick or ban in `mod_log` (`OFFENCE_ACTIONS`). `/warn` writes both a
`warnings` row and a `warn` log entry, so warnings are counted from `warnings` only and never
twice.

### Newcomers (`newcomers`)

One row per member with a `join` in `activity_membership` inside the period (their first join
there). Their first week is the 7 days from that join:

- `messagesInWeek`: their messages in that week.
- `gotReplyInWeek`: someone else replied to one of those messages within that week, which ends
  7 days after the join (exclusive: a reply on day 7 counts, one on day 8 does not). A reply to
  yourself does not count. The reply lookup is bounded to the week on both sides, so it uses the
  `ts` index.

Latest join first.

### Drift (`drift`)

The quiet window is the last `QUIET_DAYS` (30) days before `p.to`. The previous period is the
stretch as long as `p` that ends where the quiet window starts. A member drifts when their last
activity, a message or a voice segment (an open segment counts up to its `lastSeenAt`), falls in
the previous period: active then, silent since. So with `30d`, someone last seen 31 days ago is
listed and someone last seen 29 days ago is not; someone last seen 70 days ago was not active in
the previous period (60 to 30 days ago) and is not listed either. Members whose latest membership
change is a `leave` are left out: they are gone, not drifting. Most recently active first.

Voice segments count only once voice is ready (two whole months of voice data). Before that,
drift uses messages alone: a member whose last message is 40 days old is listed even if they were
in voice last week, and a member with voice but no messages is not listed.

### Channel health (`channelHealth`)

One row per channel **or thread** with messages in the period. Threads are channels: each is keyed
by the message's own `channelId` and has its own unanswered rate and reply time, never folded into
its parent. A thread's row carries `parentChannelId` (null for a normal channel). A thread under an
excluded channel is hidden with it (`notExcluded(channelId, parentChannelId)`).

- `unansweredPct`: share of messages that nobody else replied to in the period, 0 to 100 with one
  decimal. Replies are messages themselves, so they count too.
- `medianReplySec`: median time from a message to its first reply by someone else, rounded to
  whole seconds (an even count takes the mean of the two middle values); null when no message was
  answered.

Both the message and its reply must be in the period and in a visible channel; a reply to a
message from before the period does not answer anything. Message counts are grouped per channel in
SQL. The delays come from a self-join of each reply onto its target by `message_id` (unique, so
the join uses its index), grouped per target with `min(reply.ts - target.ts)` and keyed by the
target's own channel; only those per-target delays come back, for the median. Busiest first.

The route adds `name` and `parentName` to each row (`NamedChannelHealthRow`), so the page can show
`thread in #parent`. `withChannelNames(rows, lookup)` takes a lookup function, and the route passes
`cachedChannelNames(ctx)`, which reads the guild's channel cache
(`ctx.client.guilds.cache.get(ctx.guildId)?.channels.cache`) and fetches nothing from Discord. A
channel or thread missing from the cache (deleted, or a thread the bot has not seen since it
started) gets null.

### Economy (`economy`)

From the `activity_credits` ledger, summed in SQL: positive deltas are `creditsIn`, negative
deltas are `creditsOut` (returned as a positive amount), and a zero delta counts as neither. The
same two sums per week make `weekly` (with `start`, see above). `topEarners` are the members with
the highest positive net (earned minus spent), at most 10, ties by id (`HAVING sum(delta) > 0
ORDER BY sum(delta) DESC LIMIT 10`). `storeSales` is the number of `store_purchases` rows in the
period.

### Clubs and events (`clubsAndEvents`)

- **Clubs:** every approved club, with the messages in its thread, channel and voice-channel chat,
  and in threads under those. A club is `dead` when it is older than `QUIET_DAYS` and nobody wrote
  in it during the last `QUIET_DAYS` days before `p.to`; a new, still quiet club is not dead. The
  window includes its first second, so a club whose last message is exactly 30 days old is alive
  and one a second older is dead. One grouped query counts every club's messages in the period
  and a second one, bounded to the quiet window, finds which clubs had any message there.
- **Events** that ran in the period: a one-off whose start (or end) is in it, or a recurring event
  that started before the period's end and had not stopped repeating before its start.
  `attendees` is the size of its participant list (`event_participants` has no per-occurrence
  record).

### Bot usage (`botUsage`)

`activity_commands` grouped by command: `uses` is every run, `failures` the runs with `ok = 0`.
Most used first.

### Relationship web (`relations`)

| `kind` | Counts | Weight |
|---|---|---|
| `replies` | `activity_messages.replyToUserId` | replies |
| `mentions` | `activity_mentions` rows | mentions |
| `voice` | overlapping `activity_voice` segments in the same channel | seconds together, clipped to the period |

A reply's own ping is not a mention (enforced when the row is written), so the two kinds never
count the same thing. Pairs are symmetric: A to B and B to A are summed into one pair with `a` the
smaller id. Self replies and self mentions are left out; bots never appear, since they are never
recorded. The 50 heaviest pairs come back (`RELATIONS_LIMIT`).

`voice` returns `[]` until voice is ready (two whole months of voice data, see the rules above),
including when nothing has been recorded yet. `replies` and `mentions` do not wait.

### Member inspect (`memberInspect`)

For one member in the period:

| Field | Meaning |
|---|---|
| `sent` | Their messages. |
| `received` | Replies to them and mentions of them, by others. |
| `ties` | Distinct members they replied to or mentioned, or who replied to or mentioned them. |
| `busiestHour` | The UTC hour they sent most messages in (the earlier hour on a tie); null without messages. |
| `closest` | Their 5 strongest ties (`CLOSEST_LIMIT`), weight = replies plus mentions both ways. |

Voice is not mixed into ties and closeness (its weight is seconds, not counts); it is in
`relations(p, "voice")`. An unknown member gets zeros, a null hour and an empty `closest`; it never
throws.

## Tests

`queries/admin.test.ts` seeds through the `record*` write API (plain inserts only for `mod_log`,
`warnings`, `store_purchases`, `clubs`, `events` and `event_participants`) and covers every view,
including a thread under a channel excluded after its rows were written. `api/admin.test.ts`
covers the routes: paths and access, the 400 for an unknown period, an unknown relation kind and a
non-numeric user id, and the channel names `channels` adds from a fake guild channel cache.

```sh
nix develop -c bun test src/plugins/activity/queries src/plugins/activity/api
```
