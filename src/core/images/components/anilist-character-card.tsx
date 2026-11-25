import { sanitizeText } from "./outlined-text.tsx";
import { AL } from "./anilist-theme.ts";

export const ANILIST_CHARACTER_WIDTH = 900;
export const ANILIST_CHARACTER_HEIGHT = 340;

export interface AniListCharacterCardProps {
  name: string;
  nativeName: string | null;
  imageDataUri: string | null;
  favourites: number | null;
  description: string;
  appearsIn: string[];
}

/** Character search result card in the anilist.co dark style. */
export function AniListCharacterCard(props: AniListCharacterCardProps) {
  return (
    <div
      style={{
        display: "flex",
        width: ANILIST_CHARACTER_WIDTH,
        height: ANILIST_CHARACTER_HEIGHT,
        backgroundColor: AL.bg,
        borderRadius: 8,
        overflow: "hidden",
        fontFamily: "Roboto",
        padding: 28,
      }}
    >
      {props.imageDataUri ? (
        <img
          src={props.imageDataUri}
          width={190}
          height={ANILIST_CHARACTER_HEIGHT - 56}
          style={{ borderRadius: 3, objectFit: "cover" }}
        />
      ) : (
        <div
          style={{
            display: "flex",
            width: 190,
            height: ANILIST_CHARACTER_HEIGHT - 56,
            borderRadius: 3,
            backgroundColor: AL.card,
          }}
        />
      )}

      <div
        style={{
          display: "flex",
          flexDirection: "column",
          flex: 1,
          paddingLeft: 28,
        }}
      >
        <span style={{ fontFamily: "Roboto", fontWeight: 700, fontSize: 28, color: AL.heading }}>
          {sanitizeText(props.name)}
        </span>
        {props.nativeName && sanitizeText(props.nativeName) && (
          <span style={{ fontSize: 15, color: AL.textLight, marginTop: 4 }}>
            {sanitizeText(props.nativeName)}
          </span>
        )}

        <div style={{ display: "flex", marginTop: 14, alignItems: "center", gap: 24 }}>
          {props.favourites != null && (
            <div style={{ display: "flex", flexDirection: "column" }}>
              <span style={{ fontWeight: 700, fontSize: 20, color: AL.red }}>
                {props.favourites.toLocaleString("en-US")}
              </span>
              <span style={{ fontSize: 12, fontWeight: 500, color: AL.textLight, marginTop: 2 }}>
                Favorites
              </span>
            </div>
          )}
          {props.appearsIn.length > 0 && (
            <div style={{ display: "flex", flexDirection: "column", flex: 1 }}>
              <span style={{ fontWeight: 500, fontSize: 14, color: AL.text }}>
                {sanitizeText(props.appearsIn.join("  ·  "))}
              </span>
              <span style={{ fontSize: 12, fontWeight: 500, color: AL.textLight, marginTop: 2 }}>
                Appears In
              </span>
            </div>
          )}
        </div>

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
      </div>
    </div>
  );
}
