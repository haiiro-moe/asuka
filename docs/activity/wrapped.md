# Activity analytics: Wrapped

Wrapped is a yearly, Spotify-Wrapped-style look back at the year on the server. Each member with
activity gets a personal, reusable link, `/wrapped/<token>`, that opens a story of their own
numbers, and the server gets one public story of the whole house, `/wrapped/s/<token>`. Members who
opted in get their link by DM. This page covers the server side: the snapshots, the links, the
three run steps, sign-ups, the DM, the cards, the `/wrapped` command and the routes. The story pages
are in the web app.

The tables (`activity_wrapped_runs`, `activity_wrapped_links`, `activity_wrapped_optins`,
`activity_wrapped_server`, `activity_wrapped_signup`) are described in [foundation.md](foundation.md).

## Rules

- **Nothing is automatic.** There is no schedule, and nothing runs, is sent or is posted at load or
  boot. Each step starts only when an admin starts it, from the dashboard or `/wrapped`.
- **Processing, sending and announcing are separate steps.** Processing writes to nobody but the
  admin who started it. DMs go out only in the send step, the announcement only in the send step
  (when asked) or the announce step.
- **DMs go only to members who opted in** (`/wrapped optin` or the sign-up button). Processing makes
  a link for every member with activity, but the send step writes only to opted-in members, and so
  does an admin's resend (`POST .../resend/:userId`), which refuses a member who is not opted in.
- **A link shows only its holder's snapshot.** It is reusable: opening it counts the open and
  never deletes it. An unknown, truncated or other member's token gets a 404 and no data.
- **Naming on the server story**: only the best pair (only when both opted in), the best club's
  founder and the president are named. No member's personal snapshot is part of it.
- **Years are UTC calendar years**: from 1 Jan 00:00:00 UTC (inclusive) to the next 1 Jan
  (exclusive). A message at 23:59:59Z on 31 Dec counts for that year.
- **Threads are channels**: anything ranked by channel groups by the message's own channel. Excluded
  channels, and threads under them, are left out of every number.
- **Voice needs two whole months of data.** Nothing derived from voice is shown until the voice log
  holds two whole UTC months (`src/plugins/activity/voice-ready.ts`); see "Voice readiness" below.
- **All aggregation is in SQL** (`group by`, joins, window functions for the median); only one row
  per member, club, term or emoji comes back to JavaScript.

## Code

```
src/plugins/activity/
  types/wrapped.ts      WrappedData, WrappedClub, WrappedPresidency, WrappedTitle, ServerWrapped,
                        WrappedRunStatus, WrappedSignupState and the route response types
                        (types only; the web app imports them)
  wrapped/
    data.ts             buildWrapped, wrappedShared, yearBounds, activeMemberIds, leftMemberIds
    extras.ts           clubYearStats, clubFor, presidencyTermsIn, presidencyFor,
                        serverActivityPercent, emojiTotals, electionsIn
    titles.ts           titleAwards, titlesFor, MIN_MESSAGES, MIN_VOICE_HOURS
    server.ts           buildServerWrapped, serverWrappedDeps, getOrCreateServerToken,
                        storeServerWrapped, getServerWrappedByToken, serverWrappedUrl
    links.ts            newToken, linkUrl, getLinkByToken, peekLinkByToken, upsertWrappedLink,
                        ensureWrappedLink, getWrappedLink, listFailedDms
    run.ts              startWrappedRun, startWrappedSend, postAnnouncement, resumeWrappedRun,
                        getWrappedStatus, latestRunPhase, resendWrappedDm, waitForWrappedRun,
                        wrappedRunTiming
    preview.ts          startWrappedPreview, resumeWrappedPreview, discardWrappedPreview,
                        getPreviewStatus, getPreviewServerByToken, parseMemberIds,
                        waitForWrappedPreviews
    signup.ts           postSignupMessage, closeSignups, reopenSignups, signupsClosed,
                        getSignupState
    dm.ts               sendWrappedDm, wrappedDmPayload
    optin.ts            isOptedIn, setOptIn, optedInCount, applyOptInChoice, signupMessage
    banner.ts           the "wrapped <year>" title banner above the sign-up, DM and announcement
    commands.ts         /wrapped
    listeners.ts        the wrapped:optin and wrapped:optout buttons
    testing.ts          test helpers (fake client, table reset)
  api/wrapped.ts        wrappedRoutes
src/core/images/components/wrapped-card.tsx          the member card (renderWrappedCardPng)
src/core/images/components/wrapped-server-card.tsx   the server card (renderWrappedServerCardPng)
```

