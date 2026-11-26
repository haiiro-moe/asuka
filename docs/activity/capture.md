# Activity analytics: live capture

Live capture records activity as it happens: gateway listeners for messages, reactions,
membership and voice, a once-a-minute voice heartbeat, and hooks outside the plugin for slash
commands and Social Credits. Every row goes through the write API in `record.ts` (see
[foundation.md](foundation.md)); capture only decides what to record and when.

```
src/plugins/activity/capture/
  index.ts        captureListeners (event bindings), captureSchedules (runs voiceHeartbeat)
  listeners.ts    the gateway handlers (onMessageCreate ... onReady), reconcileVoice,
                  voiceHeartbeat, reactionEmojiKey
  voice.ts        planVoice, snapshotOf, openSegmentOf, openSegmentStamps, applyVoice
  hooks.ts        captureCommand, captureCredit (called from core and the store)
  *.test.ts       voice, listeners (with the heartbeat), hooks
```

## Rules every handler follows

- **Gated on `guild_config.activityEnabled`.** While it is 0 (the default) nothing is recorded. The config is
  read inside the handler on each event, never at module top level (plugin modules load before
  `initDb()`). The `record*` functions do not check the flag themselves.
- **Never throws.** Each handler and hook catches its own errors and logs them as
  `[activity] <what> capture failed:`. A capture failure cannot reach the gateway, another
  plugin's listener, a command or a credit change.
- **No bots.** A bot is never recorded as an actor. When the bot flag of a user is unknown (a
  partial user that could not be fetched, a voice state without a member) the user is skipped as
  well: no table records which ids are bots, so one that got in could not be filtered out later.
- **Locked guild only.** Events whose guild is not `ctx.guildId` are ignored, as are DMs.
- **No private threads.** Messages and reactions in a private thread write nothing. The check is
  `isPrivateThread` in `exclusion.ts`, the same predicate the backfill uses to leave them out.
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

The cache source is injectable: `onReady(ctx, source)` and `voiceHeartbeat(ctx, source)` take a
`VoiceStateSource` (`() => Iterable<VoiceState> | null`) and default to `cachedVoiceStates(ctx)`,
so tests pass plain fake voice states. The cached source gives **null while the gateway cannot be
trusted**: before the first `ClientReady`, while discord.js is reconnecting (`client.isReady()` is
false), and while the guild is missing or unavailable.

### Heartbeat

`captureSchedules` holds `voice-activity-heartbeat` (cron `* * * * *`), which runs
`voiceHeartbeat`. Voice events can be missed without a restart: when discord.js re-identifies
(an invalid session, a failed resume), `GUILD_CREATE` rebuilds the voice-state cache and no
`VoiceStateUpdate` is emitted. So while activity is enabled, the heartbeat **reconciles** the open
segments with the cache (`reconcileVoice`) before stamping them. Every member who has an open
segment or a cached voice state is checked:

| Member | Result |
|---|---|
| Connected: a known non-bot in a recorded channel | `applyVoice(userId, snapshot, now)`: an unchanged segment carries on (no churn), a missing one is opened, one whose channel or flags changed is closed and replaced, both at now. |
| Has an open segment but is not connected: no cached state, left the channel, moved to an excluded channel, or a member whose bot flag is unknown | The segment is closed at its own `lastSeenAt`, the last heartbeat that saw them, so the time they were away is not counted. |
| A bot, or unknown, with no open segment | Skipped. |

Then `touchVoiceSegments(now)` stamps `lastSeenAt` on every segment that is still open.

- **Gateway not ready** (the source gives null): nothing is reconciled or stamped. A segment left
  open by a restart or an outage still ends at the last heartbeat that saw it, so a heartbeat
  that fires between boot and `ClientReady` cannot stretch the previous run's segments over the
  downtime.
- **Activity disabled:** the heartbeat calls `closeDanglingVoiceSegments()` instead, so open
  segments end at their last heartbeat and the disabled time is never counted. After recording
  is turned back on, the next heartbeat opens segments for the members who are connected.
- The gap that is left is a dead connection discord.js has not noticed yet: while the client
  still reports ready, the stale cache keeps a member who left looking connected, for as long as
  it takes discord.js to notice (a missed gateway heartbeat ack).

## Core hooks

Three calls outside the plugin, each through a wrapper in `capture/hooks.ts` that checks
`activityEnabled` and catches and logs every error, so the surrounding behaviour and return values
are exactly what they were before capture existed:

| Where | Call | Records |
|---|---|---|
| `handleInteraction` in `src/core/command-registry.ts` | `captureCommand(user.id, commandName, ok)` in a `finally` after `execute` | One `activity_commands` row per run. `ok` is true when `execute` resolved, false when it threw. The error reply to the member is sent first, unchanged. A run refused by the permission check is not recorded. |
| `addCredits` in `src/core/members.ts` | `captureCredit(userId, after - before, after)` after the update | One `activity_credits` row with the actual change and the balance afterwards. |
| `trySpend` in `src/plugins/store/service.ts` | `captureCredit(userId, after - before, after)` when the update returned a row | One negative row per store purchase. A spend refused for lack of credits writes nothing. |

Every balance change goes through one of the last two, so the ledger holds credits coming in
(rewards, payouts, admin gifts, refunds) and going out (purchases, admin deductions) alike.

**`delta` is the actual change**, the balance after minus the balance before, not the amount
asked for. `addCredits` clamps the balance at zero, so taking 10 from a balance of 5 records
`-5` with a balance after of `0`. **A change of 0 writes no row** (`addCredits(id, 0)`, or a
deduction from a balance that is already 0).

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
