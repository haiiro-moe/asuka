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
  useOpsStatus.ts      polls the run and the backfill (2 s while running, 30 s otherwise)
  ModerationTab.tsx  NewcomersTab.tsx  DriftTab.tsx  ChannelsTab.tsx
  EconomyTab.tsx  ClubsEventsTab.tsx  BotTab.tsx
  RelationsTab.tsx  InspectPanel.tsx
  DataTab.tsx          backfill window, Wrapped overview, steps, sign-ups
  BackfillModal.tsx
  WrappedOverview.tsx  ProcessStep.tsx  SendStep.tsx  AnnounceStep.tsx
  MemberDmActions.tsx  failed-DM list rows and the member id field
  useMemberDm.ts       resend and open link for one member
  SignupsWindow.tsx
  parts.tsx            ViewState, DataTable, Quiet, Sheet, ProgressBar, status inks
  http.ts              call(): a JSON request that never throws (409 and 502 bodies matter here)
  format.ts            dates, week labels, durations, channel labels, stepped percent, periods
  status.ts            status-strip text and the poll interval
  steps.ts             step gates, the outward-step confirms, the backfill button word, the year field
  failed.ts            failed-DM list view, when to show it, when to fetch it again
  fixtures.ts          test fixtures only
  *.test.ts            bun tests of format, status, steps and failed
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

`useOpsStatus(fast)` polls `GET /api/activity/wrapped/run` and `GET /api/activity/backfill`
together. The next poll waits `pollInterval(...)`: 2 seconds while either runs or `fast` is set (the
page sets it while the backfill modal is open), 30 seconds otherwise. A failed poll keeps the last
good status and shows the cause. The strip and the data tab share the one hook. The strip is not a
live region, because its counters change every 2 seconds.

## Tabs

Each tab passes `?period=` (default `30d`) to its route and renders loading, failed (with retry)
and empty as narrator lines through `ViewState`.

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
written by hand as `1 Feb 2027` (`formatUtcDay`), since some ICU builds write `Sept`.

**Voice is never shown as zeros.** The relations voice table is replaced by
`Voice stats unlock on 1 Feb 2027.` from `GET /api/activity/user/voice-status` until voice is
ready; with no voice logged at all the line has no date.

## Data tab

Nothing on this tab starts on its own. Every action is a button an admin presses.

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
dms` (`sendConfirm(s, announce)`: "Send the DMs now to the 212 members who opted in? ...", with
whether the announcement follows) and `post announcement` (`announceConfirm(s)`: "Post the server
Wrapped of 2026 in the announcements channel now? ..."). Both return null when the gate is shut, so
nothing can be confirmed for a disabled step. Re-posting the sign-up message asks the same way.
Buttons stay disabled while their request is in flight.

**Failed DMs.** Once a send has run (`showFailedList`), the send window lists
`GET .../wrapped/failed?year=` (`WrappedFailedList`: failed DMs of members still opted in, by user
id, at most 200) through `FailedDmList`: one row per member (name through `UserName`) with `resend`
(`POST .../wrapped/resend/:userId?year=`) and `open link` (`GET .../wrapped/link/:userId?year=`,
opened in a new tab and kept on the row as `their link`). `failedListView` gives the rows, the
quiet line `And more: the list is capped at 200.` when `truncated`, and the narrator line `No failed
DMs. Everyone who opted in got theirs.` when empty. The list is fetched again when
`failedListKey(s)` changes (a send finishes, a new run starts, the failed count moves outside a
send) and after every resend. Under it, `MemberDmActions` keeps a member id field with the same two
actions for someone not on the list, such as a member who never opted in and asked for their link
(a resend reaches them anyway, because an admin asked).

### Sign-ups

`SignupsWindow` reads `GET .../wrapped/signup` and shows year, message (posted with or without
buttons, or not), open or closed, and opted-in count. `post sign-up message` sends `{ year,
buttons }` with the `with opt in / opt out buttons` chip (on by default) and asks first when the
year already has a message. `close sign-ups` and `reopen sign-ups` swap with the state.

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
