# Activity web: admin diagnostics page

The admin tier's activity page, `activity-admin` (nav label `diagnostics`, `minRole: "admin"`). It
shows every admin view with names, and it is where an admin runs the history backfill and the
yearly Wrapped by hand. The server side is in [queries-admin.md](queries-admin.md),
[backfill.md](backfill.md) and [wrapped.md](wrapped.md); the shell, chart wrappers and hook are in
[web.md](web.md).

## Layout

```
src/web/app/activity/admin/
  pages.tsx            ADMIN_PAGES
  DiagnosticsPage.tsx  status strip, tabs, period picker, backfill modal owner
  StatusStrip.tsx      the Wrapped run and backfill lines
  useOpsStatus.ts      polls the run, the backfill and your preview (2 s while running, 30 s otherwise)
  ModerationTab.tsx  NewcomersTab.tsx  DriftTab.tsx  ChannelsTab.tsx
  EconomyTab.tsx  ClubsEventsTab.tsx  BotTab.tsx
  RelationsTab.tsx  InspectPanel.tsx
  DataTab.tsx          backfill window, Wrapped overview, steps, sign-ups
  BackfillModal.tsx
  WrappedOverview.tsx  ProcessStep.tsx  SendStep.tsx  AnnounceStep.tsx
  MemberDmActions.tsx  failed-DM list rows (resend, open link) and the member id field (open link)
  useMemberDm.ts       resend and open link for one member
  SignupsWindow.tsx
  PreviewSection.tsx   the private preview window: start form, status, links, discard
  LinkActions.tsx      copy link and open, for the real server link and the preview links
  parts.tsx            ViewState, DataTable, Quiet, Sheet, ProgressBar, status inks
  http.ts              call(): a JSON request that never throws (409 and 502 bodies matter here)
  format.ts            dates, week labels, durations, channel labels, stepped percent, periods
  status.ts            status-strip text and the poll interval
  steps.ts             step gates, the outward-step confirms, the backfill button word, the year field
  failed.ts            failed-DM list view, when to show it, when to fetch it again
  preview.ts           preview member list, body, status words, strip rule, gates, expiry, links
  fixtures.ts          test fixtures only
  *.test.ts            bun tests of format, status, steps, failed and preview
```

The page returns windows inside a `flex flex-col` wrapper, like the config page: the strip, the
`Tabs` row, a period window (`Select`, every tab but data) and the tab panel. Tabs fetch only when
shown.

## Status strip

Always on top, on every tab: one line for the Wrapped run and one for the backfill, each a glyph
and words in a bright ink (`·` idle in subtle, `»` running in rose or waiting for you in gold, `✓`
done in foam, `×` failed in love). The words are `wrappedStatusLine` and `backfillStatusLine` in
`status.ts`:

| Wrapped | Backfill |
|---|---|
| `idle, no run yet` | `idle, nothing read yet` |
| `processing 12 of 40` | `reading 4 of 30 channels, 12,000 messages` |
| `processed, ready to send` | `stopped at 4 of 30 channels, resume it from the data tab` |
| `sending 12 of 40` (`, 1 failed`) | `done: 30 channels, 12,000 messages` (`, 2 channel errors`) |
| `done: 30 sent, 2 failed, 8 not opted in` | `failed: could not list the channels` |
| `failed at 12 of 40` / `failed while sending` | |
| `interrupted at 12 of 40, resume it from the data tab` | |

Sending progress is links settled (`sent + failed + skipped`) of `total`, capped at `total`.

`useOpsStatus(fast)` polls `GET /api/activity/wrapped/run`, `GET /api/activity/backfill` and the
session admin's own `GET /api/activity/wrapped/preview` together, in one loop with one timer (never
stacked). The next poll waits `pollInterval(wrapped, backfill, fast, preview)`: 2 seconds while
any of them runs (a preview counts as running while `processing`, `processed` or `sending`) or
`fast` is set (the page sets it while the backfill modal is open), 30 seconds otherwise. A failed
poll keeps the last good status and shows the cause. The strip and the data tab share the one hook.
The strip is not a live region, because its counters change every 2 seconds.

A third line, `private preview 2026`, appears only while the admin's preview runs and for 10
minutes after it finished (`previewInStrip`), its words followed by `(nothing goes to members)`
(`previewStripLine`). The real-run and backfill lines are unchanged by it.

## Tabs

Each tab passes `?period=` (default `30d`) to its route and renders loading, failed (with retry)
and empty as narrator lines through `ViewState`. The picker (`PERIODS`) offers `last 7 days`, `last
30 days`, `this term`, `last 365 days` (`year`: the server counts the last 365 days, not the
calendar year) and `all time`; `week` is not offered, since the server reads it as `7d`. A period
change shows the loading line, never the previous period's tables (`useActivity` keeps data with
its path).

- **moderation**: tiles, actions per week (`ActivityColumns`), actions by kind, repeat offenders.
- **newcomers**: joined, got a reply, said nothing; a table with join day, first-week messages and
  `✓ yes` / `× no`.
- **drift**: members gone quiet, last active day. While voice is withheld, a line says drift is
  judged on messages alone and when voice unlocks.