## Voice readiness

`voiceReadiness(now)` (`voice-ready.ts`) says whether the voice log is old enough. Processing checks it
**once** when it starts (or resumes) and passes the answer down through `wrappedShared(year,
voiceReady)` and `buildServerWrapped(year, { voiceReady })`; the on-demand paths (`ensureWrappedLink`,
the server-link route) check it once per request. Both snapshots store the answer as `voiceReady`,
so a story never changes after it is sent, and the public responses repeat it at the top level.

The Wrapped paths (processing, the private preview, `wrappedShared`, `buildServerWrapped`, the
titles and club stats) ask `voiceReadinessForYear(year)`, which judges readiness at
`min(now, the year's last second)`. Processing 2026 after 1 Feb 2027 therefore does not show
voice when the log only became ready in 2027: a log that started on 15 Nov 2026 holds six weeks
of 2026, not two whole months.

While voice is **not** ready:

- `WrappedData.voiceHours` and `ServerWrapped.voiceHours` are `null` (never a made-up zero); the
  cards drop their voice row and the story pages skip the voice slide.
- The soulmate is chosen from replies and mentions only; the best pair from replies only, with
  `bestPair.voiceHours` null.
- The voice titles (`longest-voice`, `most-voice-hours`, `club-most-voice`) are not awarded, a
  club's `voiceRank` is null and the club voice figures are not computed.
- Voice time alone does not make a member active, so a member with only voice gets no snapshot.
- Presidency numbers do not use voice and are unchanged.

When voice is ready, everything is as described below.

## The member snapshot

`buildWrapped(userId, year, shared?)` returns a `WrappedData`, or null when the member has no
message, live reaction or voice time that year. A run computes the year aggregates once
(`wrappedShared(year)`: club stats, presidency terms, title winners) and passes them in.

