import { CardHeader } from "./card-header.tsx";
import { CardFrame, StillBackdrop, Text, cleanText, color } from "./haiiro/index.ts";
import { CARD_GEOMETRY, PROFILE_WIDTH, framedCardHeight } from "./profile-card.tsx";

/** Width in px of the election profile card. */
export const ELECTION_PROFILE_WIDTH = PROFILE_WIDTH;

/** Lines a campaign motto may take before it is cut with an ellipsis. */
const MOTTO_LINES = 3;
/** Lines a vision statement may take before it is cut with an ellipsis. */
const VISION_LINES = 5;

/**
 * Largest height in px of the election profile card: a candidate with a full-length motto
 * and vision. See {@link electionProfileHeight} for the height of a given card.
 */
export const ELECTION_PROFILE_HEIGHT = framedCardHeight(
  96 + CARD_GEOMETRY.line + (CARD_GEOMETRY.line + 4 + MOTTO_LINES * CARD_GEOMETRY.line) +
    (CARD_GEOMETRY.line + 4 + VISION_LINES * CARD_GEOMETRY.line) + 4 * CARD_GEOMETRY.gap,
);

/** Props the height depends on. */
type ElectionHeightProps = Pick<ElectionProfileCardProps, "isCandidate" | "sabotaged">;

/**
 * Height in px of the election profile card for these props: a non-candidate card holds
 * one narrator line, a sabotaged one two stamps, a full candidate the whole motto and
 * vision. The card is cut to its content so no empty area is left inside the frame.
 *
 * @param props - Whether the member stands and whether they are silenced.
 * @returns Image height in px.
 */
export function electionProfileHeight(props: ElectionHeightProps): number {
  const { line, gap } = CARD_GEOMETRY;
  const stamp = 2 * line + 4; // 32px word (36px) plus the 2px border top and bottom
  const block = (lines: number) => line + 4 + (props.sabotaged ? stamp + 4 : lines * line);
  const sections = props.isCandidate
    ? [96, line, block(MOTTO_LINES), block(VISION_LINES)]
    : [96, line, line];
  return framedCardHeight(sections.reduce((a, b) => a + b, 0) + (sections.length - 1) * gap);
}

/** Props for {@link ElectionProfileCard}. */
export interface ElectionProfileCardProps {
  /** Member display name. */
  displayName: string;
  /** Avatar as a PNG/JPEG data URI, or null for the placeholder. */
  avatarDataUri: string | null;
  /** 1-based rank by XP. */
  rank: number;
  /** Current level. */
  level: number;
  /** Social credits. */
  credits: number;
  /** Null when the member is not standing in the current election. */
  motto: string | null;
  /** Null when the member is not standing, or gave no vision. */
  vision: string | null;
  /** Whether the member is a candidate in the current election. */
  isCandidate: boolean;
  /** Header subtitle, e.g. "CANDIDATE" or "PRESIDENT" (drawn lowercase). Defaults to `election profile`. */
  subtitle?: string;
  /** Silence sabotage: replace motto and vision with a stamped `sabotaged`. */
  sabotaged?: boolean;
}

/** Cut a user text to `max` characters with an ellipsis, emoji stripped. */
function clamp(text: string, max = 220): string {
  const clean = cleanText(text);
  const chars = Array.from(clean);
  return chars.length > max ? `${chars.slice(0, max - 1).join("")}…` : clean;
}

/** The silenced-candidate stamp: a love-coloured hairline box around a 32px word. */
function SabotagedStamp() {
  return (
    <div
      style={{
        display: "flex",
        alignSelf: "flex-start",
        border: `2px solid ${color.love}`,
        paddingLeft: 12,
        paddingRight: 12,
      }}
    >
      <Text size="large" tone="love">
        sabotaged
      </Text>
    </div>
  );
}

/** A key and value side by side: muted uppercase key, then the value. */
function Stat(props: { label: string; value: string; tone?: "foam" | "gold" }) {
  return (
    <div style={{ display: "flex", gap: 8 }}>
      <Text tone="muted" upper>
        {props.label}
      </Text>
      <Text tone={props.tone ?? "text"}>{props.value}</Text>
    </div>
  );
}

/** A labelled text block: muted uppercase key over a clamped body. */
function Block(props: { label: string; lines: number; children: string | null; sabotaged?: boolean; tone: "rose" | "text" }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <Text tone="muted" upper>
        {props.label}
      </Text>
      {props.sabotaged ? (
        <SabotagedStamp />
      ) : (
        <div style={{ display: "flex", height: props.lines * CARD_GEOMETRY.line, overflow: "hidden" }}>
          <Text tone={props.tone}>{props.children ? props.children : "-"}</Text>
        </div>
      )}
    </div>
  );
}

/**
 * Election-view profile in haiiro, labelled `election: ~/candidates`: avatar, name, a rose
 * status line (`candidate`, `president`), a rank / level / credits row and, for
 * candidates, the campaign motto and the vision. A silenced candidate gets a love-coloured
 * frame and a lowercase `sabotaged` stamp in place of both texts.
 *
 * @param props - {@link ElectionProfileCardProps}
 */
export function ElectionProfileCard(props: ElectionProfileCardProps) {
  const subtitle = cleanText(props.subtitle ?? "election profile").toLowerCase();
  return (
    <StillBackdrop
      width={ELECTION_PROFILE_WIDTH}
      height={electionProfileHeight(props)}
      padding={CARD_GEOMETRY.backdropPad}
      seed={69}
    >
      <CardFrame
        label="election: ~/candidates"
        frame={props.isCandidate && props.sabotaged ? "love" : "pine"}
        labelTone={props.isCandidate && props.sabotaged ? "love" : "foam"}
        grow
      >
        <CardHeader width={CARD_GEOMETRY.contentWidth} displayName={props.displayName} avatarDataUri={props.avatarDataUri} subtitle={subtitle} />
        <div style={{ display: "flex", gap: 32 }}>
          <Stat label="rank" value={`#${props.rank}`} />
          <Stat label="lv" value={String(props.level)} tone="foam" />
          <Stat label="sc" value={Math.round(props.credits).toLocaleString("en-US")} tone="gold" />
        </div>
        {props.isCandidate ? (
          <Block label="campaign motto" lines={MOTTO_LINES} sabotaged={props.sabotaged} tone="rose">
            {props.motto ? `"${clamp(props.motto)}"` : null}
          </Block>
        ) : (
          <Text tone="subtle">not currently standing in an election.</Text>
        )}
        {props.isCandidate && (
          <Block label="if elected" lines={VISION_LINES} sabotaged={props.sabotaged} tone="text">
            {props.vision ? clamp(props.vision) : null}
          </Block>
        )}
      </CardFrame>
    </StillBackdrop>
  );
}

