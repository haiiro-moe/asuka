# Web UI

The dashboard (`src/web/app/`) is built on the **haiiro** design system. This page is the working
contract: the design rules, how the shell and routes fit together, what primitives exist, and how to add
a page. For card images see [cards.md](cards.md), for Discord messages see [voice.md](voice.md).

## Design rules

- **One dark theme.** Rosé Pine. No light theme, no toggle. Colour is read from tokens
  (`--color-*`, `--ink-*`), never written as a hex or `rgb()` in a component. The only raw colours live in
  `haiiro.css` (the tokens) and in data the user typed (a club colour, a role colour), which is shown
  only as a swatch, a stripe or a bar. Names stay white.
- **Square and still.** No radius, no shadow, no blur, no gradient. No easing: every transition is `0s`,
  and `asuka.css` has a kill switch for anything that sneaks one in. Dither (Bayer 4x4) replaces fades and
  blur. Windows are the 5px double pine frame with a prompt-style label (`fish: ~/store`).
- **Fonts are self-hosted** from `src/web/app/fonts/`: IBM VGA 8x16 for everything (its 2x face is the
  bold), Jacquard 24 for page titles and a drop cap, Unifont and Unifont Upper behind both for the glyphs
  IBM lacks. Nothing is requested from Google Fonts or any other host. Licences sit next to the files
  (IBM VGA CC BY-SA 4.0, attribution in the `@font-face` comment of `haiiro.css`; Jacquard 24 and Unifont
  OFL 1.1).
- **Page titles** are Jacquard, white, with the hard `shadow-title`, drawn over the `Blobs` backdrop (a
  dithered metaball canvas ported from fishnet, see `ui/blobs.ts`).
- **Contrast.** `pine` and `muted` are about 3.4:1 on base: borders, bars and large text only, never 12-16px
  body text. Use `text`, `subtle` (5.5:1) or a bright hue for small text. Text on a coloured bar must be
  `surface` on a bright hue, never on pine.
- **Voice.** Lowercase labels, headings and buttons. A narrator voice for states ("nothing here yet.",
  "loading…"), no exclamation marks, no emoji (the system's glyphs `» @ ★ ✓ × ☼` only), dates like
  `4 Nov 2026` (`toLocaleDateString("en-GB", ...)`).
- **Images.** Avatars, AniList art, event images and store icons are user content: full colour, square
  crop, a 1px `ink-muted` hairline frame, no radius, no shadow. Use `ImageFrame`. Dither is only for the
  system's own decoration (blobs, the still card background, the placeholder for "no picture yet").
- **No one-offs.** If a screen needs a control the system lacks, ask for it to be added to the system, then
  build it. The asuka layer (`asuka.css`) holds only things the system does not cover yet (see below).

## Where the CSS comes from

The system is published as a private design-system artifact, and
mirrored locally in `themes/haiiro-design-system/` of the haiiro workspace (`project/tokens.json`,
`project/components/<Name>/README.md`, `project/components/bundle.css`). In this repo:

| File | What |
|---|---|
| `src/web/app/haiiro.css` | `@font-face`, every token from `tokens.json` as `:root` custom properties (unlayered), imports the two files below into `@layer components`. |
| `src/web/app/haiiro-bundle.css` | Copy of the system's `components/bundle.css`, verbatim except one comment line (the session-card comment names no product). Do not edit; re-copy it when the system changes and reword that comment again. It carries the NodeGraph block (`fx-graph`) at the end. |
| `src/web/app/asuka.css` | The asuka layer: no-transition kill switch, global foam focus ring, `h1.title`, `.li`/`.seg`/`.spin` as real `<a>`/`<button>`, `.blobs-host`, `.swatch`, `.stripe`, `.frame`, the month calendar `.mcal*`. Candidates to move into the system. |
| `src/web/app/styles.css` | Entry file: Tailwind plus a `@theme inline` that maps tokens back (see next section). |
| `src/web/app/index.html` | Links `styles.css` only. |

The tokens are unlayered on purpose: they beat Tailwind's theme layer. The bundle and asuka layer sit in
`@layer components`, so a Tailwind layout utility can still adjust a haiiro element.

## How the Tailwind reset works

Tailwind stays for **layout utilities only** (`flex`, `grid`, `gap-3`, `px-2`, `min-w-0`, `hidden`,
`desk:block`). `styles.css` clears Tailwind's default theme (`--color-*`, `--font-*`, `--text-*`,
`--radius-*`, every shadow, blur, ease and animation are `initial`), so no off-palette colour, radius,
shadow or easing is reachable from a class name. The haiiro tokens are mapped back under their own names:

