import { ComicBackground, Panel } from "./comic-bg.tsx";
import { CardHeader } from "./card-header.tsx";
import { OutlinedText } from "./outlined-text.tsx";

export const WINNER_CARD_WIDTH = 900;
export const WINNER_CARD_HEIGHT = 460;

export interface WinnerCardProps {
  displayName: string;
  avatarDataUri: string | null;
  votes: number;
  /** Card headline; defaults to the DM voice. */
  title?: string;
  /** Body line; defaults to the DM voice. */
  message?: string;
}

/** Celebration card: DM'd to the new president and reused (with a different
 * title/message) for the server-wide announcement. */
export function WinnerCard(props: WinnerCardProps) {
  const votes = `${props.votes} vote${props.votes === 1 ? "" : "s"}`;
  return (
    <ComicBackground>
      <OutlinedText size={60} color="#ffd23f" align="center">
        {props.title ?? "CONGRATULATIONS!"}
      </OutlinedText>
      <CardHeader
        displayName={props.displayName}
        avatarDataUri={props.avatarDataUri}
        subtitle="NEW STUDENT COUNCIL PRESIDENT"
      />
      <Panel grow>
        <span style={{ fontFamily: "Comic", fontWeight: 700, fontSize: 28, color: "#000" }}>
          {props.message ?? `You won the election with ${votes}! Your term starts now.`}
        </span>
      </Panel>
    </ComicBackground>
  );
}
