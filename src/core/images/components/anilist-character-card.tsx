import {
  CardFrame,
  ImageFrame,
  KeyValue,
  Rule,
  StillBackdrop,
  Text,
  Title,
  cleanText,
} from "./haiiro/index.ts";
import { cellWidth, cleanBlurb, slugify, wrapCells } from "./anilist-media-card.tsx";

/** Width of the AniList character card in px. */
export const ANILIST_CHARACTER_WIDTH = 900;

/** Art box in px (outer, hairline included): portrait. */
const ART_W = 190;
const ART_H = 270;
/** Content width inside the frame: 900 - 2x32 backdrop - 2x5 frame - 2x20 padding. */
const CONTENT_W = 786;
/** Width of the text column beside the art. */
const COL_W = CONTENT_W - ART_W - 20;
/** One 16px line and one 32px line, in px. */
const LINE = 18;
/** Synopsis lines. */
const DESC_LINES = 4;
/** Titles up to this many cells stay in Jacquard. */
const NAME_MAX_CELLS = 24;

/**
 * Height in px of the AniList character card: backdrop 64, frame 10, padding 40, the art
 * row, the rule with its gaps, and four synopsis lines. Fixed, so the renderer can use it.
 */
export const ANILIST_CHARACTER_HEIGHT = 64 + 10 + 40 + ART_H + 12 + 1 + 12 + DESC_LINES * LINE;

/**
 * Props for {@link AniListCharacterCard}: one AniList character, already fetched.
 * Text is AniList content and is drawn as given (not lowercased).
 */
export interface AniListCharacterCardProps {
  /** Full name. A long name drops from Jacquard to two lines of 32px text. */
  name: string;
  /** Native-script name (kanji, kana, hangul), or null. Drawn through the Unifont fallback. */
  nativeName: string | null;
  /** Portrait as a PNG/JPEG data URI, or null for the placeholder. Drawn in full colour. */
  imageDataUri: string | null;
  /** Favourites count, or null. */
  favourites: number | null;
  /** Description. Markup, spoiler tags and emoji are stripped and the text is cut cleanly at four lines. */
  description: string;
  /** Titles of the media the character appears in; the first four are listed. */
  appearsIn: string[];
}

/**
 * AniList character card in haiiro: a labelled window (`anilist: ~/character/<slug>`) with
 * the full-colour portrait in a hairline frame, the name (Jacquard, or two lines of 32px
 * text when long), the native name, favourites, the media the character appears in, and a
 * rose description. Render at {@link ANILIST_CHARACTER_WIDTH} by
 * {@link ANILIST_CHARACTER_HEIGHT}.
 *
 * @param props - {@link AniListCharacterCardProps}
 */
export function AniListCharacterCard(props: AniListCharacterCardProps) {
  const name = cleanText(props.name) || "unnamed";
  const native = props.nativeName ? cleanText(props.nativeName) : "";
  const longName = cellWidth(name) > NAME_MAX_CELLS;
  const nameLines = longName ? wrapCells(name, COL_W / 8, 2, 2) : [];
  const titles = props.appearsIn.map((t) => cleanText(t)).filter(Boolean);
  const maxTitles = longName ? 3 : 4;
  const shown = titles.slice(0, maxTitles);
  const extra = titles.length - shown.length;
  const desc = wrapCells(cleanBlurb(props.description), CONTENT_W / 8, DESC_LINES);
  const descLines = desc.length > 0 ? desc : ["you find no notes on this one."];

  return (
    <StillBackdrop width={ANILIST_CHARACTER_WIDTH} height={ANILIST_CHARACTER_HEIGHT} seed={13}>
      <CardFrame
        label={`anilist: ~/character/${slugify(props.name, "character")}`}
        height={ANILIST_CHARACTER_HEIGHT - 64}
      >
        <div style={{ display: "flex", gap: 20 }}>
          <ImageFrame src={props.imageDataUri} size={ART_W} height={ART_H} initial={name} />
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 8,
              flexGrow: 1,
              flexShrink: 1,
              flexBasis: 0,
              minWidth: 0,
            }}
          >
            {longName ? (
              <div style={{ display: "flex", flexDirection: "column" }}>
                {nameLines.map((l, i) => (
                  <Text key={i} size="large">
                    {l}
                  </Text>
                ))}
              </div>
            ) : (
              <div style={{ display: "flex", width: COL_W, overflow: "hidden" }}>
                <Title truncate>{name}</Title>
              </div>
            )}
            {native ? (
              <Text tone="subtle" truncate style={{ maxWidth: COL_W }}>
                {native}
              </Text>
            ) : null}
            {props.favourites != null ? (
              <KeyValue label="favourites" value={props.favourites.toLocaleString("en-US")} tone="gold" />
            ) : null}
            {shown.length > 0 ? (
              <div style={{ display: "flex", flexDirection: "column" }}>
                <Text tone="muted" upper>
                  appears in
                </Text>
                {shown.map((t, i) => (
                  <div key={i} style={{ display: "flex", width: COL_W, overflow: "hidden" }}>
                    <Text tone="iris" truncate>
                      {t}
                    </Text>
                  </div>
                ))}
                {extra > 0 ? <Text tone="subtle">{`+${extra} more`}</Text> : null}
              </div>
            ) : null}
          </div>
        </div>
        <Rule gap={0} />
        <div style={{ display: "flex", flexDirection: "column" }}>
          {descLines.map((l, i) => (
            <Text key={i} tone="rose">
              {l}
            </Text>
          ))}
        </div>
      </CardFrame>
    </StillBackdrop>
  );
}