- colours: `bg-base`, `bg-surface`, `text-text`, `text-foam`, `border-pine`, `text-ink-muted` ...
- fonts: `font-mono` (IBM stack), `font-display` (Jacquard)
- sizes: `text-badge` 11, `text-label` 12, `text-small` 13, `text-heading` 14, `text-body` 16,
  `text-value` 20, `text-nav` 32
- one breakpoint: `desk:` at 721px (phones below it)

Careful: `text-base` now means the **colour** `--color-base`, not a 16px size. Old classes such as `text-sm`,
`text-xs`, `text-ink-soft`, `border-black`, `comic-*` no longer exist; use the component or a size token.

## Shell and routing

`App.tsx` is the shell (the system's SiteShell): top bar (Jacquard brand, `@ asuka » cd ~/<page>`, role,
name, logout), a side nav Window `ls ~/asuka` grouped by role (community, president, admin) from 1000px up; between 721 and 999px and on phones the page strip (scrolls sideways, centres the current page) replaces it. The `Blobs` backdrop sits behind everything and a `PageHead` above the page. Page titles are 43px on phones, 129px from 721 to 1100px and 168px above, and break only between words. Windows use `h2` headings (`Heading` defaults to `h2`, use `h3` for nested ones) so the page goes h1 then h2. The standalone Wrapped story pages have no `PageHead`; `StoryShell` gives them a visually hidden, generic `h1` instead. Every page sets its own `document.title` (`<page> · asuka`).

Routes live in the hash:

- `#/<page id>` for a page in `PAGES`
- `#/member/:id` for a member's profile (`MemberProfilePage`)
- unknown ids, and pages above the visitor's role, fall back to the first page.

Real `<a>` links with the system's `a.li` markup, so back and forward work.

`PAGES` (exported from `pages.tsx`) is an array of:

```ts
{ id: string; label: string; el: ReactElement; minRole?: "president" | "admin" }
```

`id` is the route, `label` the lowercase nav name, `minRole` the lowest web role that sees the page. Roles
rank user < president < admin (`resolveWebRole` on the server, `hasRole(me, min)` in `me-context.ts`).
The shell renders the `PageHead` itself (prompt, title, narrator lede from the label), so **a page does not
render its own PageHead**; it returns Windows (a fragment), which sit directly in `.fx-main` and get its gap.

Standalone pages (`/club-announce/:token`, `/panel/:token`, and the Wrapped story pages `/wrapped/:token` and `/wrapped/s/:token`, see [activity/web-wrapped.md](activity/web-wrapped.md)) render in `StandaloneShell` from `main.tsx`
(bar, blobs and column, no nav). `PanelPage` and `ClubAnnouncePage` render their own `PageHead`.

## Primitives

All in `src/web/app/ui/`, imported from `ui/index.ts` (also re-exported by `../ui.ts`). The system's
component READMEs are the contract for look and behaviour.

