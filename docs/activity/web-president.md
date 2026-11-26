# Activity web: president tier

The president's `connection` page of the activity section. It shows numbers only: it never renders a name, an id or a
list of people, because the routes it reads never send one (see [queries-president.md](queries-president.md)). The shell
and chart wrappers are in [web.md](web.md).

| File | Holds |
|---|---|
| `src/web/app/activity/president/pages.tsx` | `PRESIDENT_PAGES`: `{ id: "activity-president", label: "connection", minRole: "president" }` |
| `src/web/app/activity/president/ConnectionPage.tsx` | `ConnectionPage`, the page |
| `src/web/app/activity/president/render.ts` | Pure helpers that decide what to draw for a number, a `null` or a real 0 |
| `src/web/app/activity/president/render.test.ts` | Their tests (`nix develop -c bun test src/web/app/activity`) |

## What the page reads

All `GET`, `?period=week|term`, answered for `access: "president"`:

- `/api/activity/president/connection` for the four tiles,
- `/api/activity/president/weekly` for replies and voice hours per week,
- `/api/activity/president/groups` for the group sizes,
- `/api/activity/user/voice-status` (`{ ready, readyAt }`, access user) for the date voice unlocks.

`engagement` and `clubs` are not drawn on this page.

## What it draws

A single window `fish: ~/activity/connection` with a `president` badge, a `week | term` segmented control and:

- four tiles: **in groups** (members in a group of three or more, `of N` only when `total` is shown, note "pairs
  and loners are never shown"), **groups**, **bridges**, **gone quiet**;
- **replies per week** as columns, the latest week in gold;
- **voice hours per week** as columns (iris), or a narrator line while voice is withheld;
- **group sizes** as rank bars, one per listed group, plus an `other` row only when `other` is a number;
- a foot note: counts under 3 are hidden or merged, periods are fixed so numbers stay put for a day, all times UTC.

Loading, failure and empty states are narrator lines (`Loading`, `ErrorLine` with retry, `Empty`), never a spinner
graphic. A failed read says so in fixed words and never repeats the server's text.

## A null is never a zero

`render.ts` is the single place that turns a value into something to draw:

| Value | Drawn as |
|---|---|
| a number, including `0` | the number (`0` stays `0`) |
| `null` count | a dashed `off` tile: value `off`, note `hidden: too few to show` (in the term: `..., or too close to the week's`) |
| `null` series (`voiceHours`) | no chart; the narrator line `voice stats unlock on 1 Feb 2027.` from `voice-status` |
| `null` `other` | no `other` row, plus a note that the row is hidden |
| `null` `total` | the `in groups` tile without `of N` |

`groups` can be larger than the number of bars: the page shows the number as given and adds the line "some groups
are left out of this list on purpose". It never tries to work out the missing ones.

Dates are UTC (the shared `formatUtcDate` and `voiceLockedLine` in `activity/format.ts`, day month year, English
month names written out in the helper so they do not depend
on the runtime's locale data). The weekly buckets are fixed UTC weeks (Monday to Monday); the first and last can be
partial, and the page says so under each chart.

## Not checked

The page has not been opened in a browser. Typecheck, the web build and the helper tests pass; the look is built from
the shared primitives and chart wrappers only, with no inline colour.
