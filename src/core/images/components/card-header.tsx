import { OutlinedText, sanitizeText } from "./outlined-text.tsx";
import { randomVibrant } from "../util.ts";

/**
 * Shared card header: circular avatar (or placeholder) next to the member's
 * name in a random vibrant color, with a small subtitle line underneath.
 */
export function CardHeader(props: {
  displayName: string;
  avatarDataUri: string | null;
  subtitle: string;
}) {
  const name = sanitizeText(props.displayName) || "?";
  const avatarStyle = {
    width: 128,
    height: 128,
    borderRadius: 64,
    border: "5px solid #000",
  } as const;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 24 }}>
      {props.avatarDataUri ? (
        <img src={props.avatarDataUri} style={avatarStyle} />
      ) : (
        <div
          style={{
            ...avatarStyle,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: "#fffbef",
            fontFamily: "Comic",
            fontWeight: 700,
            fontSize: 64,
            color: "#000",
          }}
        >
          {name[0]!.toUpperCase()}
        </div>
      )}
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        <OutlinedText size={name.length > 16 ? 44 : 56} color={randomVibrant()}>
          {name}
        </OutlinedText>
        <OutlinedText size={26} color="#fff" stroke={4}>
          {props.subtitle}
        </OutlinedText>
      </div>
    </div>
  );
}
