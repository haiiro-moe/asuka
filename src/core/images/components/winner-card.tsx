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
import { CARD_GEOMETRY, PROFILE_WIDTH, framedCardHeight } from "./profile-card.tsx";

/** Width in px of the winner card. */
export const WINNER_CARD_WIDTH = PROFILE_WIDTH;

/** Longest message drawn, in characters: about three lines of 65. */
const MESSAGE_MAX = 190;

/** Lines reserved for the message; longer text is cut by length and the box clips the rest. */
const MESSAGE_LINES = 3;

/**
 * Height in px of the winner card: title, rule, 128px avatar row and a message of up to
 * three lines, inside the frame.
 */
export const WINNER_CARD_HEIGHT = framedCardHeight(
  48 + 1 + 128 + MESSAGE_LINES * CARD_GEOMETRY.line + 3 * CARD_GEOMETRY.gap,
);

/** Props for {@link WinnerCard}. */
export interface WinnerCardProps {
  /** The new president's display name. */
  displayName: string;
  /** Avatar as a PNG/JPEG data URI, or null for the placeholder. */
  avatarDataUri: string | null;
  /** Votes the winner received. */
  votes: number;
  /** Card headline, drawn lowercase; defaults to the DM voice. */
  title?: string;
  /** Body line, narrator voice (rose); defaults to the DM voice. */
  message?: string;
}

/**
 * Celebration card in haiiro, labelled `winner: ~/president`: Jacquard headline in gold,
 * a 128px full-colour avatar, the winner's name, their vote count and a rose message.
 * DM'd to the new president and reused (with a different title and message) for the
 * server-wide announcement.
 *
 * @param props - {@link WinnerCardProps}
 */
export function WinnerCard(props: WinnerCardProps) {
  const name = cleanText(props.displayName) || "?";
  const votes = `${props.votes} vote${props.votes === 1 ? "" : "s"}`;
  const rawMessage = cleanText(props.message ?? `you won with ${votes}. your term starts now.`);
  const message = rawMessage.length > MESSAGE_MAX ? `${rawMessage.slice(0, MESSAGE_MAX - 1)}…` : rawMessage;
  const title = cleanText(props.title ?? "new president").toLowerCase();
  return (
    <StillBackdrop
      width={WINNER_CARD_WIDTH}
      height={WINNER_CARD_HEIGHT}
      padding={CARD_GEOMETRY.backdropPad}
      seed={45}
    >
      <CardFrame label="winner: ~/president" grow>
        <Title tone="gold" truncate>
          {title}
        </Title>
        <Rule gap={0} />
        <div style={{ display: "flex", gap: 16, alignItems: "center" }}>
          <ImageFrame src={props.avatarDataUri} size={128} initial={name} />
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
            <Text size="large" tone="pine" truncate>
              {name}
            </Text>
            <Text tone="rose">new student council president</Text>
            <KeyValue label="votes" value={String(props.votes)} tone="gold" />
          </div>
        </div>
        <div style={{ display: "flex", height: MESSAGE_LINES * CARD_GEOMETRY.line, overflow: "hidden" }}>
          <Text tone="rose">{message}</Text>
        </div>
      </CardFrame>
    </StillBackdrop>
  );
}
