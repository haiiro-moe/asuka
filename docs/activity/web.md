# Activity web shell

The dashboard side of the activity analytics. This page covers the shell only: the page registry, the
chart wrappers, the data hook and the config controls. The tier pages live in their own directories.

## Layout

```
src/web/app/activity/
  index.tsx       ACTIVITY_PAGES, the Page type, re-exports of charts, scale and the hook
  charts.tsx      ActivityHeatmap, ActivityColumns, ActivityTiles, ActivityRank
  scale.ts        scaleToPercent, heatLevel (pure, unit-tested)
  useActivity.ts  useActivity<T>(path)
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

The ids and roles are fixed; `App.tsx` has a narrator lede for each. The Wrapped story is not a dashboard
page: it is the standalone routes `/wrapped/:token` and `/wrapped/s/:token` (see [web-wrapped.md](web-wrapped.md)), so it has no entry here.

## Chart wrappers

They take plain numbers and render the bundle's classes. No colour is written inline; the only inline
styles are data-driven sizes (a column height or bar width in percent, a grid width when a heatmap does
not have 24 buckets). Nothing is eased.

| Component | Props | Markup |
|---|---|---|
| `ActivityHeatmap` | `rowLabels`, `cells[row][bucket]`, `max` | `fx-heat` plus `fx-legend`, steps `h1` to `h4` |
| `ActivityColumns` | `values`, `axis?`, `tone?` (`foam`, `iris`), `nowIndex?` | `fx-cols`, `fx-axis` |
| `ActivityTiles` | `tiles[{ label, value, unit?, note?, off? }]` | `fx-grid fx-tiles` |
| `ActivityRank` | `rows[{ label, value, sub? }]`, `max?` | `fx-rank`, top three gold, iris, foam |

Charts bucketed by UTC should say so in the window heading's as-of line.

## scale.ts

- `scaleToPercent(values)`: 0 to 100 relative to the largest value; all zeros stay zeros.
- `heatLevel(value, max)`: `0` for zero or an empty map, otherwise `1` to `4` (any positive value is at
  least `1`).

Run the tests with `nix develop -c bun test src/web/app/activity`.

## useActivity

`useActivity<T>(path)` fetches a JSON route and returns `{ data, error, loading, reload }`. A 401 gives
`error === "unauthorized"`; other failures use the server's `error` field or the status text. Changing
`path` fetches again.

## Config page

The settings tab has an `activity` group with `activityExcludedChannelIds` (a comma-separated list of
channel ids) and an `activityEnabled` toggle. Both are in the server's editable config set.

## Notes

`src/web/app/tsconfig.json` excludes `*.test.ts`, because the web build has no `bun:test` types; bun runs
those tests directly.
