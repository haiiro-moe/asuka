# Activity page: user tier

The dashboard page `activity` (`#/activity`), for every signed-in member. It reads the everyone-tier
routes described in [queries-user.md](queries-user.md) and draws them with the chart wrappers from
[web.md](web.md). Code is in `src/web/app/activity/user/`.

## Layout

```
user/
  pages.tsx         USER_PAGES: [{ id: "activity", label: "activity", el: <ActivityPage /> }]
  ActivityPage.tsx  control window (tabs, period) and the selected tab
  RhythmTab.tsx     messages heatmap, busiest hour and day, by-hour columns, voice heatmap
  EmojiTab.tsx      most used, week by week (top 5), graveyard
  PlacesTab.tsx     text channels, voice channels
  AwardsTab.tsx     award lines, most reacted messages
  SharingTab.tsx    totals per kind, link domains
  parts.tsx         View (loading, failed, empty lines) and VoiceGate
  helpers.ts        pure helpers (unit-tested in helpers.test.ts)
```

The page returns Windows only; the shell draws the page head. The page is visible to every member, so
`USER_PAGES` sets no `minRole` (the `Page` type only knows `president` and `admin`, and leaving it out
means every member).

## Controls

- Tabs: `rhythm`, `emoji`, `places`, `awards`, `sharing` (the `Tabs` primitive).
- Period: `last 30 days | this term | last 365 days` (`Segmented`, words from `PERIOD_LABELS`), sent
  as `?period=` `30d`, `term`, `year`; the server reads `year` as the last 365 days. Every tab refetches when it changes.
  The emoji graveyard (all time) and `voice-status` take no period.

## Routes used

| Tab | Routes |
|---|---|
| rhythm | `rhythm`, and `voice-status` while `rhythm.voice` is `null` |
| emoji | `emoji`, `emoji-trend`, `emoji-graveyard` |
| places | `channels`, `voice-status`, then `voice` once ready |
| awards | `awards`, `reacted` |
| sharing | `sharing` |

All are `GET /api/activity/user/<route>`.

## States

Every fetch goes through `View`: a loading line while waiting, a love line with `retry` on failure
(a 401 says the session ended), and a rose narrator line when the answer is empty. There is no spinner
graphic. Each window fetches on its own, so one failure does not blank the page.

## Voice is withheld

Voice stays hidden until two whole months of voice data exist. The page never draws it as zeros:

- `rhythm.voice === null` shows the `VoiceGate` line instead of the voice heatmap.
- The `places` tab asks `voice-status` first and only requests `/voice` when `ready` is true.
- While locked, `VoiceGate` says `voice stats unlock on 1 Feb 2027.` (`voiceLockedLine` from the shared
  `activity/format.ts`, a UTC date from `readyAt`), or
  `voice stats unlock once two whole months of voice are recorded.` when no voice has been recorded.
- The `longest-voice` award is simply absent from `/awards` until then.

## Names and ids

- Members are named only in the awards lines and the most reacted table, through `UserName` (id until
  the name arrives).
- Threads are channels. `/channels` and `/voice` rows show the thread's own name and a muted
  `thread in #parent` line. A name the bot has not seen falls back to the channel id.
- Emoji keys are a unicode character (drawn as is) or `custom:<id>` (drawn `:name:`, or `custom <id>`
  when the name is unknown). The graveyard (`GraveyardEmoji`: `id`, `name`) is a plain table of
  `:name:` rows (`graveyardLabel`; `a custom emoji` when the name is unknown, never the id) with a
  subtle `never used`, no rank colour, position or 0, first 20 and then a count of the rest.
- The most reacted table (`NamedReactedRow`) shows `#channelName`, and for a thread a subtle
  `thread in #parentChannelName` line under it (`reactedChannel`); an unknown name reads `a channel`
  (`thread in a channel`), never `#<id>`.

## UTC

Every bucket is UTC. The control window and the heatmap windows say so in their footer. Heatmap rows run
`mon` to `sun`, columns are the hours 00 to 23. Voice cells are connected hours; voice channel bars are
hours with one decimal and the line under each channel gives the exact time.

## Tests

`helpers.test.ts` covers the period path and labels, durations, emoji, graveyard, reacted and
channel labels, sharing totals, heatmap sums and the award wording:

```sh
nix develop -c bun test src/web/app/activity
```

The page itself has no component tests; `nix develop -c bun run typecheck` and
`nix develop -c bun run build:web` are its gates.
