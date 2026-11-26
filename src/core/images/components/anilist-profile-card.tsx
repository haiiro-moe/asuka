import {
  CardFrame,
  Tag,
  ImageFrame,
  Rule,
  StillBackdrop,
  Text,
  Title,
  cleanText,
  ink,
  type Tone,
} from "./haiiro/index.ts";
import { profileTone, scoreTone } from "./anilist-theme.ts";
import { cellWidth, slugify } from "./anilist-media-card.tsx";

/** Width of the AniList profile card in px. */
export const ANILIST_PROFILE_WIDTH = 900;

/** Content width inside the frame: 900 - 2x32 backdrop - 2x5 frame - 2x20 padding. */
const CONTENT_W = 786;
/** Width of each of the two stat columns (24px gap between them). */
const STAT_COL_W = (CONTENT_W - 24) / 2;
/** Header (avatar 96), rule 1, stats 94, genre row 20, three 12px gaps, plus the chrome. */
const BODY_H = 96 + 1 + 94 + 20 + 3 * 12;

/**
 * Height in px of the AniList profile card: backdrop 64, frame 10, padding 40 and the
 * fixed body. The genre row keeps its height when empty, so this never varies.
 */
export const ANILIST_PROFILE_HEIGHT = 64 + 10 + 40 + BODY_H;

/**
 * Props for {@link AniListProfileCard}: one AniList user's statistics, already fetched.
 * The user name and genres are drawn as given (not lowercased).
 */
export interface AniListProfileCardProps {
  /** AniList user name. */
  username: string;
  /** Avatar as a PNG/JPEG data URI, or null for the placeholder. Drawn in full colour. */
  avatarDataUri: string | null;
  /** Banner as a data URI. Not drawn: the haiiro card has no banner. Kept for the call site. */
  bannerDataUri: string | null;
  /**
   * The user's profile colour (a name or `#hex`). Named colours pick the nearest haiiro
   * token for the name; custom hex values are off-palette and fall back to foam.
   */
  profileColor: string | null;
  /** Anime titles on the user's lists. */
  animeCount: number;
  /** Days of anime watched (may be fractional). */
  daysWatched: number;
  /** Anime mean score, 0-100; 0 means none. */
  animeMeanScore: number;
  /** Manga titles on the user's lists. */
  mangaCount: number;
  /** Manga chapters read. */
  chaptersRead: number;
  /** Manga mean score, 0-100; 0 means none. */
  mangaMeanScore: number;
  /** Top genres, most watched first; as many as fit one row are shown. */
  topGenres: string[];
}

/**
 * Format a count for a tile: thousands separators, or `123k` / `1.2m` once it would not fit
 * six cells of 32px text.
 */
function tileCount(n: number): string {
  const full = Math.round(n).toLocaleString("en-US");
  if (full.length <= 6) return full;
  if (n < 1_000_000) return `${Math.round(n / 1000)}k`;
  return `${(n / 1_000_000).toFixed(1)}m`;
}

/** One decimal with thousands separators (`1,234.5`). */
function tileDecimal(n: number): string {
  return n.toLocaleString("en-US", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
}

/** One stat tile: a 32px value over a muted label, in a hairline box. */
function Tile(props: { label: string; value: string; tone: Tone }) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        flexGrow: 1,
        flexShrink: 1,
        flexBasis: 0,
        minWidth: 0,
        padding: 6,
        border: `1px solid ${ink.hairline}`,
      }}
    >
      <Text size="large" tone={props.tone}>
        {props.value}
      </Text>
      <Text tone="muted" upper>
        {props.label}
      </Text>
    </div>
  );
}

/** A mean-score tile value: one decimal, or `n/a` when the user has no scores. */
function meanTile(label: string, mean: number) {
  return mean > 0 ? (
    <Tile label={label} value={mean.toFixed(1)} tone={scoreTone(mean)} />
  ) : (
    <Tile label={label} value="n/a" tone="subtle" />
  );
}

/** Tag width: text, 7px padding each side and the border. */
function chipPx(text: string): number {
  return cellWidth(text) * 8 + 16;
}

/**
 * AniList profile card in haiiro: a labelled window (`anilist: ~/user/<name>`) with a
 * full-colour avatar in a hairline frame, the user name as the title (in the profile
 * colour's nearest token), and two columns of stat tiles, anime (titles, days watched,
 * mean score) and manga (titles, chapters read, mean score), then the top genres as chips.
 * Render at {@link ANILIST_PROFILE_WIDTH} by {@link ANILIST_PROFILE_HEIGHT}.
 *
 * @param props - {@link AniListProfileCardProps}
 */
export function AniListProfileCard(props: AniListProfileCardProps) {
  const name = cleanText(props.username) || "unknown";
  const tone = profileTone(props.profileColor);

  const labelPx = 10 * 8 + 12;
  let used = labelPx;
  const genres: string[] = [];
  for (const g of props.topGenres.map((x) => cleanText(x)).filter(Boolean)) {
    const next = used + chipPx(g) + (genres.length > 0 ? 8 : 0);
    if (next > CONTENT_W) break;
    genres.push(g);
    used = next;
  }

  return (
    <StillBackdrop width={ANILIST_PROFILE_WIDTH} height={ANILIST_PROFILE_HEIGHT} seed={17}>
      <CardFrame label={`anilist: ~/user/${slugify(props.username, "user")}`}>
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <ImageFrame src={props.avatarDataUri} size={96} initial={name} />
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 4,
              flexGrow: 1,
              flexShrink: 1,
              flexBasis: 0,
              minWidth: 0,
            }}
          >
            <div style={{ display: "flex", width: CONTENT_W - 96 - 16, overflow: "hidden" }}>
              <Title truncate tone={tone}>
                {name}
              </Title>
            </div>
            <Text tone="subtle">{`anilist.co/user/${name}`}</Text>
          </div>
        </div>
        <Rule gap={0} />
        <div style={{ display: "flex", gap: 24 }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 8, width: STAT_COL_W }}>
            <Text tone="iris" upper>
              anime
            </Text>
            <div style={{ display: "flex", gap: 8 }}>
              <Tile label="titles" value={tileCount(props.animeCount)} tone="foam" />
              <Tile label="days" value={tileDecimal(props.daysWatched)} tone="foam" />
              {meanTile("mean", props.animeMeanScore)}
            </div>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8, width: STAT_COL_W }}>
            <Text tone="iris" upper>
              manga
            </Text>
            <div style={{ display: "flex", gap: 8 }}>
              <Tile label="titles" value={tileCount(props.mangaCount)} tone="foam" />
              <Tile label="chapters" value={tileCount(props.chaptersRead)} tone="foam" />
              {meanTile("mean", props.mangaMeanScore)}
            </div>
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", height: 20, gap: 8 }}>
          {genres.length > 0 ? (
            [
              <Text key="label" tone="muted" upper style={{ width: labelPx - 12, marginRight: 4 }}>
                top genres
              </Text>,
              ...genres.map((g) => <Tag key={g}>{g}</Tag>),
            ]
          ) : (
            <Text tone="rose">no genres on file yet. the list is still quiet.</Text>
          )}
        </div>
      </CardFrame>
    </StillBackdrop>
  );
}
