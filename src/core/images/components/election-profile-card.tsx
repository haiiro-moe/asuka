import { ComicBackground, Panel } from "./comic-bg.tsx";
import { CardHeader } from "./card-header.tsx";
import { OutlinedText, sanitizeText } from "./outlined-text.tsx";

export const ELECTION_PROFILE_WIDTH = 900;
export const ELECTION_PROFILE_HEIGHT = 700;

export interface ElectionProfileCardProps {
  displayName: string;
  avatarDataUri: string | null;
  rank: number;
  level: number;
  credits: number;
  /** Null when the member is not standing in the current election. */
  motto: string | null;
  vision: string | null;
  isCandidate: boolean;
  /** Header subtitle, e.g. "CANDIDATE" on the public candidacy post. */
  subtitle?: string;
  /** Silence sabotage: replace motto & vision with a stamped "SABOTAGED". */
  sabotaged?: boolean;
}

const body = { fontFamily: "Comic", fontWeight: 400, fontSize: 26, color: "#000" } as const;

function clamp(text: string, max = 220): string {
  const clean = sanitizeText(text);
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean;
}

/** Rubber-stamp look for silenced candidates: rotated, bordered, blood red. */
function SabotagedStamp() {
  return (
    <div
      style={{
        display: "flex",
        alignSelf: "center",
        transform: "rotate(-8deg)",
        border: "6px solid #c0392b",
        borderRadius: 8,
        padding: "4px 24px",
        color: "#c0392b",
        fontFamily: "Comic",
        fontWeight: 700,
        fontSize: 44,
        letterSpacing: 8,
        opacity: 0.85,
      }}
    >
      SABOTAGED
    </div>
  );
}

export function ElectionProfileCard(props: ElectionProfileCardProps) {
  return (
    <ComicBackground>
      <CardHeader
        displayName={props.displayName}
        avatarDataUri={props.avatarDataUri}
        subtitle={props.subtitle ?? "ELECTION PROFILE"}
      />

      <Panel>
        <div style={{ display: "flex", justifyContent: "space-between" }}>
          <span style={{ ...body, fontWeight: 700, fontSize: 28 }}>{`RANK #${props.rank}`}</span>
          <span style={{ ...body, fontWeight: 700, fontSize: 28 }}>{`LEVEL ${props.level}`}</span>
          <span style={{ ...body, fontWeight: 700, fontSize: 28 }}>{`${props.credits} CREDITS`}</span>
        </div>
      </Panel>

      {/* Satori lays React fragments out as a row, so keep panels as siblings. */}
      {props.isCandidate && (
        <Panel grow>
          <OutlinedText size={26} color="#9b59b6" stroke={4}>
            CAMPAIGN MOTTO
          </OutlinedText>
          {props.sabotaged ? (
            <SabotagedStamp />
          ) : (
            <span style={{ ...body, fontStyle: "italic" }}>
              {props.motto ? `“${clamp(props.motto)}”` : "—"}
            </span>
          )}
        </Panel>
      )}
      {props.isCandidate && (
        <Panel grow>
          <OutlinedText size={26} color="#ff6b35" stroke={4}>
            IF ELECTED
          </OutlinedText>
          {props.sabotaged ? (
            <SabotagedStamp />
          ) : (
            <span style={body}>{props.vision ? clamp(props.vision) : "—"}</span>
          )}
        </Panel>
      )}
      {!props.isCandidate && (
        <Panel grow>
          <span style={body}>Not currently standing in an election.</span>
        </Panel>
      )}
    </ComicBackground>
  );
}
