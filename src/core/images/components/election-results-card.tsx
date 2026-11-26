import {
  CardFrame,
  ImageFrame,
  ProgressBar,
  Rule,
  StillBackdrop,
  Text,
  Title,
  cleanText,
} from "./haiiro/index.ts";
import { CARD_GEOMETRY, PROFILE_WIDTH, framedCardHeight } from "./profile-card.tsx";
import { RankRow, RANK_ROW_HEIGHT } from "./leaderboard-card.tsx";

/** Width in px of the election results card. */
export const ELECTION_RESULTS_WIDTH = PROFILE_WIDTH;

/** One candidate's tally. */
export interface ElectionResultsRow {
  /** Candidate display name. */
  name: string;
  /** Votes received. */
  votes: number;
}

/** Props for {@link ElectionResultsCard}. */
export interface ElectionResultsCardProps {
  /** Null when no candidates stood. */
  winner: { name: string; avatarDataUri: string | null; votes: number } | null;
  /** All candidates, sorted by votes descending (winner included). */
  rows: ElectionResultsRow[];
  /** Votes cast in total. */
  totalVotes: number;
}

/** Height of a tally row: the 32px rank row plus a 6px bar and a 2px gap. */
const TALLY_ROW = RANK_ROW_HEIGHT + 8;

/** Plural-aware vote count: `1 vote`, `3 votes`. */
function voteWord(n: number): string {
  return `${n} vote${n === 1 ? "" : "s"}`;
}

/**
 * Pixel height of the results card: with a winner, title, winner header, rule, one tally
 * row per candidate and the total line; without one, title and a message.
 *
 * @param props - The card's props.
 * @returns The PNG height in px.
 */
export function electionResultsCardHeight(props: ElectionResultsCardProps): number {
  const { gap, line } = CARD_GEOMETRY;
  if (!props.winner) return framedCardHeight(48 + line + gap);
  const sections = [48, 96, 1, props.rows.length * TALLY_ROW, line];
  return framedCardHeight(sections.reduce((a, b) => a + b, 0) + (sections.length - 1) * gap);
}

/**
 * Full election results in haiiro, labelled `results: ~/election`: Jacquard title, the
 * winner's avatar, name and `new president` line, then every candidate as a ranked row
 * (gold, foam, iris, then muted) with their votes and a bar scaled to the leader, and a
 * total at the foot.
 *
 * @param props - {@link ElectionResultsCardProps}
 */
export function ElectionResultsCard(props: ElectionResultsCardProps) {
  const winner = props.winner;
  const top = Math.max(1, ...props.rows.map((r) => r.votes));
  const winnerName = winner ? cleanText(winner.name) || "?" : "";
  return (
    <StillBackdrop
      width={ELECTION_RESULTS_WIDTH}
      height={electionResultsCardHeight(props)}
      padding={CARD_GEOMETRY.backdropPad}
      seed={57}
    >
      <CardFrame label="results: ~/election" grow>
        <Title>election results</Title>

        {!winner && <Text tone="subtle">no candidates stood. no president was elected.</Text>}

        {winner && (
          <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
            <ImageFrame src={winner.avatarDataUri} size={96} initial={winnerName} />
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
              <Text size="large" tone="pine" truncate>
                {winnerName}
              </Text>
              <Text tone="rose">{`new president, ${voteWord(winner.votes)}`}</Text>
            </div>
          </div>
        )}

        {winner && <Rule gap={0} />}

        {winner && (
          <div style={{ display: "flex", flexDirection: "column" }}>
            {props.rows.map((row, i) => (
              <div key={i} style={{ display: "flex", flexDirection: "column", gap: 2, }}>
                <RankRow rank={i + 1} name={row.name}>
                  <Text tone="foam">{voteWord(row.votes)}</Text>
                </RankRow>
                <div style={{ display: "flex", paddingLeft: 6, paddingRight: 6 }}>
                  <ProgressBar value={row.votes} max={top} height={6} tone={i === 0 ? "gold" : "iris"} />
                </div>
              </div>
            ))}
          </div>
        )}

        {winner && (
          <div style={{ display: "flex", justifyContent: "space-between" }}>
            <Text tone="muted" upper>
              total votes
            </Text>
            <Text tone="text">{String(props.totalVotes)}</Text>
          </div>
        )}
      </CardFrame>
    </StillBackdrop>
  );
}
