import { sanitizeText } from "./outlined-text.tsx";
import { AL, scoreColor } from "./anilist-theme.ts";

export const ANILIST_MEDIA_WIDTH = 900;

export interface AniListMediaCardProps {
  title: string;
  metaLine: string;
  description: string;
  coverDataUri: string | null;
  bannerDataUri: string | null;
  /** AniList's per-cover accent color (coverImage.color), if any. */
  coverColor: string | null;
  averageScore: number | null;
  popularity: number | null;
  favourites: number | null;
  genres: string[];
  studio: string | null;
  nextEpisode: { episode: number; inDays: number } | null;
}

const BANNER_H = 150;
const COVER_W = 170;
const COVER_H = 240;

export function anilistMediaCardHeight(props: AniListMediaCardProps): number {
  return props.bannerDataUri ? 470 : 380;
}

function ScoreStat({ value, label, color }: { value: string; label: string; color: string }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", marginRight: 36 }}>
      <span style={{ fontFamily: "Roboto", fontWeight: 700, fontSize: 22, color }}>{value}</span>
      <span style={{ fontSize: 13, fontWeight: 500, color: AL.textLight, marginTop: 4 }}>
        {label}
      </span>
    </div>
  );
}

/** Anime/manga search result card in the style of an anilist.co media page. */
export function AniListMediaCard(props: AniListMediaCardProps) {
  const accent = props.coverColor ?? AL.blue;
  const height = anilistMediaCardHeight(props);
  const hasBanner = !!props.bannerDataUri;

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        width: ANILIST_MEDIA_WIDTH,
        height,
        backgroundColor: AL.bg,
        borderRadius: 8,
        overflow: "hidden",
        fontFamily: "Roboto",
      }}
    >
      {hasBanner && (
        <div style={{ display: "flex", position: "relative", width: "100%", height: BANNER_H }}>
          <img
            src={props.bannerDataUri!}
            width={ANILIST_MEDIA_WIDTH}
            height={BANNER_H}
            style={{ objectFit: "cover" }}
          />
          <div
            style={{
              display: "flex",
              position: "absolute",
              inset: 0,
              backgroundImage:
                "linear-gradient(180deg, rgba(11,22,34,0.3) 0%, rgba(11,22,34,0.85) 100%)",
            }}
          />
        </div>
      )}

      <div style={{ display: "flex", padding: "0 32px", flex: 1 }}>
        {/* Cover overlapping the banner, like the site header */}
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            width: COVER_W,
            marginTop: hasBanner ? -70 : 28,
          }}
        >
          {props.coverDataUri ? (
            <img
              src={props.coverDataUri}
              width={COVER_W}
              height={COVER_H}
              style={{ borderRadius: 3, objectFit: "cover" }}
            />
          ) : (
            <div
              style={{
                display: "flex",
                width: COVER_W,
                height: COVER_H,
                borderRadius: 3,
                backgroundColor: AL.card,
              }}
            />
          )}
        </div>

        <div
          style={{
            display: "flex",
            flexDirection: "column",
            flex: 1,
            paddingLeft: 30,
            paddingTop: 24,
          }}
        >
          <span
            style={{
              fontFamily: "Roboto",
              fontWeight: 500,
              fontSize: 28,
              color: AL.heading,
            }}
          >
            {sanitizeText(props.title)}
          </span>
          <span style={{ fontSize: 14, color: AL.textLight, marginTop: 8 }}>
            {props.metaLine}
          </span>

          <div style={{ display: "flex", marginTop: 18 }}>
            {props.averageScore != null && (
              <ScoreStat
                value={`${props.averageScore}%`}
                label="Average Score"
                color={scoreColor(props.averageScore)}
              />
            )}
            {props.popularity != null && (
              <ScoreStat
                value={props.popularity.toLocaleString("en-US")}
                label="Popularity"
                color={AL.text}
              />
            )}
            {props.favourites != null && (
              <ScoreStat
                value={props.favourites.toLocaleString("en-US")}
                label="Favorites"
                color={AL.red}
              />
            )}
            {props.studio && <ScoreStat value={props.studio} label="Studio" color={accent} />}
          </div>

          {props.genres.length > 0 && (
            <div style={{ display: "flex", marginTop: 16, gap: 8, flexWrap: "wrap" }}>
              {props.genres.slice(0, 5).map((g) => (
                <span
                  key={g}
                  style={{
                    display: "flex",
                    backgroundColor: AL.card,
                    color: accent,
                    fontSize: 12,
                    fontWeight: 700,
                    padding: "5px 12px",
                    borderRadius: 100,
                  }}
                >
                  {g}
                </span>
              ))}
            </div>
          )}

          {props.description && (
            <span
              style={{
                fontSize: 13,
                lineHeight: 1.55,
                color: AL.textLight,
                marginTop: 14,
              }}
            >
              {sanitizeText(props.description)}
            </span>
          )}

          {props.nextEpisode && (
            <span style={{ fontSize: 13, fontWeight: 500, color: accent, marginTop: 10 }}>
              {`Ep ${props.nextEpisode.episode} airing in ${props.nextEpisode.inDays} day${
                props.nextEpisode.inDays === 1 ? "" : "s"
              }`}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
