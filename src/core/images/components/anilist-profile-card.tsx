import { sanitizeText } from "./outlined-text.tsx";
import { AL, profileAccent } from "./anilist-theme.ts";

export const ANILIST_PROFILE_WIDTH = 900;
export const ANILIST_PROFILE_HEIGHT = 470;

export interface AniListProfileCardProps {
  username: string;
  avatarDataUri: string | null;
  bannerDataUri: string | null;
  profileColor: string | null;
  animeCount: number;
  daysWatched: number;
  animeMeanScore: number;
  mangaCount: number;
  chaptersRead: number;
  mangaMeanScore: number;
  topGenres: string[];
}

function Stat({ value, label, accent }: { value: string; label: string; accent: string }) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        flex: 1,
      }}
    >
      <span style={{ fontFamily: "Roboto", fontWeight: 700, fontSize: 26, color: accent }}>
        {value}
      </span>
      <span
        style={{
          fontFamily: "Roboto",
          fontWeight: 500,
          fontSize: 14,
          color: AL.textLight,
          marginTop: 6,
        }}
      >
        {label}
      </span>
    </div>
  );
}

/** Stat block matching AniList's profile overview cards (dark theme). */
function StatsPanel({
  stats,
  accent,
}: {
  stats: { value: string; label: string }[];
  accent: string;
}) {
  return (
    <div
      style={{
        display: "flex",
        flex: 1,
        backgroundColor: AL.card,
        borderRadius: 4,
        padding: "22px 12px",
      }}
    >
      {stats.map((s) => (
        <Stat key={s.label} value={s.value} label={s.label} accent={accent} />
      ))}
    </div>
  );
}

/** /al profile card in the style of an anilist.co user page (dark theme). */
export function AniListProfileCard(props: AniListProfileCardProps) {
  const accent = profileAccent(props.profileColor);
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        width: ANILIST_PROFILE_WIDTH,
        height: ANILIST_PROFILE_HEIGHT,
        backgroundColor: AL.bg,
        borderRadius: 8,
        overflow: "hidden",
        fontFamily: "Roboto",
      }}
    >
      {/* Banner with the site's dark overlay */}
      <div style={{ display: "flex", position: "relative", width: "100%", height: 180 }}>
        {props.bannerDataUri ? (
          <img
            src={props.bannerDataUri}
            width={ANILIST_PROFILE_WIDTH}
            height={180}
            style={{ objectFit: "cover" }}
          />
        ) : (
          <div
            style={{
              display: "flex",
              width: "100%",
              height: "100%",
              backgroundImage: `linear-gradient(140deg, ${accent} 0%, ${AL.bg} 100%)`,
            }}
          />
        )}
        <div
          style={{
            display: "flex",
            position: "absolute",
            inset: 0,
            backgroundImage:
              "linear-gradient(180deg, rgba(11,22,34,0.25) 40%, rgba(11,22,34,0.75) 100%)",
          }}
        />
        {/* Avatar + username pinned to the banner's bottom edge, like the site */}
        <div
          style={{
            display: "flex",
            position: "absolute",
            left: 32,
            bottom: 0,
            alignItems: "flex-end",
          }}
        >
          {props.avatarDataUri && (
            <img
              src={props.avatarDataUri}
              width={110}
              height={110}
              style={{ borderRadius: 4 }}
            />
          )}
          <span
            style={{
              fontFamily: "Roboto",
              fontWeight: 700,
              fontSize: 32,
              color: AL.heading,
              marginLeft: 24,
              marginBottom: 14,
            }}
          >
            {sanitizeText(props.username)}
          </span>
        </div>
      </div>

      {/* Sub-banner nav strip look */}
      <div style={{ display: "flex", width: "100%", height: 14, backgroundColor: AL.card }} />

      <div
        style={{
          display: "flex",
          flexDirection: "column",
          padding: "24px 32px",
          gap: 16,
        }}
      >
        <div style={{ display: "flex", gap: 20 }}>
          <StatsPanel
            accent={accent}
            stats={[
              { value: String(props.animeCount), label: "Total Anime" },
              { value: props.daysWatched.toFixed(1), label: "Days Watched" },
              {
                value: props.animeMeanScore ? props.animeMeanScore.toFixed(1) : "—",
                label: "Mean Score",
              },
            ]}
          />
          <StatsPanel
            accent={accent}
            stats={[
              { value: String(props.mangaCount), label: "Total Manga" },
              { value: String(props.chaptersRead), label: "Chapters Read" },
              {
                value: props.mangaMeanScore ? props.mangaMeanScore.toFixed(1) : "—",
                label: "Mean Score",
              },
            ]}
          />
        </div>

        {props.topGenres.length > 0 && (
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{ fontSize: 14, fontWeight: 500, color: AL.textLight }}>
              Top Genres
            </span>
            {props.topGenres.map((g) => (
              <span
                key={g}
                style={{
                  display: "flex",
                  backgroundColor: AL.card,
                  color: accent,
                  fontSize: 13,
                  fontWeight: 700,
                  padding: "6px 14px",
                  borderRadius: 100,
                }}
              >
                {g}
              </span>
            ))}
          </div>
        )}

        <span style={{ fontSize: 13, color: AL.textLighter }}>anilist.co</span>
      </div>
    </div>
  );
}