- **channels**: one row per channel or thread. A thread shows its own name and a subtle
  `thread in #parent`; a null name falls back to the id (`channelLabel`).
- **economy**: earned, spent, store sales, earned and spent per week, top earners.
- **clubs and events**: clubs with a `dead` or `alive` chip, events by sign-ups.
- **bot**: runs, failures and commands used.
- **relations**: a `Segmented` of replies, mentions and voice over a ranked table of the top 25
  pairs (no node-link graph: that waits for the design system). Each name is a flat button that
  opens the member in the inspect panel below, which also takes a pasted id and shows sent,
  received, ties, busiest UTC hour and the closest members (`ActivityRank`).
- **data**: see below.

Weekly series are labelled from their explicit UTC `start` (`weekLabels(start, n)`, bucket `i`
starts at `start + i * 7 days`), and the axis keeps four of them (`axisLabels`). Dates are UTC and
written by hand as `1 Feb 2027` by the shared `formatUtcDate` (`activity/format.ts`), since some ICU
builds write `Sept`.

**Voice is never shown as zeros.** The relations voice table is replaced by
`Voice stats unlock on 1 Feb 2027.` from `GET /api/activity/user/voice-status` until voice is
ready; with no voice logged at all the line has no date.

## Data tab

Nothing on this tab starts on its own. Every action is a button an admin presses. The private
preview sits last, in its own window, so it is never mistaken for the real run.

### Backfill

A window with the backfill's line and a `backfill` button, which opens `BackfillModal` (the
`Modal` primitive, `sh: ~/activity/backfill`). The modal shows the state line, a stepped progress
bar of channels done (`ProgressBar`, 5% steps, `steppedPercent`), messages read, elapsed time
(`not known since the bot restarted` when the process lost it), the channel being read
(`current`), whether reactions are included, and channel errors. The `include reactions` chip is
the body of `POST /api/activity/backfill` (`{ reactions }`) and follows a live run's setting. The
main button is `start`, `resume` (stopped) or `run again` (done or failed) (`backfillAction`);
`stop` (`POST .../backfill/stop`) shows while a run is live; `close` always. After a run, the
modal keeps showing the last result, labelled as such.

### Wrapped

Four windows:

1. **Overview** (`fish: ~/wrapped`): the run's year and line, opted-in count, started and
   finished days, and once done the sent, failed, not-opted-in counts and the announcement day.
   An interrupted run shows `resume` (`POST .../wrapped/run/resume`). The server-wide link (`GET
   .../wrapped/server-link?year=`) is fetched only once the run is processed, sending, done or
   announced, because that route builds a snapshot when none exists; it shows the URL, `copy
   link` and `open`.
2. **1 process** (`POST .../wrapped/run`, `{ year }`): a year field (four digits, 2015 to 2100),
   a progress bar while processing, and once processed the line that a DM has gone to whoever
   started it.
3. **2 send dms** (`POST .../wrapped/send`, `{ announce }`): `DMs go to opted-in members only: n of
   N`, the `announce when the dms finish` chip (on by default), a bar of links settled, the counts,
   and the failed DMs (see below).
4. **3 post announcement** (`POST .../wrapped/announce`): whether and when it was posted. A 502
   says the post failed and can be retried; `no-channel`, `already-announced` and `not-processed`
   each have their own line.

Each step's button is enabled by a gate in `steps.ts` (`processGate`, `sendGate`, `announceGate`,
`resumeGate`); a disabled button has its reason in a subtle line under it, a sentence-case narrator
sentence with a full stop (`Resume the interrupted run first.`). The gates mirror the server: send
is allowed for `processed`, `done`, or `failed` after full processing; announce for `processed` or
`done`, once a year. Process is refused while a run is processing, sending or **interrupted**
(processing again would abandon the interrupted run, so the reason points at `resume`). A failed
run whose processing completed gets `The run failed. Send again, or process the year again.` on
the announce step.