| Component | Purpose | Key props |
|---|---|---|
| `PromptLine` | `user @ cmd args` line | `user`, `cmd`, `args`, `as` |
| `Window` | The double-frame container with a prompt label | `label`, `tone` (pine/gold/love/foam/off), `foot`, `as`, `contentClassName` |
| `Heading` | In-window heading | `first`, `as` |
| `PageHead` | Title (Jacquard) + lede + prompt | `title`, `lede`, `cmd`, `args`, `note` |
| `InkButton` | The button: ink-coloured, flat or on | `tone` (gold, love, muted, pine, foam, rose, iris, text, flat), `on`, `busy`, `busyLabel` |
| `InkLink` | Link with an ink tone (use it, not a bare `<a class="c3">`) | `tone`, anchor props |
| `Chip`, `Badge` | Toggle chip, static badge | `on`, `onToggle`, `ariaLabel` |
| `Swatch` | Colour from data as a swatch | `colour`, `label` |
| `ImageFrame` | Full-colour image in a hairline frame; `.dith` placeholder when no `src` | `src`, `alt`, `size` |
| `Blobs`, `StandaloneShell` | Backdrop canvas; shell for standalone pages | `where`, `children` |
| `Empty`, `Loading`, `ErrorLine`, `Saved` | Narrator state lines | `onRetry`, `onDismiss`, `retryLabel` |
| `StageList` | Multi-step progress (`✓ × …`) | `stages` (`label`, `state`, `error`), `onRetry` |
| `PromptField` (alias `Input`) | Prompt-style text input | `label`, `value`, `onChange`, `hint`, `error`, `promptWidth`, `trailing` |
| `TextArea` | Multi-line input with optional line numbers | `label`, `value`, `onChange`, `rows`, `maxLength`, `mono`, `showLines` |
| `SettingRow` | Label + description + control row | `label`, `description`, `inactive` |
| `Toggle` | `role="switch"` + `aria-checked` | `label`, `checked`, `onChange`, `onText`, `offText` |
| `Segmented`, `Tabs` | Choice of a few, wide tab bar | `options` or `items` (`value`, `label`), `value`, `onChange`, `ariaLabel` |
| `ColourField` | Typed hex + preset swatches | `value`, `onChange`, `allowEmpty`, `presets` (a list of token colours, `BAR_COLOUR_PRESETS` has no pine), `onValidityChange` |
| `DateTimeField` | Typed `YYYY-MM-DD HH:mm` (or date only) | `value: Date \| null`, `onChange`, `dateOnly`, `required`, `onValidityChange` |
| `Select` | Closed `.pick`, popup is `position: fixed` and flips; filter line from 13 options | `options` (`value`, `label`, `meta`), `value`, `onChange`, `filterFrom` |
| `Dialog` | Modal Window over a dither veil, focus trap, portals into `.fx` | `label`, `tone`, `wide`, `onClose`, `onSubmit`, `foot` |
| `ConfirmDialog`, `useConfirm` | Awaitable replacement for `window.confirm` | `message`, `confirmLabel`, `tone`; `await confirm({...})` |
| `Calendar` | Month grid, one bar per event per day, agenda list on phones | `month`, `events` (`id`, `title`, `colour`, `date`), `onSelect`, `onSelectDay`, `maxPerDay`; `CalendarEvent.allDay` hides the time; `barInk` picks readable bar text, pine and blurple bars get a side stripe instead |
| `useReducedMotion`, `useStepped` | Motion helpers (stepped, never eased) | |
| `startBlobs`, `blobTarget`, `blobTone`, `BAYER4`, `bayer`, `hexTone` | The fishnet blob and dither port behind `Blobs` | |
| `cx` | Class-name joiner | |

Date helpers: `formatDateTimeInput`, `parseDateTimeInput`, `formatDay`, `formatMonth`, `dayKey`,
`timeZoneName`. Older helpers `card`, `btn`, `btnGhost`, `input` in `ui.ts` are `@deprecated` shims; do not
use them in new code. `Modal.tsx` keeps its old props and renders `Dialog`.

