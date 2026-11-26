# Activity analytics: the Wrapped story pages

The two public pages behind the Wrapped links: a member's own story at `/wrapped/<token>` and the
server's story at `/wrapped/s/<token>`. The data, links, runs and routes are in
[wrapped.md](wrapped.md); this page covers the web side only.

## Rules

- **Public, no session.** The pages send no cookie (`credentials: "omit"`); the token in the path is
  the authorisation. An unknown or truncated token gets the route's uniform 404, and the page shows
  one narrator line (`This link opens nothing. ...`), never a blank page. Any other failure shows a
  narrator line with a `retry` button.
- **Generic title.** Both pages set `document.title` to `wrapped · asuka`. The token and names never
  go into the title.
- **Always a phone column.** A tall Window (`fish: ~/wrapped/<year>`, `fish: ~/wrapped/server/<year>`)
  on the blob backdrop: the full viewport height below 721px, and from 721px up centred with a 9:19.5
  shape, at most 420px wide and at most 910px tall. It is never stretched wide.
- **haiiro only.** Bundle classes for everything that has a look (`window`, `progress_track`,
  `progress_fill`, `veil`, `stat-panel`, `kv`, `fx-cols`, `fx-axis`, `fx-rank`, `mirror`, `nar`, `cmd`,
  `kbd`, `disp`), Tailwind for layout only. Big readouts are Jacquard 24 at 86px (64px when longer than
  seven characters); names are IBM at 32px; narrator lines are sentence-case rose. Emoji appear only as
  data; a custom emoji is written `:name:` and no image is fetched, so the page talks to no other host.

## Code

```
src/web/app/activity/wrapped/
  story.ts               pure: StoryState, tick, go, veilFrame, segmentFill, keyAction,
                         personalSlides, serverSlides, label helpers (hourLabel, ordinal, emojiLabel,
                         emojiKeyLabel, readoutSize, formatNumber, capitalise)
  story.test.ts          bun test for all of the above
  slides.tsx             StoryShell, StoryFrame (the player), usePublicJson, StoryNotice,
                         PersonalSlideView, ServerSlideView
  WrappedStory.tsx       /wrapped/:token
  WrappedServerStory.tsx /wrapped/s/:token
```

`src/web/server.ts` serves the SPA shell for `/wrapped/s/:token` and `/wrapped/:token`;
`src/web/app/main.tsx` matches `/^\/wrapped\/s\/([^/]+)/` first (so `s` is never read as a member
token), then `/^\/wrapped\/([^/]+)/`.

## The player (`StoryFrame`)

From the top of the window down:

1. The header line `@ <name> » wrapped` (`@ server » wrapped` on the server story) and a `play` /
   `pause` button.
2. The progress bar: one `progress_track` per slide. Seen slides are full, later ones empty, the
   current one fills in sixths (`segmentFill`); the last slide's segment is full once reached.
3. The slide area. Two real `<button>`s cover it: the left 35% (`previous slide`) and the right 65%
   (`next slide`). The slide itself takes no pointer events.
4. A hint row (`tap left to go back, right to go on` with the keys), which on the last slide becomes
   `save image` (downloads the card PNG) and `copy link` (copies the page address).

| Input | Does |
|---|---|
| left 35% / left arrow | previous slide (clamped) |
| right 65% / right arrow | next slide (clamped) |
| Space | play or pause (not when a button or link has focus, so it keeps its own meaning) |

The key listener is on `window` and removed on unmount; it ignores keys with Ctrl, Alt or Meta and
keys typed into a field.

**Autoplay**: `tick` once a second (`STEP_MS`); after `STEPS_PER_SLIDE` (6) steps the story moves on.
It stops on the last slide and does nothing while paused. Moving by hand keeps the pause as it was.

**The veil**: on a slide change the bundle's `.veil` runs over three 100 ms frames (`veilFrame`):
frame 1 `.veil` (sparse), frame 2 `.veil.heavy` (dense; the slide swaps here), frame 3 `.veil`, then
nothing. Stepped with `requestAnimationFrame`, never eased.

**Reduced motion** (`prefers-reduced-motion: reduce`): no veil (the slide cuts), no autoplay, and the
play / pause button and the Space hint are not shown. Tapping and the arrow keys still work.

`save image` fetches the card route; when the card cannot be drawn the route answers JSON, and the page
says `The card would not draw. You try again later.` instead of saving it. The outro's image falls back
to a dither placeholder the same way.

## The personal story

`personalSlides(data)` in this order; intro and outro always, the rest only when they have something
true to show:

| Slide | Shown when | Shows |
|---|---|---|
| `intro` | always | the year, the member's name |
| `messages` | `messages > 0` | messages; level, busiest day and top channel in a stat panel (a thread as its name with `thread in #parent`) |
| `hour` | `busiestHour` not null | the UTC hour, 24 `fx-cols` with only that hour drawn, `fx-axis` |
| `emoji` | a top emoji | the top emoji, the top three as an `fx-rank` list |
| `voice` | `voiceHours` not null | hours in voice (skipped while voice is withheld; never a made-up zero) |
| `soulmate` | a soulmate or a most-replied-to member | the soulmate's name; without voice the line drops the shared calls |
| `club` | `data.club` | the club, members, messages and voice ranks |
| `president` | `data.presidency` | days in office, votes, messages in office, emoji in office, the mirror bars (the server per day over the year against during the terms) |
| `titles` | `titles.length > 0` | each title (`★ label`) with its detail |
| `outro` | always | the card image (`t/:token/card.png`), then `save image` and `copy link` |

## The server story

`serverSlides(data)`: the fixed nine, skipping `pair`, `club` or `president` when that part is null.

| Slide | Shows |
|---|---|
| `intro` | the year |
| `totals` | messages, speakers, voice hours (only when not null) |
| `emoji` | the top three, and how many custom emoji went unused |
| `channels` | the top five as rank bars; a thread as its name with `thread in #parent` |
| `rhythm` | the busiest UTC hour as columns, the busiest weekday |
| `pair` | the best pair (named only because both opted in), replies, voice hours when not null |
| `club` | the best club, its founder, members and messages |
| `president` | the president, days, terms, elections, candidates, the mirror bars |
| `outro` | the server card (`s/:token/card.png`), that the member's own envelope is in their DMs if they opted in, and `/wrapped me` |

## Check (NixOS)

```sh
nix develop -c bun test src/web/app/activity/wrapped
nix develop -c bun run typecheck
nix develop -c bun run build:web
```

`git add` new files first: the flake sees only tracked files.
