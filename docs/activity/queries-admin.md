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
| `/api/activity/admin/channels` | `channelHealth(p)` | `ChannelHealthRow[]` |
| `/api/activity/admin/economy` | `economy(p)` | `Economy` |
| `/api/activity/admin/clubs-events` | `clubsAndEvents(p)` | `ClubsAndEvents` |
| `/api/activity/admin/bot` | `botUsage(p)` | `CommandUsageRow[]` |
| `/api/activity/admin/relations?kind=` | `relations(p, kind)` | `RelationPair[]` |
| `/api/activity/admin/inspect/:userId` | `memberInspect(userId, p)` | `MemberInspect` |

`relations` takes `kind=replies|mentions|voice` (absent means `replies`; anything else is a 400).
`inspect/:userId` answers 400 when the id is not all digits.

## Rules every query follows

- **Excluded channels are hidden at query time.** Every query on a table with a channel filters
  with `notExcluded(channelId, parentChannelId)` (messages, mentions) or `notExcluded(channelId)`
  (voice, which has no parent). A channel excluded today drops out of the next request, threads
  under it included, although its rows stay in the log.
- **Periods are `from` inclusive, `to` exclusive**, in unix seconds; all buckets are UTC.
- **Weekly series** are 7-day buckets counted from the period's start, or from the table's first
  row when that is later (so `all` does not start in 1970). The last bucket may be partial.
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
- `gotReplyInWeek`: someone else replied to one of those messages within that week. A reply to
  yourself does not count, and neither does a reply after the week.

Latest join first.

### Drift (`drift`)

The quiet window is the last `QUIET_DAYS` (30) days before `p.to`. The previous period is the
stretch as long as `p` that ends where the quiet window starts. A member drifts when their last
activity, a message or a voice segment (an open segment counts up to its `lastSeenAt`), falls in
the previous period: active then, silent since. So with `30d`, someone last seen 31 days ago is
listed and someone last seen 29 days ago is not; someone last seen 70 days ago was not active in
the previous period (60 to 30 days ago) and is not listed either. Members whose latest membership
change is a `leave` are left out: they are gone, not drifting. Most recently active first.

### Channel health (`channelHealth`)

Per channel with messages in the period, threads counted under their parent channel:

- `unansweredPct`: share of messages that nobody else replied to in the period, 0 to 100 with one
  decimal. Replies are messages themselves, so they count too.
- `medianReplySec`: median time from a message to its first reply by someone else; null when no
  message was answered.

Busiest channel first.

### Economy (`economy`)

From the `activity_credits` ledger: positive deltas are `creditsIn`, negative deltas are
`creditsOut` (returned as a positive amount), also per week. `topEarners` are the members with
the highest positive net (earned minus spent), at most 10. `storeSales` is the number of
`store_purchases` rows in the period.

### Clubs and events (`clubsAndEvents`)

- **Clubs:** every approved club, with the messages in its thread, channel and voice-channel chat,
  and in threads under those. A club is `dead` when it is older than `QUIET_DAYS` and nobody wrote
  in it during the last `QUIET_DAYS` days before `p.to`; a new, still quiet club is not dead.
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
non-numeric user id.

```sh
nix develop -c bun test src/plugins/activity/queries src/plugins/activity/api
```
