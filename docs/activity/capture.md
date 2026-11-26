# Activity analytics: live capture

Live capture records activity as it happens: gateway listeners for messages, reactions,
membership and voice, a once-a-minute voice heartbeat, and two hooks in core code for slash
commands and Social Credits. Every row goes through the write API in `record.ts` (see
[foundation.md](foundation.md)); capture only decides what to record and when.

```
src/plugins/activity/capture/
  index.ts        captureListeners (event bindings), captureSchedules (the heartbeat)
  listeners.ts    the gateway handlers, onMessageCreate ... onReady, reactionEmojiKey
  voice.ts        planVoice, snapshotOf, openSegmentOf, applyVoice
  hooks.ts        captureCommand, captureCredit (called from core)
  *.test.ts       voice, listeners (with the heartbeat), hooks
```

## Rules every handler follows

- **Gated on `guild_config.activityEnabled`.** While it is 0 nothing is recorded. The config is
  read inside the handler on each event, never at module top level (plugin modules load before
  `initDb()`). The `record*` functions do not check the flag themselves.
- **Never throws.** Each handler and hook catches its own errors and logs them as
  `[activity] <what> capture failed:`. A capture failure cannot reach the gateway, another
  plugin's listener, a command or a credit change.
- **No bots.** A bot is never recorded as an actor. When the bot flag of a user is unknown (a
  partial user that could not be fetched, a voice state without a member) the user is skipped as
  well: no table records which ids are bots, so one that got in could not be filtered out later.
- **Locked guild only.** Events whose guild is not `ctx.guildId` are ignored, as are DMs.
- **Excluded channels** write nothing: `isExcluded(channelId, parentChannelId)` covers a channel
  and every thread under it.

## What each event records

| Event | Handler | Writes |
|---|---|---|
| `MessageCreate` | `onMessageCreate` | `extractMessageFacts(toRawMessage(m), "live")` then `recordMessage`. Bots, webhooks, system messages, DMs and excluded channels give no facts. A message the backfill already stored is not written again. |
| `MessageReactionAdd` | `onReactionAdd` | `recordReactionAdd` with the thread's parent as `parentChannelId`. A partial user, reaction and message are fetched first; a failed fetch is ignored and the handler goes on with what it has. Skipped when the reacting user is a bot, the emoji has neither id nor name, or the channel is excluded. `messageAuthorId` is null when the message's author is a bot or could not be read. |
| `MessageReactionRemove` | `onReactionRemove` | `recordReactionRemove`. Nothing is fetched. A reaction that was never recorded is left alone by the write API. |
| `GuildMemberAdd` | `onMemberAdd` | `recordMembership(id, "join")`. |
| `GuildMemberRemove` | `onMemberRemove` | `recordMembership(id, "leave")`. A kick or a ban is a leave. |
| `VoiceStateUpdate` | `onVoiceStateUpdate` | Closes and opens voice segments, see below. |
| `ClientReady` (once) | `onReady` | Resumes voice after a restart, see below. |

Timestamps are the time the event arrives (`nowSec()`), except messages, which use the
message's own creation time.

### Reaction emoji keys

`reactionEmojiKey(emoji)` builds the key the way `parseEmoji` does for message text, so the
same emoji used in text and as a reaction adds up:

| Reaction emoji | `emoji` | `name` |
|---|---|---|
| Custom (has an id) | `custom:<id>` | the emoji's name |
| Unicode | the emoji with U+FE0F removed | null |
| Neither id nor name | not recorded | |

## Voice segments

A segment is one member in one channel with one set of flags (`muted`, `deafened`, `streaming`,
`video`). See "Things worth knowing" in [foundation.md](foundation.md).

- `snapshotOf(state)` reads a discord.js `VoiceState`: self or server mute counts as muted, self
  or server deafen as deafened, `streaming` and `selfVideo` as is, and a null flag as off. It
  returns null when the member is not in a channel **or the channel is excluded**, so moving
  into an excluded channel ends the segment like a leave.
- `planVoice(prev, next)` is the pure decision, from the open segment and the new snapshot:

  | `prev` (open segment) | `next` | Actions |
  |---|---|---|
  | none | none | nothing |
  | none | A | open A |
  | A | none | close |
  | A | A (same channel and flags) | nothing |
  | A | B (other channel, or any flag changed) | close, then open B |

- `applyVoice(userId, next, ts)` reads the member's open segment from `activity_voice`
  (`openSegmentOf`) and carries out the plan with `closeVoiceSegment` and `openVoiceSegment`.
  The previous state comes from the database, not from the gateway's old state, so a missed
  event is put right by the next one. `openVoiceSegment` also closes any open segment first, so
  segments never overlap.

A state change that touches none of the recorded fields (suppress, request to speak) changes
nothing.

### Restarts

On `ClientReady`, `onReady` first calls `closeDanglingVoiceSegments()`, which ends every segment
left open at its own `lastSeenAt` (the last heartbeat before the bot stopped). It then opens a
segment, starting now, for every member connected at that moment, read from the guild's
voice-state cache. Downtime is never counted as voice time.

The cache source is injectable: `onReady(ctx, source)` takes a `VoiceStateSource`
(`() => Iterable<VoiceState>`) and defaults to `cachedVoiceStates(ctx)`, so tests pass plain
fake voice states.

### Heartbeat

`captureSchedules` holds `voice-activity-heartbeat` (cron `* * * * *`). While activity is enabled
it calls `touchVoiceSegments(nowSec())`, which stamps `lastSeenAt` on every open segment. While it
is disabled it calls `closeDanglingVoiceSegments()` instead, so open segments end at their last
heartbeat and the disabled time is never counted. After recording is turned back on, a member
who stayed connected the whole time gets a new segment at their next voice change or at the next
restart, whichever comes first.

## Core hooks

Two calls in core code, each through a wrapper in `capture/hooks.ts` that checks
`activityEnabled` and catches and logs every error, so the surrounding behaviour is exactly what
it was before capture existed:

| Where | Call | Records |
|---|---|---|
| `handleInteraction` in `src/core/command-registry.ts` | `captureCommand(user.id, commandName, ok)` in a `finally` after `execute` | One `activity_commands` row per run. `ok` is true when `execute` resolved, false when it threw. The error reply to the member is sent first, unchanged. A run refused by the permission check is not recorded. |
| `addCredits` in `src/core/members.ts` | `captureCredit(userId, amount, row.socialCredits)` after the update | One `activity_credits` row: the `amount` passed in and the balance afterwards. |

Known gaps of the credit ledger:

- `delta` is the amount requested. `addCredits` clamps the balance at zero, so a deduction larger
  than the balance records more than was actually taken (balance 5, `-10` records `-10`, balance
  after `0`).
- Store purchases deduct through `trySpend` in `src/plugins/store/service.ts`, not `addCredits`,
  so they are not recorded, while refunds (which use `addCredits`) are.

## Not captured

- `MessageReactionRemoveAll` and `MessageReactionRemoveEmoji` (a moderator clearing reactions):
  the rows stay live.
- Message edits and deletes: a message is recorded as it was sent and stays.

## Tests

```sh
nix develop -c bun test src/plugins/activity/capture
```

The tests call the handlers directly with plain fake events (no discord.js client), on the
in-memory test database. Each file empties the tables it writes to in `beforeEach` and puts the
two activity config columns back in `beforeEach` and `afterAll`.
