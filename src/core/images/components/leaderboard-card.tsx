import { ComicBackground, Panel } from "./comic-bg.tsx";
import { OutlinedText, sanitizeText } from "./outlined-text.tsx";

export const LEADERBOARD_WIDTH = 900;

export interface LeaderboardRow {
  rank: number;
  name: string;
  credits: number;
  level: number;
}

export interface LeaderboardCardProps {
  rows: LeaderboardRow[];
}

export function leaderboardCardHeight(props: LeaderboardCardProps): number {
  return 160 + Math.max(1, props.rows.length) * 92;
}

const MEDAL_COLORS: Record<number, string> = { 1: "#ffac33", 2: "#c0c8d0", 3: "#cd7f32" };

/** Scoreboard: Comic Sans title, Bangers rows for the comic-lettering look. */
export function LeaderboardCard(props: LeaderboardCardProps) {
  return (
    <ComicBackground>
      <OutlinedText size={48} color="#ffd23f" align="center">
        SOCIAL CREDIT LEADERBOARD
      </OutlinedText>

      {props.rows.length === 0 ? (
        <Panel>
          <span style={{ fontFamily: "Comic", fontSize: 28, color: "#000" }}>
            No ranked members yet.
          </span>
        </Panel>
      ) : (
        props.rows.map((row) => (
          <Panel key={row.rank}>
            <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
              <span
                style={{
                  display: "flex",
                  justifyContent: "center",
                  width: 64,
                  fontFamily: "Bangers",
                  fontSize: 36,
                  color: MEDAL_COLORS[row.rank] ?? "#000",
                }}
              >
                {`#${row.rank}`}
              </span>
              <span
                style={{
                  fontFamily: "Bangers",
                  fontSize: 32,
                  color: "#000",
                  flexGrow: 1,
                }}
              >
                {sanitizeText(row.name) || "?"}
              </span>
              <span style={{ fontFamily: "Bangers", fontSize: 28, color: "#b3261e" }}>
                {`${row.credits} CREDITS`}
              </span>
              <span style={{ fontFamily: "Bangers", fontSize: 28, color: "#1a659e" }}>
                {`LVL ${row.level}`}
              </span>
            </div>
          </Panel>
        ))
      )}
    </ComicBackground>
  );
}
