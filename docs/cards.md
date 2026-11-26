# Cards

The bot posts PNG cards (profile, leaderboard, elections, AniList, announcement banner). They are drawn
with **satori** (React tree to SVG) and **resvg** (SVG to PNG) in `src/core/images/`, in the haiiro look
(see [web-ui.md](web-ui.md); cards follow the same rules). Every renderer returns `null` on failure so the
call site falls back to its text-only Components V2 payload.

## Layout of the code

| Path | What |
|---|---|
| `src/core/images/render.tsx` | `renderPng` / `tryRenderPng`, font loading, resvg options. Crispness findings are in its header TSDoc. |
| `src/core/images/index.tsx` | One `render...Png` function per card, plus `fetchImageDataUri`. |
| `src/core/images/components/haiiro/` | The primitives (below). Raw colours may live only in `tokens.ts`. |
| `src/core/images/components/*.tsx` | The cards. |
| `src/core/images/fonts/` | Font files and licences. |

## Fonts and licences

satori cannot read WOFF2, so cards use the TTF/OTF files in `src/core/images/fonts/`:

| Face | File | Use | Licence |
|---|---|---|---|
| IBM VGA 8x16, 400 | `IBMVGA8x16-Regular.ttf` | all text | CC BY-SA 4.0 (VileR, int10h.org) |
| IBM VGA 8x16, 700 | `IBMVGA8x16-Bold.ttf` | the 2x face, used as bold | same |
| Jacquard 24 | `Jacquard24-Regular.ttf` | card and banner titles only | OFL 1.1 |
| GNU Unifont, Unifont Upper | `Unifont.otf`, `UnifontUpper.otf` | fallback glyphs on the same 8x16 grid (accents, arrows, CJK) | OFL 1.1 or GPL 2+ with font exception |

The licence texts sit beside the fonts. Fonts load lazily on the first render (about 2 s, mostly parsing
Unifont) and are then reused. satori tries the `fontFamily` list and then every registered font in
registration order, so Unifont is registered right after IBM VGA. The Unifont files are subset (about 1.6 MB; the full set is 11 MB): Latin, Greek, Cyrillic, symbols, kana, the kanji of JIS X 0208, the hanzi of GB 2312, the hangul of KS X 1001 and mathematical alphanumerics. Other glyphs (rare kanji) render as a missing-glyph box. Regenerate with `scripts/subset-fonts.sh <dir with the full Unifont.otf and UnifontUpper.otf>`; the full set is in `themes/haiiro-fonts/` of the haiiro workspace.

## Crispness rules

Bitmap type blurs when a glyph edge lands between pixels (measured with resvg 2.6, satori 0.26):

- IBM VGA and Unifont: **16px and 32px only**. 15, 18, 20, 24px and fractional letter spacing blur.
- Jacquard 24: **43px and 86px only** (its pixel is 1/21.5 em). 48px leaves a third of its edges grey.
- Line height 1.125, so a 16px line is 18px and a 32px line 36px.
- Render at **1x**. `renderPng` takes an integer `scale` only (fractions are rounded).
- resvg runs with `shapeRendering: crispEdges` (satori emits text as paths). It is a safety net for an
  off-grid size, not a licence to use one. Raster images use smooth `imageRendering`, since avatars and
  covers are full-colour content scaled down.
- No rotated text, no gradients, no shadows except the title's hard offset. Whole-number sizes.
- satori is flexbox only. In a row frame give the text column
  `flexGrow: 1, flexShrink: 1, flexBasis: 0, minWidth: 0` or it overflows. `lineClamp` does not clamp: cut
  text by character count (IBM VGA is 8px per cell, wide Unifont glyphs 2 cells) plus a fixed-height
  `overflow: hidden` box. Fragments drop `gap`; use an array.

## Primitives

From `components/haiiro/index.ts`. A card is `StillBackdrop` (root) > `CardFrame` (window with notch
label) > rows of the rest, with at most one `Title`. Colours are `Tone` names (`ColorName` plus `inkMuted`,
`inkHairline`), resolved by `toneColor`.