| Field | From |
|---|---|
| `messages` | their messages |
| `voiceHours` | their voice segments, clipped to the year, one decimal; null while voice is not ready |
| `topEmoji` | up to 3: emoji in their message text plus reactions they added and did not remove, merged by emoji key |
| `busiestHour` | UTC hour (0-23) with most messages |
| `busiestDay` | UTC weekday with most messages, lowercase (`tuesday`) |
| `topChannelId` | channel with most messages; a thread counts as a channel of its own (the public response adds its parent's name) |
| `mostRepliedToId` | who they replied to most (never themselves) |
| `soulmateId` | the counterpart with the highest weight: 1 per reply they sent, 1 per mention they sent, 1 per 10 minutes (`VOICE_OVERLAP_SECONDS_PER_POINT`) in the same voice channel at the same time |
| `xpLevel` | their current level from `members` |
| `club` | the club they own (see below), or null |
| `presidency` | their presidency that year (see below), or null |
| `titles` | the titles they won (see below) |
| `voiceReady` | whether voice figures were shown when the snapshot was taken |

The soulmate and most-replied-to fields keep only the other member's id, never a number about them.
Replies and mentions count in the member's direction only (what they sent). Reply pings are not
mention rows and bots are never recorded, so neither counts. Ties go to the lowest hour, the
earliest weekday (Monday first) and the lowest id.

### Club

`clubYearStats(year)` gives every **approved** club's members (accepted, now), messages and voice
seconds that year. Messages are attributed by the club's `channelId` and `threadId`, matching a
message's own channel or its parent; voice by `voiceChannelId` and `channelId`. `clubFor` picks the
club the member owns with the most messages and ranks it among all approved clubs by messages,
members and voice (competition rank: 1 + how many are strictly higher, so ties share).

### Presidency

Terms come from the elections history (`getPresidencyHistory` in `elections/service.ts`): a term runs
from its election's close to the next election's start, or to now while ongoing. `presidencyFor`
clips the member's terms to the year (and to now for the current year):

- `terms`: their terms overlapping the year; `daysInOffice`: whole days (floor of the clipped seconds).
- `votes` and `votePercent`: from the election of their latest term in the year; the percentage is
  their votes over all candidates' votes, rounded; null without a candidate row or votes.
- `messagesInOffice`: their messages during the terms; `perDay`: over `max(1, daysInOffice)`, one decimal.
- `serverActivityPercent`: the server's messages per day during the terms against its messages per
  day over the year so far (the whole year once it is over), minus 100%, rounded; 0 without data.
- `topEmojiInOffice`: their most used emoji key during the terms (text and reactions).

### Titles

`titleAwards(year)` gives every title and its winners; `titlesFor(userId, year)` filters one
member's. Rank 1 only; a tie shares the title (`joint 1st of N`). A quiet year awards nothing.

| Key | Label | Winner | Minimum |
|---|---|---|---|
| `night-owl` | night owl | most messages 00:00-04:59 UTC | 100 messages that year |
| `earliest-bird` | earliest bird | most messages 05:00-07:59 UTC | 100 messages |
| `longest-voice` | longest voice | longest closed voice segment (clipped to the year) | 10 voice hours |
| `fastest-replier` | fastest replier | lowest median reply time, 10 replies or more | 100 messages |
| `most-replied-to` | most replied to | most replies received | 100 messages |
| `most-messages` | most messages | most messages | 100 messages |
| `most-voice-hours` | most voice hours | most voice time | 10 voice hours |
| `emoji-lord` | emoji lord | most emoji uses (text and reactions) | 100 messages |
| `club-most-members` | biggest club | the owner of the club with most members | the club wrote 100 messages |
| `club-most-messages` | loudest club | the owner of the club with most messages | the club wrote 100 messages |
| `club-most-voice` | club in voice | the owner of the club with most voice time | the club has 10 voice hours |
| `president` | president | everyone who held the chair that year | |

`N` in `1st of N` is how many members met the minimum (or how many approved clubs there are).
`detail` is a short lowercase phrase, e.g. `1st of 43, most after midnight`.

## The server snapshot

`buildServerWrapped(year, deps)` returns a `ServerWrapped`, or null when nobody wrote or spoke
that year. `deps` carries the guild's custom emoji ids and a name lookup; the run builds them from
the guild cache with `serverWrappedDeps(ctx)` (fetching members once when the cache is short), so
names are stored in the snapshot and the public story never calls Discord. Tests pass fakes.

| Field | From |
|---|---|
| `messages`, `speakers` | all messages, distinct authors |
| `voiceHours` | all voice segments, clipped; null while voice is not ready |
| `voiceReady` | whether voice figures were shown when the snapshot was taken |
| `topEmoji` (3), `unusedCustomEmoji` | text and reactions merged; the guild's custom emoji with no use that year |
| `topChannels` (5) | by the message's own channel; a thread carries its parent's name |
| `busiestHour`, `busiestWeekday` | UTC, by messages |
| `bestPair` | the pair with the highest weight of replies between them (1 each, either way) and voice time together (1 per 10 minutes). The top pair only, and only when both opted in; otherwise null (no runner-up is named instead). Opt-ins are checked again every time the story is served (`getServerWrappedByToken`, used by both public routes): if either member opted out since the snapshot was built, `bestPair` is served as null, without ids or names |
| `bestClub` | the approved club with most messages, with its founder's name |
| `president` | whoever held the chair longest that year: name, terms, days, `serverActivityPercent`, and the elections that started that year with the distinct members who stood |

The year's server row holds a reusable token (`getOrCreateServerToken`, 32 random bytes) that is
kept when a later run refreshes the snapshot, and `announcedAt`.

## Links

A link row is keyed by (`userId`, `year`) and holds the token, the JSON snapshot, the DM status
(`pending`, `sent`, `failed`, `skipped`), the open count and `processedRunId`.

- `newToken()`: 32 random bytes, base64url, 43 characters.
- `linkUrl(token)`: `${PUBLIC_URL}/wrapped/<token>`; `serverWrappedUrl(token)`: `${PUBLIC_URL}/wrapped/s/<token>`.
- `getLinkByToken(token)`: the member, year and snapshot; bumps `opens` and `lastOpenedAt`. Null
  for anything that is not an exact stored token. `peekLinkByToken` is the same without counting
  (the card image uses it).
- `upsertWrappedLink` creates a link or replaces its snapshot, keeping the token, DM status and
  opens. `ensureWrappedLink` returns an existing link as is, or builds the snapshot first.

## The three steps

Statuses: `processing` -> `processed` -> `sending` -> `done`, plus `failed` and `interrupted`.

1. **Process**, `startWrappedRun(ctx, { year, startedBy })`: returns `started` or `already-running`
   at once and works in the background. The member list is every member with activity that year
   whose latest membership change is not a leave (`activeMemberIds`, sorted; `total` is set before
   returning). Each member's snapshot is built and their link upserted and stamped with the run id
   (`processedRunId`); `processed` is saved after every member. Then the server snapshot is built
   and stored. The run ends `processed` ("ready to send") and the starting admin gets the
   `wrapped.processed` DM with a button to `${PUBLIC_URL}/#/activity-admin`; when that DM fails the
   same card goes to the mod-log channel, and when that is unset too, nothing. That notice never
   fails the run. No member is written to and nothing is announced.
2. **Send**, `startWrappedSend(ctx, { startedBy, announce = true })`: allowed when the latest run is
   `processed` or `done` (a later send reaches members who opted in since and retries failed links),
   or `failed` when its processing had completed (`processed` equals `total`), so a send that crashed
   is retried without reprocessing the year;
   returns `started`, `already-running` or `not-processed`. Failed and skipped links of the year go
   back to pending; each pending link of an opted-in member is DM'd, one per second
   (`wrappedRunTiming.sendDelayMs`), and becomes `sent` or `failed`; a pending link of a member who
   has not opted in becomes `skipped`; links already sent are never sent again; members who left
   are passed over. `sent` counts every sent link of the year, `failed` the failures of this send.
   The run ends `done`; then, when `announce` is on, `postAnnouncement` runs; then
   `wrapped.run-finished` goes to the mod-log channel. `announce` is stored on the run for a resume.
3. **Announce**, `postAnnouncement(ctx, year)`: posts `wrapped.announce` (banner and a link button to
   the server story) to the announcement channel, at most once per year. It claims the year first
   with an atomic update (`announcedAt` set only where it is null) and an in-process guard, so two
   concurrent calls post once; a failed post releases the claim so it can be retried. Returns
   `posted`, `already-announced`, `not-processed` (the latest run of that year is not `processed` or
   `done`, or there is no server snapshot; an admin preview alone does not count), `no-channel` (no
   announcement channel is set) or `failed` (the channel could not be reached or the post failed).

`getWrappedStatus()` returns the newest run as a `WrappedRunStatus`, or `idle`. `skipped` and
`optedIn` come from the links and opt-in tables, `announcedAt` from the year's server row. A
`processing` or `sending` run not updated for more than 120 seconds, and not running in this
process, reports `interrupted`.

`resumeWrappedRun(ctx)` continues the phase that was interrupted. Processing takes a fresh member
list and processes every member whose link this run has not processed, so a member who became
active meanwhile is included, one who left is not, and nobody is processed twice (`total` never
shrinks); it then ends `processed` as above. Sending DMs the links still pending, with the run's
stored `announce`; the announcement stays once per year. Starting a new processing run while the
latest is interrupted marks the old one `failed` first. A failure in either step ends the run
`failed` and posts `wrapped.run-failed` to the mod-log channel.

`resendWrappedDm(ctx, userId, year)` DMs one member again, for the resend control on the failed
list. It refuses without sending: `no-link` (no link that year), `left` (the member left),
`not-opted-in`, `already-sent` (the link was delivered; the member's own `/wrapped me` is the way
back to it, and the admin's `open link` still works) and `sending` (a send step runs for the year,
or this link's DM is in flight). So only a `failed` link, or one not yet sent, is resent. On
success the run's `sent` counter becomes the number of sent links of the year, so a link is never
counted twice.

The send step reads each link again right before its DM and skips one that is no longer `pending`
or whose DM is in flight elsewhere (an in-process set shared with the resend).

## Sign-ups

The sign-up message is the `wrapped.signup` card ("wrapped is coming") with the opt in and opt out
buttons, posted to the announcement channel. `activity_wrapped_signup` keeps one row per year.

- `postSignupMessage(ctx, { year, buttons })` posts it (`buttons: false` posts the same card without
  buttons, information only) and stores the channel and message ids, replacing the year's previous
  record and opening sign-ups. Returns `posted` or `no-channel`.
- `closeSignups(ctx, year)` edits the posted message so both buttons are disabled (same labels) and
  marks the year closed; `reopenSignups(ctx, year)` re-enables them. A deleted message or channel is
  logged and the state changes anyway; a year without a message can be closed too.
- While the latest year's sign-ups are closed (`signupsClosed()`), the buttons and `/wrapped optin` /
  `optout` change nothing and reply `wrapped.signup-closed`. `/wrapped me` always works.

## Messages

All in `src/core/messages.ts`, category `Wrapped`, editable in the web editor.

| Key | Params | Where |
|---|---|---|
| `wrapped.signup` | `{year}` | announcement channel, posted by an admin; buttons `wrapped:optin`, `wrapped:optout` |
| `wrapped.optin` | | ephemeral reply to opting in |
| `wrapped.already` | | ephemeral reply to opting in twice |
| `wrapped.optout` | | ephemeral reply to opting out |
| `wrapped.signup-closed` | | ephemeral reply to opting in or out while sign-ups are closed |
| `wrapped.dm` | `{year}`, `{url}` | the DM; link button `open wrapped` to `{url}` |
| `wrapped.me-ready` | `{year}`, `{url}` | `/wrapped me`; link button to `{url}` |
| `wrapped.me-not-ready` | | `/wrapped me` before any run |
| `wrapped.me-empty` | `{year}` | `/wrapped me` with no activity that year |
| `wrapped.processed` | `{year}`, `{links}`, `{optedIn}`, `{url}` | DM to the admin who started processing (mod-log fallback); link button `open the dashboard` |
| `wrapped.announce` | `{year}`, `{url}` | announcement channel; link button `open the server wrapped` |
| `wrapped.run-finished` | `{year}`, `{admin}`, `{sent}`, `{failed}`, `{skipped}`, `{announcement}` | mod-log channel when the DMs finish (`wrapped dms finished`) |
| `wrapped.run-failed` | `{processed}`, `{total}` | mod-log channel |

Keep the button ids and param names: the listener matches the ids, and stored templates use the
params. `wrapped.signup`, `wrapped.dm` and `wrapped.announce` get the haiiro title banner (`wrapped
<year>`, attached as `wrapped-banner.png`) put first in their container in code; when the banner
cannot be rendered the message goes out text-only. A failed DM sends nothing else.

The replies of the admin subcommands and the `forbidden` card are plain `card()` acks in code, like
the elections commands, and are not editable.

## /wrapped

| Subcommand | Who | Does |
|---|---|---|
| `start [year]` | admin | process the year (default the current UTC year); says that a DM follows when it is done |
| `send [announce]` | admin | the send step; `announce` defaults to true; shows `» dms: opted-in members only (n of N)` and the announcement line |
| `announce` | admin | `postAnnouncement` for the latest run's year |
| `signups action:` | admin | `post`, `post-without-buttons`, `close`, `reopen` |
| `status` | admin | `getWrappedStatus` as a card (phase, counters, announcement, dates like `20 Dec 2026`) |
| `resume` | admin | `resumeWrappedRun` |
| `preview [year] [member] [members] [all]` | admin | start a private preview (see "Private wrapped (preview)"); `member` is one user, `members` up to 10 ids or mentions, `all` processes every member for the counts |
| `preview-discard` | admin | delete the admin's preview and its links |
| `optin`, `optout` | anyone | record the choice, ephemeral confirmation (or `wrapped.signup-closed`) |
| `me` | anyone | their own link for the latest run's year (opted in or not); `me-not-ready` before any run, `me-empty` without activity. A member a run missed gets a link made on the spot. |

The admin check is `isAdmin` (Administrator or Manage Server). The slow admin subcommands (`start`,
`send`, `announce`, `signups`, `resume`, `preview`, `preview-discard`) defer first (ephemeral) and answer through `editReply`, so the
3-second interaction deadline is never missed; `status` replies directly.

## Routes

| Route | Access | Response |
|---|---|---|
| `GET /api/activity/wrapped/run` | admin | `WrappedRunStatus` |
| `POST /api/activity/wrapped/run` | admin | body `{ year? }` (default the current UTC year), processing only; 202 or 409 `WrappedRunStartResponse`; 400 on a bad body |
| `POST /api/activity/wrapped/send` | admin | body `{ announce? }` (default true); 202 or 409 `WrappedSendResponse` |
| `POST /api/activity/wrapped/announce` | admin | `WrappedAnnounceResponse` for the latest run's year: 200 posted, 502 failed (retry), 409 otherwise |
| `POST /api/activity/wrapped/run/resume` | admin | 202 or 409 `WrappedResumeResponse` |
| `POST /api/activity/wrapped/resend/:userId?year=` | admin | `WrappedResendResponse`: 200 `sent` or `failed`, 404 `no-link`, 409 `left`, `not-opted-in`, `already-sent` or `sending`; year defaults to the latest run's |
| `GET /api/activity/wrapped/signup` | admin | `WrappedSignupState` (`year`, `posted`, `buttons`, `closed`, `optedIn`) |
| `POST /api/activity/wrapped/signup-message` | admin | body `{ year?, buttons? }` (defaults: current UTC year, true); the new `WrappedSignupState`; 400 when no announcement channel is set or reachable |
| `POST /api/activity/wrapped/signup/close` | admin | close sign-ups; the `WrappedSignupState` |
| `POST /api/activity/wrapped/signup/reopen` | admin | reopen sign-ups; the `WrappedSignupState` |
| `GET /api/activity/wrapped/optins` | admin | `{ count }` |
| `GET /api/activity/wrapped/failed?year=` | admin | `WrappedFailedList`: `{ year, items: { userId, state: "failed" }[], truncated }`, the failed DMs of members still opted in (never skipped, pending or sent), by user id, at most 200 (`truncated` when more exist); one SQL query (`listFailedDms`), no Discord call. Year defaults to the latest run's, else the current UTC year; 400 for a bad year |
| `GET /api/activity/wrapped/link/:userId?year=` | admin | `{ url }`, making the snapshot first if needed; 404 without activity |
| `GET /api/activity/wrapped/server-link?year=` | admin | `{ url }` of the server story, building its snapshot first if needed; 404 when nothing happened |
| `GET /api/activity/wrapped/t/:token` | public | `WrappedLinkResponse` (snapshot plus `displayName`, `soulmateName`, `mostRepliedToName`, `topChannelName` and `topChannelParentName` resolved now); counts an open; 404 otherwise |
| `GET /api/activity/wrapped/t/:token/card.png` | public | the member card PNG (no open counted); 404 JSON for an unknown token; the `WrappedLinkResponse` JSON when rendering fails |
| `GET /api/activity/wrapped/s/:token` | public | `ServerWrappedResponse` (`{ data, preview, voiceReady }`; `preview` is true for an admin preview link); 404 otherwise |
| `GET /api/activity/wrapped/s/:token/card.png` | public | the server card PNG; 404 JSON for an unknown token; the JSON when rendering fails |

The public routes need no session: the token is the authorisation.

Their `cache-control` (`wrappedCacheControl` in `api/wrapped.ts`): a private preview response,
JSON or card, is `no-store`; a real story's JSON is `private, no-cache` (names are resolved on
open); a real member or server card is `private, max-age=300`. No shared cache keeps any of them.

## The cards

`renderWrappedCardPng(data, displayName, avatarUrl?)` draws the member card (640 x
`WRAPPED_CARD_HEIGHT`, notch `wrapped: ~/<year>`): gold Jacquard title, the full-colour avatar in a
hairline frame (fetched with `fetchImageDataUri`; pass a PNG URL), name, level, then messages, voice
hours, busiest UTC hour and weekday, top emoji, and a rose narrator line. It draws only the member's
own numbers, never the soulmate and most-replied-to fields, because it is meant to be shared. satori
has no emoji font, so a unicode top emoji is shown by its use count only and a custom one by `:name:`.

`renderWrappedServerCardPng(data)` draws the server card (640 x `WRAPPED_SERVER_CARD_HEIGHT`, notch
`wrapped: ~/server/<year>`): messages, speakers, voice hours, busiest hour and weekday, the top
channel (`thread in #parent` for a thread), the best club and the president. The best pair is never
drawn. Both renderers return null on failure.

## Private wrapped (preview)

An admin can generate the year's Wrapped privately, to check it before the real run. Rulings
R-P1..R-P7 in the plan's DECISIONS.md. Code: `wrapped/preview.ts`.

- **A separate run kind.** A preview is a row in `activity_wrapped_runs` with `kind = "private"` and
  `ownerUserId` = the admin. Its links are rows with `private = 1` and `ownerUserId` set (the links
  key is (`userId`, `year`, `ownerUserId`), so a member can hold a real link and a preview link), and
  its server snapshot lives in the run's `preview` JSON with its own `serverToken`. The real run
  never sees private rows: every real-run query (latest run, counts, `skipped`, the failed list,
  sending, resend, the announcement check) filters `kind = "real"` or `private = 0`. A preview never
  touches the real run, its links, the sign-up message, `announcedAt` or the public server story,
  and a real run can run before, during or after one. One active preview per admin.
- **Scope.** The admin plus the most active members of the year by messages (3 by default, at most
  10), or an explicit list of at most 10 ids (which replaces the sample; non-numeric ids or more
  than 10 are refused). With `all`, every active member's snapshot is built too, for the counts; the
  DMs still cover the sample only.
- **Opt-ins are ignored** when generating. The status reports `wouldSkip` (processed members not
  opted in) and a per-member flag for the sample; each member preview says "would not be sent: not
  opted in" when that applies. The best pair is still named only when both opted in.
- **Delivery.** When processing is done the bot DMs the admin, and only the admin: the intro
  (`wrapped.preview-intro`), then for each sampled member with activity the exact DM they would get
  (`wrapped.dm` with their private link) under a "preview for <name>" label (`wrapped.preview-for` or
  `wrapped.preview-skip`), then the announcement (`wrapped.announce` with its buttons disabled, under
  `wrapped.preview-announce`), then the private server link (`wrapped.preview-server`). Nothing is
  DM'd to a member and nothing is posted to any channel. When the admin's DMs are closed the status
  records `dmFailed` and an `error`, and nothing is retried; the links are in the status.
- **Lifecycle.** `processing` -> `processed` -> `sending` -> `done`, plus `failed` and `interrupted`
  (no update for 120 seconds); `resumeWrappedPreview` continues processing (only the members not yet
  built) or the DMs not yet sent. Starting a preview is always a manual admin action; voice
  readiness is checked once at the start (the two-month rule applies).
- **Expiry and discard.** A preview and its links last 14 days. After that the token routes give
  the uniform 404 (a lazy check on lookup) and the rows are deleted at the next preview start, by
  any admin; starting a new preview also replaces the admin's previous one. `discardWrappedPreview`
  deletes the run, its links and its server story at once (refused while it is still running).
- **Public pages.** The token routes (`t/:token`, `s/:token` and their cards) serve preview links
  too, with `preview: true` in the response so the story page shows a preview ribbon; real links
  give `preview: false`.
- **Routes** (admin; the owner is always the session's user, never a body field, and an admin only
  ever sees their own preview):

| Route | Response |
|---|---|
| `POST /api/activity/wrapped/preview` | body `{ year?, members?: string[], all?: boolean }`; 202 started, 409 already running, 400 invalid: `PreviewStartResponse` (`{ result, error?, status }`) |
| `GET /api/activity/wrapped/preview` | the caller's `PreviewStatus` (`idle` when none): status, year, total, done, all, sampled members with display names, `wouldSkip` and `hasLink`, the `wouldSkip` count, `dmFailed`, the sample's links, the server token, `expiresAt`, `error` |
| `POST /api/activity/wrapped/preview/discard` | `PreviewDiscardResponse` (`discarded`, `nothing`, or `running` with 409) |

- **Command.** `/wrapped preview` (options `year`, `member`, `members`, `all`) and
  `/wrapped preview-discard`, admin only with the same check as `/wrapped start`; both defer first.

## Tests

```sh
nix develop -c bun test src/plugins/activity/wrapped
```

`data.test.ts` (snapshot numbers, UTC bounds, soulmate weights, emoji, threads, exclusions),
`extras.test.ts` (club and ranks, presidency over a fixed term), `voice.test.ts` (voice readiness: null voice figures, soulmate and titles without voice, one readiness check per run, cards without voice), `titles.test.ts` (sole winner,
ties, thresholds, club and president titles), `server.test.ts` (server totals, threads, best pair
naming, best club, president, server token, announcement, public routes), `links.test.ts` (tokens,
reuse, isolation, the public member routes), `run.test.ts` (the three steps, the starter's DM and
its fallback, progress, DMs, opt-in, interruption and resume, mod-log, nothing automatic) and
`optin.test.ts` (opt-in, buttons, sign-up control, `/wrapped`, the message catalog) and
`preview.test.ts` (private previews: isolation from the real run both ways, admin-only DMs and no
channel post, the sample, opt-ins ignored, the voice rule, `all`, discard, expiry, resume, closed
DMs, the routes and the command). DMs, channel
posts and message edits go to the plain fake client in `testing.ts`; a 50007-shaped error stands in
for closed DMs. Tests set `wrappedRunTiming.sendDelayMs` to 0 and wait for the background work with
`waitForWrappedRun()`.
