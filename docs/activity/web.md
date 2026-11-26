# Activity web shell

The dashboard side of the activity analytics. This page covers the shell only: the page registry, the
chart wrappers, the data hook and the config controls. The tier pages live in their own directories.

## Layout

```
src/web/app/activity/
  index.tsx       ACTIVITY_PAGES, the Page type, re-exports of charts, scale, format and the hook
  charts.tsx      ActivityHeatmap, ActivityColumns, ActivityTiles, ActivityRank
  scale.ts        scaleToPercent, heatLevel (pure, unit-tested)
  useActivity.ts  useActivity<T>(path), failureText, viewOf (pure, unit-tested)
  format.ts       formatUtcDate, voiceLockedLine, MONTHS (pure, unit-tested; shared by every tier)
  user/pages.tsx  USER_PAGES
  president/pages.tsx  PRESIDENT_PAGES
  admin/pages.tsx      ADMIN_PAGES
```

## Page registry

`pages.tsx` spreads `ACTIVITY_PAGES` into `PAGES`. `ACTIVITY_PAGES` is `USER_PAGES`, `PRESIDENT_PAGES` and
`ADMIN_PAGES` in that order. Each tier file exports an array of `{ id, label, el, minRole? }`.

| id | role | owner directory |
|---|---|---|
| `activity` | user | `activity/user/` |
| `activity-president` | president | `activity/president/` |
| `activity-admin` | admin | `activity/admin/` |

The ids and roles are fixed; `App.tsx` has a narrator lede for each; the `activity` one is server-wide ("The whole server's hours and habits, counted. You see when everyone talks and where."), since the everyone tier shows the server, not the member. The Wrapped story is not a dashboard
page: it is the standalone routes `/wrapped/:token` and `/wrapped/s/:token` (see [web-wrapped.md](web-wrapped.md)), so it has no entry here.

## Chart wrappers

They take plain numbers and render the bundle's classes. No colour is written inline; the only inline
styles are data-driven sizes (a column height or bar width in percent, a grid width when a heatmap does
not have 24 buckets). Nothing is eased.

| Component | Props | Markup |
|---|---|---|
| `ActivityHeatmap` | `rowLabels`, `cells[row][bucket]`, `max`, `ariaLabel`, `summary?` | `fx-heat` plus `fx-legend`, steps `h1` to `h4` |
| `ActivityColumns` | `values`, `axis?`, `tone?` (`foam`, `iris`), `nowIndex?`, `ariaLabel`, `summary?` | `fx-cols`, `fx-axis` |
| `ActivityTiles` | `tiles[{ label, value, unit?, note?, off? }]` | `fx-grid fx-tiles` |
| `ActivityRank` | `rows[{ label, value, sub? }]`, `max?` | `fx-rank`, top three gold, iris, foam |

Charts bucketed by UTC should say so in the window heading's as-of line.

The heatmap and the columns are `role="img"`, so `ariaLabel` is **required**: a specific accessible
name per chart, never a generic one. Build it with the pure helpers in `format.ts`:
`heatmapAriaLabel(subject, rowLabels, cells)` (`messages by weekday and hour, utc; busiest tue
21:00`) and `columnsAriaLabel(subject, values, name, latest?)` (`replies per week, utc; highest week 3
of 12 at 40, latest 12`), with `hourName` and `weekName` to name a column. Labels name what is
counted and when, never a member or an id (president pages included). `summary` is an optional
longer reading, rendered visually hidden (`sr-only`) under the chart. `charts.test.ts` renders both
with `react-dom/server`.

## scale.ts

- `scaleToPercent(values)`: 0 to 100 relative to the largest value; all zeros stay zeros.
- `heatLevel(value, max)`: `0` for zero or an empty map, otherwise `1` to `4` (any positive value is at
  least `1`).

Run the tests with `nix develop -c bun test src/web/app/activity`.

## useActivity

`useActivity<T>(path)` fetches a JSON route and returns `{ data, error, loading, reload }`. A 401 gives
`error === "unauthorized"`; other failures use the server's `error` field, the status text, or
`http <status>` when the status text is empty (HTTP/2), so an error is never an empty string
(`failureText`). Changing `path` fetches again. The answer is kept together with its path, and
`viewOf` hands it out only for the current path: after a period or tab change the page sees
`loading` with no data, never the previous path's answer under the new label. A reload of the same
path keeps the data on screen. `View` (user) and `ViewState` (admin) test `error !== null`.

## format.ts

One UTC date for every tier: `formatUtcDate(seconds, withYear = true)` writes `1 Feb 2027` (or
`1 Feb`) with the fixed abbreviations `Jan Feb Mar Apr May Jun Jul Aug Sep Oct Nov Dec`, never
`Intl` (some ICU builds write `Sept`), and `""` for no date. `voiceLockedLine(readyAt)` is the
user and president line `voice stats unlock on 1 Feb 2027.` (or the dateless line). The admin
page keeps its own sentence-case `voiceUnlockLine` (different wording) on the same date helper.
Other duplicate helpers across the tiers (durations, emoji and channel labels, `VoiceStatus`,
`USER_ID`) are not folded yet.

## Config page

The settings tab has an `activity` group with `activityExcludedChannelIds` (a comma-separated list of
channel ids) and an `activityEnabled` toggle. Both are in the server's editable config set.

## Notes

`src/web/app/tsconfig.json` excludes `*.test.ts`, because the web build has no `bun:test` types; bun runs
those tests directly.
