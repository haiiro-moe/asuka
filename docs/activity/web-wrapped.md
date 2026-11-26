# Activity analytics: the Wrapped story pages

The two public pages behind the Wrapped links: a member's own story at `/wrapped/<token>` and the
server's story at `/wrapped/s/<token>`. The data, links, runs and routes are in
[wrapped.md](wrapped.md); this page covers the web side only.

## Rules

- **Public, no session.** Every request the pages make (the story JSON, the outro's card image and
  `save image`) goes through `fetch` with `credentials: "omit"`, so no cookie is sent; the card image
  is shown from a blob URL, not a plain `<img src>`. The token in the path is the authorisation. An
  unknown or truncated token gets the route's uniform 404, and the page shows one narrator line
  (`This link opens nothing. ...`), never a blank page. Any other failure shows a narrator line with a
  `retry` button.
- **Generic title.** Both pages set `document.title` to `wrapped · asuka`. The token and names never
  go into the title, and neither does the preview marker.
- **Previews are marked.** Both public responses carry `preview: boolean`. It is true for an admin's
  private preview link (R-P5 in the plan's DECISIONS.md). Then the window label gets ` (preview)`
  (`storyLabel(year, preview, kind)`: `fish: ~/wrapped/2026 (preview)`,
  `fish: ~/wrapped/server/2026 (preview)`), and the intro slide adds the narrator line
  `A preview for the admin, not sent to anyone.` (`previewLine`) in small subtle text (subtle, not
  muted, which fails contrast at 12px). Everything else is the same: the same slides and navigation,
  and `save image` and `copy link` work as usual. The copied link is the preview link itself. A
  response without the field counts as not a preview.
- **Always a phone column.** A tall Window (`fish: ~/wrapped/<year>`, `fish: ~/wrapped/server/<year>`)
  on the blob backdrop: the full viewport height below 721px, and from 721px up centred with a 9:19.5
  shape, at most 420px wide and at most `min(100dvh - 48px, 910px)` tall. It is never stretched wide.
- **Nothing is ever out of reach.** The slide box scrolls vertically (`overflow-y: auto`,
  `overscroll-behavior: contain`, the thin foam scroll bar of haiiro windows). A slide is centred
  with `margin-block: auto`, so one taller than its box starts at its top and scrolls instead of being
  clipped. This holds at 320x568, on a landscape phone (568x320) and in a short desktop window.
- **haiiro only.** Bundle classes for everything that has a look (`window`, `progress_track`,
  `progress_fill`, `veil`, `stat-panel`, `kv`, `fx-cols`, `fx-axis`, `fx-rank`, `mirror`, `nar`, `cmd`,
  `kbd`, `disp`), Tailwind for layout only. Big readouts are Jacquard 24, sized
  `clamp(28px, 13dvh, 86px)` (`clamp(28px, 10dvh, 64px)` when longer than seven characters): 86px or
  64px on tall screens (64px and up from 641px of viewport height), smaller on short ones, never below
  28px. Names are IBM at 32px; narrator lines are sentence-case rose. Emoji appear only as data; a
  custom emoji is written `:name:` and no emoji image is fetched, so the page talks to no other host.
- **Short screens** (viewport height 640px or less): slide gaps go from 16px to 8px, the hour columns
  to 48px, the mirror bars to 24px a side, stat cells to 8px padding and rank rows to their text
  height. The titles slide always lists at most four titles (`titlesShown`) and then
  `and n more`.

## Code

```
src/web/app/activity/wrapped/
  story.ts               pure: StoryState, tick, go, veilFrame, segmentFill, keyAction, classifyTap,
                         storyLabel, previewLine,
                         personalSlides, serverSlides, titlesShown, label helpers (hourLabel, ordinal,
                         emojiLabel, emojiKeyLabel, readoutSize, formatNumber, capitalise)
  story.test.ts          bun test for all of the above
  slides.tsx             StoryShell, StoryFrame (the player), usePublicJson, StoryNotice,
                         PersonalSlideView, ServerSlideView
  slides.test.ts         server-side render checks: the scroll container, the prev / next buttons,
                         the preview label and intro line,
                         the capped titles list
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
3. The slide area: the scroll container (`data-slide-scroll`, focusable, a group named `slide n of N`)
   with the slide in it. A new slide starts scrolled to the top. Two real buttons, `previous slide`
   and `next slide` (labelled `back` and `next`), sit at its bottom corners, visually hidden until
   they get keyboard focus, so assistive tech and the keyboard have real controls for both zones.
4. A hint row (`tap left to go back, right to go on` with the keys), which on the last slide becomes
   `save image` (downloads the card PNG) and `copy link` (copies the page address). This row is
   outside the slide area, so nothing covers those buttons.

### Tap versus scroll

There is no overlay over the slide. The slide area listens to pointer events and decides on release
with `classifyTap(dx, dy, ms, x, width)`:

- a press that moved more than 10px (`TAP_MOVE_PX`), or lasted more than 300 ms (`TAP_MAX_MS`), is a
  scroll, drag or long press: `none`;
- otherwise a press that started in the left 35% (`PREV_ZONE`) of the area is `prev`, anywhere else
  (the 35% line included) `next`;
- a width that is not a positive number gives `none`.

Only the primary pointer counts (the left mouse button). A press that starts on a button or link, or
on the scroll bar, is ignored, and `pointercancel` (the browser taking over a touch to scroll) drops
the press.

| Input | Does |
|---|---|
| tap in the left 35% / left arrow / `previous slide` | previous slide (clamped) |
| tap anywhere else / right arrow / `next slide` | next slide (clamped) |
| drag, swipe, wheel | scrolls the slide |
| Space | play or pause (not when a button or link has focus, so it keeps its own meaning) |

The key listener is on `window` and removed on unmount; it ignores keys with Ctrl, Alt or Meta and
keys typed into a field.

**Autoplay**: `tick` once a second (`STEP_MS`); after `STEPS_PER_SLIDE` (6) steps the story moves on.
It stops on the last slide, does nothing while paused and holds while the tab is hidden. Moving by
hand keeps the pause as it was.

**The veil**: on a slide change the bundle's `.veil` runs over three 100 ms frames (`veilFrame`):
frame 1 `.veil` (sparse), frame 2 `.veil.heavy` (dense; the slide swaps here), frame 3 `.veil`, then
nothing. Stepped with `requestAnimationFrame`, never eased. The veil takes no pointer events.

**Reduced motion** (`prefers-reduced-motion: reduce`): no veil (the slide cuts), no autoplay, and the
play / pause button and the Space hint are not shown. Tapping, the buttons and the arrow keys still
work.

`save image` and the outro's image both fetch the card route. When the card cannot be drawn the route
answers JSON, not an image: `save image` then says `The card would not draw. You try again later.`
instead of saving, and the outro shows a dither placeholder (also shown while the card loads).

## The personal story

`personalSlides(data)` in this order; intro and outro always, the rest only when they have something
true to show:

| Slide | Shown when | Shows |
|---|---|---|
| `intro` | always | the year, the member's name; on a preview, the preview line |
| `messages` | `messages > 0` | messages; level, busiest day and top channel in a stat panel (a thread as its name with `thread in #parent`) |
| `hour` | `busiestHour` not null | the UTC hour, 24 `fx-cols` with only that hour drawn, `fx-axis` |
| `emoji` | a top emoji | the top emoji, the top three as an `fx-rank` list |
| `voice` | `voiceHours` not null | hours in voice (skipped while voice is withheld; never a made-up zero) |
| `soulmate` | a soulmate or a most-replied-to member | the soulmate's name; without voice the line drops the shared calls |
| `club` | `data.club` | the club, members, messages and voice ranks |
| `president` | `data.presidency` | days in office, votes, messages in office, emoji in office, the mirror bars (the server per day over the year against during the terms) |
| `titles` | `titles.length > 0` | the count, then up to four titles (`★ label` with its detail) and `and n more` |
| `outro` | always | the card image (`t/:token/card.png`), then `save image` and `copy link` |

## The server story

`serverSlides(data)`: the fixed nine, skipping `pair`, `club` or `president` when that part is null.

| Slide | Shows |
|---|---|
| `intro` | the year; on a preview, the preview line |
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
