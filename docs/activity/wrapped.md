# Activity analytics: Wrapped

Wrapped is a yearly, Spotify-Wrapped-style look back at a member's year on the server. Each member
with activity gets a personal, reusable link, `/wrapped/<token>`, that opens a story of their own
numbers. Members who opted in also get the link by DM. This page covers the server side: the
snapshot, the links, the run, the DM, the card, the `/wrapped` command and the routes. The story
page itself is in the web app.

The tables (`activity_wrapped_runs`, `activity_wrapped_links`, `activity_wrapped_optins`) are
described in [foundation.md](foundation.md).

## Rules

- **Nothing is automatic.** There is no schedule, and nothing runs or is sent at load or boot. A
  run starts only when an admin starts it: `POST /api/activity/wrapped/run` from the dashboard, or
  `/wrapped start`.
- **DMs go only to members who opted in** (`/wrapped optin` or the sign-up button). A run makes a
  link for every member with activity, but writes only to opted-in members. The one exception is
  an admin resending to one named member (`POST .../resend/:userId`).
- **A link shows only its holder's snapshot.** It is reusable: opening it counts the open and
  never deletes it. An unknown, truncated or other member's token gets a 404 and no data.
- **Years are UTC calendar years**: from 1 Jan 00:00:00 UTC (inclusive) to the next 1 Jan
  (exclusive). A message at 23:59:59Z on 31 Dec counts for that year.
- Excluded channels, and threads under them, are left out of every number.

## Code

```
src/plugins/activity/
  types/wrapped.ts      WrappedData, WrappedRunStatus, WrappedLinkResponse (types only; the web
                        app imports them)
  wrapped/
    data.ts             buildWrapped, yearBounds, activeMemberIds, leftMemberIds
    links.ts            newToken, linkUrl, getLinkByToken, peekLinkByToken, upsertWrappedLink,
                        ensureWrappedLink, getWrappedLink
    run.ts              startWrappedRun, resumeWrappedRun, getWrappedStatus, resendWrappedDm,
                        runSendsDms, waitForWrappedRun, wrappedRunTiming
    dm.ts               sendWrappedDm, wrappedDmPayload
    optin.ts            isOptedIn, setOptIn, optedInCount, applyOptInChoice, signupMessage
    banner.ts           the "wrapped <year>" title banner added above the sign-up and DM text
    commands.ts         /wrapped
    listeners.ts        the wrapped:optin and wrapped:optout buttons
    testing.ts          test helpers (fake client, table reset)
  api/wrapped.ts        wrappedRoutes
src/core/images/components/wrapped-card.tsx   the shareable card (renderWrappedCardPng)
```

## The snapshot

`buildWrapped(userId, year)` returns a `WrappedData`, or null when the member has no message, live
reaction or voice time that year. It reads only the member's own rows:

