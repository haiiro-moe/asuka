import { ImageFrame } from "./haiiro/image-frame.tsx";
import { Text, cleanText } from "./haiiro/text.tsx";
import { Title } from "./haiiro/title.tsx";

/** Props for {@link CardHeader}. */
export interface CardHeaderProps {
  /** Member display name, shown as the card's Jacquard title. */
  displayName: string;
  /** Avatar as a PNG/JPEG data URI, or null for the dither placeholder with the initial. */
  avatarDataUri: string | null;
  /** One narrator-voice line under the name (rose). */
  subtitle: string;
  /** Width in px to hold the header to (the frame's content width): a long name is cut with an ellipsis instead of widening the frame. */
  width?: number;
}

/**
 * Shared card header in haiiro: a 96px full-colour avatar in a hairline frame, the
 * member's name as the card title (Jacquard 24, 43px) and a rose subtitle line under it.
 * Lay it out as the first row inside a `CardFrame`.
 *
 * @param props - {@link CardHeaderProps}
 */
export function CardHeader(props: CardHeaderProps) {
  const name = cleanText(props.displayName) || "?";
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 16,
        ...(props.width != null ? { width: props.width, flexShrink: 0 } : {}),
      }}
    >
      <ImageFrame src={props.avatarDataUri} size={96} initial={name} />
      <div style={{ display: "flex", flexDirection: "column", gap: 4, flexGrow: 1, flexShrink: 1, flexBasis: 0, minWidth: 0 }}>
        <Title truncate>{name}</Title>
        <Text tone="rose" truncate>{cleanText(props.subtitle)}</Text>
      </div>
    </div>
  );
}