Activity charts (`src/web/app/activity/charts.tsx`, see [docs/activity/web.md](activity/web.md)): `ActivityHeatmap`, `ActivityColumns`, `ActivityTiles`, `ActivityRank`. They wrap `fx-heat`, `fx-cols`, `fx-tiles` and `fx-rank`; pages use them instead of writing chart markup. The heatmap and the columns are `role="img"` and take a required, specific `ariaLabel` (built with `heatmapAriaLabel` / `columnsAriaLabel` from `activity/format.ts`) and an optional visually hidden `summary`.

Relations graph (`src/web/app/activity/admin/graph/`, admin only, see [docs/activity/web-admin.md](activity/web-admin.md#relations-graph)): `NodeGraph` wraps the system's `fx-graph` (button nodes, edges, side panel, legend); `layoutGraph` gives it deterministic 4px-grid positions. It names members, so never use it on a president or user page.

Editors: `CodeEditor.tsx` (CodeMirror themed with tokens), `DiscordMarkdown.tsx` (the Discord-layout
preview, drawn in tokens; a per-message accent colour from data stays dynamic), `ComponentsEditor.tsx`
(block editor, props `value`, `onChange`, optional `layout`), `BotMessagesTab.tsx`.

## How to add a page

1. Create `src/web/app/MyPage.tsx` exporting a component that returns Windows (no `PageHead`).
2. Fetch with `useAsync` (`ui.ts`) and `api.ts`; render `Loading`, `ErrorLine` (with retry) and `Empty`
   for the three states.
3. Build from the primitives. Layout with Tailwind utilities only. If you need a control that does not
   exist, stop and ask for it in the system.
4. Add `{ id, label, el: <MyPage />, minRole? }` to `PAGES` in `pages.tsx`. Labels are lowercase. Add a
   narrator lede for the id to `LEDES` in `App.tsx` (second person, present tense).
5. Add the server route in `src/web/` with the right `access` (`admin`, `president`, `user`, `public`);
   gating only in the UI is not security.
6. Document it: TSDoc on every exported component and helper.

## Run and check (NixOS)

Toolchains come from the flake; nothing is installed globally.

```sh
nix develop -c bun install --frozen-lockfile
nix develop -c bun run dev          # bot + dashboard on WEB_PORT, needs .env
nix develop -c bun run typecheck    # tsc for the server AND src/web/app (own tsconfig, DOM lib)
```

Flakes see only git-tracked files, so `git add` new files first.

The dashboard is served by `Bun.serve` with the HTML import, and the Tailwind plugin comes from
`bunfig.toml` (`[serve.static] plugins = ["bun-plugin-tailwind"]`). That is why a plain
`bun build src/web/app/index.html` is **not** a valid check: the CLI does not run the plugin, so it
warns `invalid @ rule: @theme/@tailwind` and ships raw Tailwind source. To check the real output, build
with the plugin: `bun run build:web [outdir]` (`scripts/build-web.ts`, output in the gitignored `out/web` by
default). It also fails when the built CSS or HTML points at any other host.

Run it as `nix develop -c bun run build:web`. A good build has no references to any external host
(only the Tailwind licence comment URL), IBM and Jacquard inlined as data URIs and Unifont emitted as
files. There are no automated tests; `typecheck` and this build are the gates.

## Gotchas

- Inside `.fx`, the bundle's `.fx a { color: inherit }` beats `a.c3`. Use `InkLink` or `InkButton`.
- `ImageFrame` with no image shows the system's `.dith` placeholder, not a blank box.
- On phones a `PromptField`'s prompt can overlap a long value if `promptWidth` is forced; pass it only
  at desk widths.
- Colours from data (club, role, event accent) never become text colour; show them as a swatch, stripe or
  bar. A pine bar fails with surface text.

## Defaults

`ACCENT_DEFAULT` (`ui.ts`, `0x31748f`, pine) is the default accent for new bot messages, auto-replies, store roles and
announcements; Discord blurple and old club pink are not used. `isKnownRole` guards the shell against an unknown role from
`/api/me` (it shows the login screen).