| Field | From |
|---|---|
| `messages` | their messages |
| `voiceHours` | their voice segments, clipped to the year, one decimal |
| `topEmoji` | up to 3: emoji in their message text plus reactions they added and did not remove, merged by emoji key |
| `busiestHour` | UTC hour (0-23) with most messages |
| `busiestDay` | UTC weekday with most messages, lowercase (`tuesday`) |
| `topChannelId` | channel with most messages; a thread counts as a channel of its own (the public response adds its parent's name) |
| `mostRepliedToId` | who they replied to most (never themselves) |
| `closestFriendId` | the counterpart with the highest weight: 1 per reply they sent, 1 per mention they sent, 1 per 10 minutes (`VOICE_OVERLAP_SECONDS_PER_POINT`) in the same voice channel at the same time |
| `xpLevel` | their current level from `members` |

The friend fields keep only the other member's id, never a number about them. Replies and mentions
count in the member's direction only (what they sent). Reply pings are not mention rows and bots
are never recorded, so neither counts. Ties go to the lowest hour, the earliest weekday (Monday
first) and the lowest id.

## Links

A link row is keyed by (`userId`, `year`) and holds the token, the JSON snapshot, the DM status
(`pending`, `sent`, `failed`, `skipped`) and the open count.

- `newToken()`: 32 random bytes, base64url, 43 characters.
- `linkUrl(token)`: `${PUBLIC_URL}/wrapped/<token>`.
- `getLinkByToken(token)`: the member, year and snapshot; bumps `opens` and `lastOpenedAt`. Null
  for anything that is not an exact stored token. `peekLinkByToken` is the same without counting
  (the card image uses it).
- `upsertWrappedLink` creates a link or replaces its snapshot, keeping the token, DM status and
  opens. `ensureWrappedLink` returns an existing link as is, or builds the snapshot first.

## Runs

`startWrappedRun(ctx, { year, startedBy, sendDms })` returns `started` or `already-running` at
once and works in the background:

1. **processing**: the member list is every member with activity that year whose latest
   membership change is not a leave (`activeMemberIds`, sorted by id; `total` is set before
   returning). Each member's snapshot is built and their link upserted and stamped with the run
   id (`processedRunId`). `processed` and `updatedAt` are saved after every member. The run's
   `sendDms` choice is stored on its row.
2. **sending** (only with `sendDms`): failed and skipped links of the year go back to pending, so a
   member who opted in since the last run, or whose DM failed, is tried again; links already sent
   are not. Each pending link of an opted-in member is DM'd, one per second
   (`wrappedRunTiming.sendDelayMs`); the link becomes `sent` or `failed` and the run's `sent` or
   `failed` goes up. A pending link of a member who has not opted in becomes `skipped`. Members who
   left are passed over.
3. The run ends `done` and posts `wrapped.run-finished` to the mod-log channel, or ends `failed` on
   an error and posts `wrapped.run-failed`. With no mod-log channel set nothing is posted.

`getWrappedStatus()` returns the newest run as a `WrappedRunStatus`, or `idle`. `skipped` (links
of that year marked skipped) and `optedIn` (current opt-ins) are read from the links and opt-in
tables. A `processing` or `sending` run not updated for more than 120 seconds, and not running in
this process, reports `interrupted`.

`resumeWrappedRun(ctx)` continues an interrupted run. During processing it takes a fresh member
list and processes every member whose link this run has not processed (`processedRunId` is not the
run's id), so a member who became active meanwhile is included, one who left is not, and nobody
is processed twice. `processed` is the count of links the run has processed and `total` never
shrinks. During sending it DMs the links still pending. DMs follow only when the run's stored
`sendDms` is 1 (`runSendsDms(id)`); `/wrapped resume` and the resume route say which. Starting a
new run while the latest is interrupted marks the old one `failed` first.

`resendWrappedDm(ctx, userId, year)` DMs one member again (opted in or not), updates the link and
the latest run of that year's counters, and returns `sent`, `failed` or `no-link`.

## Messages

All in `src/core/messages.ts`, category `Wrapped`, editable in the web editor. The defaults copy
the approved board "wrapped: bot messages".

| Key | Params | Where |
|---|---|---|
| `wrapped.signup` | `{year}` | announcement channel, posted by an admin; buttons `wrapped:optin`, `wrapped:optout` |
| `wrapped.optin` | | ephemeral reply to opting in |
| `wrapped.already` | | ephemeral reply to opting in twice |
| `wrapped.optout` | | ephemeral reply to opting out |
| `wrapped.dm` | `{year}`, `{url}` | the DM; link button `open wrapped` to `{url}` |
| `wrapped.me-ready` | `{year}`, `{url}` | `/wrapped me`; link button to `{url}` |
| `wrapped.me-not-ready` | | `/wrapped me` before any run |
| `wrapped.me-empty` | `{year}` | `/wrapped me` with no activity that year |
| `wrapped.run-finished` | `{year}`, `{admin}`, `{sent}`, `{failed}`, `{skipped}` | mod-log channel |
| `wrapped.run-failed` | `{processed}`, `{total}` | mod-log channel |

Keep the button ids and param names: the listener matches the ids, and stored templates use the
params. `wrapped.signup` and `wrapped.dm` get the haiiro title banner (`wrapped <year>`, attached as
`wrapped-banner.png`) put first in their container in code; when the banner cannot be rendered the
message goes out text-only. A failed DM sends nothing else.

The replies of `/wrapped start`, `status`, `resume` and the `forbidden` card are plain `card()`
acks in code, like the elections commands, and are not editable.

## /wrapped

| Subcommand | Who | Does |
|---|---|---|
| `start [year] [send]` | admin | `startWrappedRun`; year defaults to the current UTC year, `send` to true |
| `status` | admin | `getWrappedStatus` as a card (progress bar, counts, dates like `20 Dec 2026`) |
| `resume` | admin | `resumeWrappedRun`; the card says whether DMs follow |
| `optin`, `optout` | anyone | record the choice, ephemeral confirmation |
| `me` | anyone | their own link for the latest run's year (opted in or not); `me-not-ready` before any run, `me-empty` without activity. A member a run missed gets a link made on the spot. |

The admin check is `isAdmin` (Administrator or Manage Server).

## Routes

| Route | Access | Response |
|---|---|---|
| `GET /api/activity/wrapped/run` | admin | `WrappedRunStatus` |
| `POST /api/activity/wrapped/run` | admin | body `{ year?, sendDms? }` (defaults: current UTC year, true); 202 `{ result: "started", status }` or 409 `{ result: "already-running", status }`; 400 on a bad body |
| `POST /api/activity/wrapped/run/resume` | admin | 202 `{ result: "resumed", sendDms, status }` or 409 `{ result: "nothing-to-resume", sendDms, status }`; `sendDms` says whether DMs follow (null with no run) |
| `POST /api/activity/wrapped/resend/:userId?year=` | admin | `{ result: "sent" \| "failed" }`, 404 `{ result: "no-link" }`; year defaults to the latest run's |
| `POST /api/activity/wrapped/signup-message` | admin | posts the sign-up message to the announcement channel; `{ ok: true }`, 400 when none is set |
| `GET /api/activity/wrapped/optins` | admin | `{ count }` |
| `GET /api/activity/wrapped/link/:userId?year=` | admin | `{ url }`, making the snapshot first if needed; 404 without activity |
| `GET /api/activity/wrapped/t/:token` | public | `WrappedLinkResponse` (snapshot plus display names resolved now; `topChannelName` is the plain channel or thread name, `topChannelParentName` the thread's parent or null); counts an open; 404 otherwise |
| `GET /api/activity/wrapped/t/:token/card.png` | public | the card PNG (no open counted); 404 JSON for an unknown token; the `WrappedLinkResponse` JSON when rendering fails |

The public routes need no session: the token is the authorisation.

## The card

`renderWrappedCardPng(data, displayName, avatarUrl?)` in `src/core/images/index.tsx` draws the
shareable card (640 x `WRAPPED_CARD_HEIGHT`, notch `wrapped: ~/<year>`): gold Jacquard title, the
full-colour avatar in a hairline frame (fetched with `fetchImageDataUri`; pass a PNG URL), name,
level, then messages, voice hours, busiest UTC hour and weekday, top emoji, and a rose narrator
line. It draws only the member's own numbers, never the friend fields, because it is meant to be
shared. satori has no emoji font, so a unicode top emoji is shown by its use count only and a
custom one by `:name:`. It returns null on failure.

## Tests

```sh
nix develop -c bun test src/plugins/activity/wrapped
```

`data.test.ts` (snapshot numbers, UTC bounds, friend weights, emoji, exclusions), `links.test.ts`
(tokens, reuse, isolation, the public routes), `run.test.ts` (runs, progress, DMs, opt-in,
interruption and resume, mod-log, nothing automatic) and `optin.test.ts` (opt-in, buttons,
`/wrapped`, the message catalog). DMs and channel posts go to the plain fake client in
`testing.ts`; a 50007-shaped error stands in for closed DMs. Tests set
`wrappedRunTiming.sendDelayMs` to 0 and wait for the background run with `waitForWrappedRun()`.