**Confirms.** The two outward, server-wide steps ask first, through `useConfirm` (gold): `send
dms` (`sendConfirm(s, announce)`: "Send the 2026 DMs now to the 212 members who opted in and have
not been sent yet? ...", with whether the announcement follows; the count is `notYetSent(s)`, opted
in now minus this run's `sent`, worded "about N" once the run has sent some, because a member sent
their link who then opted out makes it a little low) and `post announcement` (`announceConfirm(s)`: "Post the server
Wrapped of 2026 in the announcements channel now? ..."). Both return null when the gate is shut, so
nothing can be confirmed for a disabled step. Every sign-up post asks the same way (it is public), a re-post with a word that a message is up already.
`process` asks only when the latest run is of the chosen year and has sent links
(`processConfirm(s, year)`: "Process 2026 again? Links already went out for it. The stories not
sent yet are rebuilt; the 12 stories already sent stay as they are."): the server keeps a sent
snapshot as it was.
A refused `send dms` reads through `sendRefusal`: the 409 `result` words, `your session ended`
(401), `you do not have access` (403), or the server's error (a 400). Buttons stay disabled
while their request is in flight.

**Failed DMs.** Once a send has run (`showFailedList`), the send window lists
`GET .../wrapped/failed?year=` (`WrappedFailedList`: failed DMs of members still opted in, by user
id, at most 200) through `FailedDmList`: one row per member (name through `UserName`) with `resend`
(`POST .../wrapped/resend/:userId?year=`) and `open link` (`GET .../wrapped/link/:userId?year=`,
opened in a new tab and kept on the row as `their link`). `failedListView` gives the rows, the
quiet line `And more: the list is capped at 200.` when `truncated`, and the narrator line `No failed
DMs. Everyone who opted in got theirs.` when empty. The list is fetched again when
`failedListKey(s)` changes (a send finishes, a new run starts, the failed count moves outside a
send) and after every resend.

`resend` exists only on these rows, and `showResend` hides it while the run is `sending`. The
server refuses a resend with a 409 and a `result` for a member who is not opted in
(`not-opted-in`), a link already sent (`already-sent`) and any resend while a send runs
(`sending`); `resendOutcome` reads the result (a 409 included) and `RESEND_WORDS` words each one
(the first two point at `/wrapped me`). A 401 reads `your session ended`, a 403 `you do not have
access`. Each row holds a busy lock (a ref, so two clicks in one frame send once), and after a
resend answered `sent` its `resend` stays disabled until the list answer changes.

Under the list, `MemberDmActions` keeps a member id field with `open link` only, for someone not on
the list; it never DMs anyone, and its line says a member who lost their link can use `/wrapped
me`.

### Sign-ups

`SignupsWindow` reads `GET .../wrapped/signup` and shows year, message (posted with or without
buttons, or not), open or closed, and opted-in count. `post sign-up message` sends `{ year,
buttons }` with the `with opt in / opt out buttons` chip (on by default) and always asks first
(`signupConfirm`): the first post too, since it is public; a re-post says the new message takes over. `close sign-ups` and `reopen sign-ups` swap with the state.

### Private preview

The last window of the data tab, `preview: ~/wrapped/private`, headed `private preview` with a `not
the real run` badge and the quiet line `A preview sends nothing to members. Every message comes to
you.` (rulings R-P1 to R-P7; the server side is "Private wrapped (preview)" in
[wrapped.md](wrapped.md)). It calls only `POST /api/activity/wrapped/preview`, `GET .../preview`
(through the shared poll) and `POST .../preview/discard`; never run, send, announce or resend.

- **Start form.** A year field (defaults to the real run's year until edited), a `members` field
  (`parseMemberList`: ids separated by spaces, commas or lines, a pasted `<@id>` or `<@!id>` reduced
  to the id, duplicates dropped, at most 10; the hint shows `n of 10`, or the default `you plus the
  3 most active members` when empty, and says a list replaces the sample), the `whole server (dry
  run counts)` chip (`all`), a line saying starting DMs you and replaces your previous preview, and
  `start preview` (`previewStartBody`; no confirm, nothing reaches members). The button is gated by
  `previewStartGate` (not while running, not with a bad list or year) and stays disabled while in
  flight. `startOutcome` words `started`, `already-running` and `invalid` (with the server's error),
  or the HTTP failure.
- **Status** (`StatusBlock`): `previewStatusLine` (`processing 2 of 4`, `built, the preview dms to
  you are next`, `sending the preview dms to you`, `done, sent to you`, `done, but your dms are
  closed`, `failed`, `interrupted, start a new preview to replace it`), a bar while processing, the
  DM failure in full (`DM_FAILED_LINE`: the DMs are closed, allow direct messages from server
  members, start a new preview, the links work anyway), the server's `error`, the would-skip line
  (`wouldSkipLine`, withheld until a member is built, never a made-up zero) and the sampled members
  who would not be sent (`skippedMembers`), the expiry (`Expires on 1 Feb 2027 (UTC).`, hidden when
  there is none) and `A preview and its links expire after 14 days.`
- **Links** (`LinksBlock`): the private server story (`/wrapped/s/<token>`) and one row per sampled
  member: name through `UserName`, a `would not be sent` chip, and `copy link` / `open link`
  (`LinkActions`, shared with the real server link) for `/wrapped/<token>` on the dashboard's
  origin (`previewLinkUrl`, `previewServerUrl`). A member without activity says so instead of a link.
- **Discard** (`DiscardRow`): `discard preview` behind a love `useConfirm` (`DISCARD_CONFIRM`: its
  links stop working at once), gated by `discardGate` (not while running, matching the server's
  409, and not with no preview), words from `discardOutcome`.

## Design notes

- Small text is never `pine` or `muted` (3.4:1). Quiet lines use `text-subtle`, including the
  disabled-step reasons and `thread in #parent`.
- No colour literals, no radius, no easing. The progress fill is the system's `.progress`, moved
  in steps; the only inline style is its width.
- Narrator lines are sentence case, second person where they speak to the admin. Labels, headings,
  buttons and chips are lowercase. No emoji. Narrator lines write `DMs`; lowercase labels write
  `dms` (`send dms`, `announce when the dms finish`).

## Check (NixOS)

```sh
nix develop -c bun test src/web/app/activity/admin
nix develop -c bun run typecheck
nix develop -c bun run build:web
```
