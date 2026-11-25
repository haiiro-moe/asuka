import { ComicBackground, Panel } from "./comic-bg.tsx";
import { CardHeader } from "./card-header.tsx";
import { OutlinedText, sanitizeText } from "./outlined-text.tsx";

export const ELECTION_RESULTS_WIDTH = 900;

export interface ElectionResultsRow {
  name: string;
  votes: number;
}

export interface ElectionResultsCardProps {
  /** Null when no candidates stood. */
  winner: { name: string; avatarDataUri: string | null; votes: number } | null;
  /** All candidates, sorted by votes descending (winner included). */
  rows: ElectionResultsRow[];
  totalVotes: number;
}

export function electionResultsCardHeight(props: ElectionResultsCardProps): number {
  if (!props.winner) return 320;
  return 360 + props.rows.length * 92;
}

const MEDAL_COLORS: Record<number, string> = { 1: "#ffac33", 2: "#c0c8d0", 3: "#cd7f32" };

/** Full election results: winner spotlight plus the complete vote tally. */
export function ElectionResultsCard(props: ElectionResultsCardProps) {
  return (
    <ComicBackground>
      <OutlinedText size={52} color="#ffd23f" align="center">
        ELECTION RESULTS
      </OutlinedText>

      {!props.winner && (
        <Panel grow>
          <span style={{ fontFamily: "Comic", fontWeight: 700, fontSize: 30, color: "#000" }}>
            No candidates stood. No president was elected.
          </span>
        </Panel>
      )}

      {props.winner && (
        <CardHeader
          displayName={props.winner.name}
          avatarDataUri={props.winner.avatarDataUri}
          subtitle={`NEW PRESIDENT  ·  ${props.winner.votes} VOTE${props.winner.votes === 1 ? "" : "S"}`}
        />
      )}

      {props.winner &&
        props.rows.map((row, i) => (
          <Panel key={i}>
            <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
              <span
                style={{
                  display: "flex",
                  justifyContent: "center",
                  width: 64,
                  fontFamily: "Bangers",
                  fontSize: 36,
                  color: MEDAL_COLORS[i + 1] ?? "#000",
                }}
              >
                {`#${i + 1}`}
              </span>
              <span style={{ fontFamily: "Bangers", fontSize: 32, color: "#000", flexGrow: 1 }}>
                {sanitizeText(row.name) || "?"}
              </span>
              <span style={{ fontFamily: "Bangers", fontSize: 28, color: "#b3261e" }}>
                {`${row.votes} VOTE${row.votes === 1 ? "" : "S"}`}
              </span>
            </div>
          </Panel>
        ))}

      {props.winner && (
        <OutlinedText size={26} color="#fff" stroke={4} align="center">
          {`TOTAL VOTES: ${props.totalVotes}`}
        </OutlinedText>
      )}
    </ComicBackground>
  );
}
