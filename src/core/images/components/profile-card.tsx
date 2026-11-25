import { ComicBackground, Panel } from "./comic-bg.tsx";
import { CardHeader } from "./card-header.tsx";
import { OutlinedText, sanitizeText } from "./outlined-text.tsx";
import { fmtDate } from "../util.ts";

export const PROFILE_WIDTH = 900;

export interface PresidencyTerm {
  termStart: number;
  termEnd: number | null;
  votes: number;
}

export interface ProfileCardProps {
  displayName: string;
  avatarDataUri: string | null;
  level: number;
  xp: number;
  xpCurrent: number;
  xpNeeded: number;
  credits: number;
  rank: number;
  clubs: string[];
  presidency: PresidencyTerm[];
}

/** Card height depends on whether the presidency panel renders. */
export function profileCardHeight(props: ProfileCardProps): number {
  const base = 560;
  return props.presidency.length > 0
    ? base + 84 + props.presidency.length * 38
    : base;
}

const label = { fontFamily: "Comic", fontWeight: 700, fontSize: 28, color: "#000" } as const;

function StatRow(props: { name: string; value: string }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between" }}>
      <span style={label}>{props.name}</span>
      <span style={label}>{props.value}</span>
    </div>
  );
}

export function ProfileCard(props: ProfileCardProps) {
  const pct = props.xpNeeded > 0 ? Math.min(100, (props.xpCurrent / props.xpNeeded) * 100) : 0;
  return (
    <ComicBackground>
      <CardHeader
        displayName={props.displayName}
        avatarDataUri={props.avatarDataUri}
        subtitle={`LEVEL ${props.level}  ·  RANK #${props.rank}`}
      />

      <Panel>
        <StatRow name="Social Credits" value={`${props.credits}`} />
        <StatRow name="XP" value={`${props.xp}`} />
        <div
          style={{
            display: "flex",
            height: 34,
            border: "4px solid #000",
            borderRadius: 17,
            backgroundColor: "#e8e0cc",
            overflow: "hidden",
          }}
        >
          <div
            style={{
              display: "flex",
              width: `${pct}%`,
              backgroundImage: "linear-gradient(90deg, #ffd23f, #ff6b35)",
            }}
          />
        </div>
        <span style={{ ...label, fontSize: 22 }}>
          {`${props.xpCurrent}/${props.xpNeeded} XP to level ${props.level + 1}`}
        </span>
      </Panel>

      <Panel>
        <OutlinedText size={26} color="#ff6b35" stroke={4}>
          CLUBS
        </OutlinedText>
        <span style={{ ...label, fontWeight: 400, fontSize: 26 }}>
          {props.clubs.length ? sanitizeText(props.clubs.join(", ")) : "None"}
        </span>
      </Panel>

      {props.presidency.length > 0 && (
        <Panel>
          <OutlinedText size={26} color="#9b59b6" stroke={4}>
            PRESIDENCY LOG
          </OutlinedText>
          {props.presidency.map((t, i) => (
            <span key={i} style={{ ...label, fontWeight: 400, fontSize: 24 }}>
              {`${fmtDate(t.termStart)} – ${t.termEnd ? fmtDate(t.termEnd) : "Present"} (${t.votes} votes)`}
            </span>
          ))}
        </Panel>
      )}
    </ComicBackground>
  );
}