| Primitive | Purpose | Props |
|---|---|---|
| `StillBackdrop` | Root: one still dithered metaball background, deterministic per `seed` (SVG data URI) | `width`, `height`, `padding`, `seed`, `direction`, `gap` |
| `CardFrame` | The 5px double pine window with a notch label | `label`, `labelTone`, `frame` (pine/love/gold/foam/highlightHigh), `width`, `height`, `grow`, `direction`, `gap`, `padding` |
| `Notch` | The label cutting the frame | `children`, `tone`, `left` |
| `Text` | A text run | `tone`, `size` (body 16, large 32), `bold`, `upper`, `truncate` |
| `Rule` | Hairline divider | `gap` |
| `Title` | Jacquard 24 title with the hard base shadow | `size` (title 43, display 86), `tone`, `shadow`, `truncate` |
| `KeyValue` | `label value` stat line | `label`, `value`, `tone`, `labelTone`, `grow` |
| `ProgressBar` | Track plus fill | `value`, `max`, `width`, `height`, `tone` |
| `Chip` | Hairline-boxed word | `children`, `active` |
| `RankMark`, `rankTone` | Rank in gold, foam, iris, then muted; the current row gets a rose `»` | `rank`, `current`, `width` |
| `ImageFrame` | Full-colour image in a hairline frame | `src`, `size`, `height`, `initial` |
| `svgDataUri`, `stillBackdropDataUri`, `cleanText` | Helpers | |

`tokens.ts` exports `color`, `ink`, `font`, `fontSize`, `lineHeight`, `space`, `border`, `blob`,
`titleShadow`. `pine` and `muted` are about 3.4:1 on base: labels and large text only.

## ImageFrame and full-colour images

Avatars (Discord, AniList), AniList covers and character art, event images and store icon images are
**full colour**, never dithered: square crop (a cover may set a 2:3 `height`), a 1px `inkMuted` hairline,
no radius, no shadow. `size` is the outer box including the hairline. With `src={null}` it draws the
system's `.dith` checker with an optional `initial`. Fetch with `fetchImageDataUri`; resvg cannot decode
webp, so request `extension: "png"` for Discord avatars. AniList's per-cover colour is off palette and unused.

## Card inventory

| Card | Renderer | Notch label | Size |
|---|---|---|---|
| Announcement banner | `renderTitleBannerPng` | none (prompt line `@ asuka » announce`) | 900x160 |
| Profile | `renderProfileCardPng` | `profile: ~/<name>` | 640 wide, `profileCardHeight` |
| Leaderboard | `renderLeaderboardCardPng` | `top: ~/leaderboard` | 640 wide, `leaderboardCardHeight` |
| Election profile | `renderElectionProfileCardPng` | `election: ~/candidates` | 640 x `ELECTION_PROFILE_HEIGHT` |
| Election results | `renderElectionResultsPng` | `results: ~/election` | 640 wide, `electionResultsCardHeight` |
| Winner | `renderWinnerCardPng` | `winner: ~/president` | 640 x `WINNER_CARD_HEIGHT` |
| AniList media | `renderAniListMediaPng` | `anilist: ~/media/<slug>` | 900 wide, `anilistMediaCardHeight` |
| AniList character | `renderAniListCharacterPng` | `anilist: ~/character/<slug>` | 900 x `ANILIST_CHARACTER_HEIGHT` |
| AniList profile | `renderAniListProfilePng` | `anilist: ~/user/<slug>` | 900 x `ANILIST_PROFILE_HEIGHT` |

Names in notch labels are lowercased, dashed and clipped to 24 characters. Long names end in an ellipsis.
A sabotaged election card gets a love frame and a boxed `SABOTAGED` stamp. AniList score tones (`anilist-theme.ts`):
75+ foam, 50-74 gold, below 50 love. Dates print as `4 Nov 2026`. Titles are drawn lowercase.

## Add a card

1. Create `src/core/images/components/my-card.tsx` exporting the props type, `MY_CARD_WIDTH`, a height
   constant or `myCardHeight(props)`, and `MyCard`.
2. Build from the primitives: `StillBackdrop` > `CardFrame label="area: ~/thing"` > rows. Colours as `Tone`
   names, sizes from `fontSize`. Compute wrapping and truncation in code so heights are exact.
3. Add `renderMyCardPng(props)` to `index.tsx` calling `tryRenderPng(<MyCard {...props} />, { width, height })`
   and export the props type.
4. Call it from the plugin with a text-only fallback for `null`. Attach with `pngAttachment` and
   `attachmentImage` (`src/core/components.ts`). On a message edit that swaps an image, pass
   `attachments: []` or the old upload lingers.
5. TSDoc on every export. No hex, rgb, gradients, shadows or emoji in the card file.

## Smoke-render a card

There are no unit tests, so render to a file and look at it. From the repo root:

```tsx
// scratch/smoke.tsx
import { renderProfileCardPng } from "../src/core/images/index.tsx";
const png = await renderProfileCardPng({ /* props */ } as never);
await Bun.write("/tmp/profile.png", png!);
```

```sh
nix develop -c bun scratch/smoke.tsx
```

Try awkward input too: a very long name, CJK and accents, no avatar, no clubs, zero rows, 25 rows. View the
PNG at 100% and look for clipped text, overflow and grey glyph edges. The native `@resvg/resvg-js` module
loads under the Nix `bun` without extra setup.
