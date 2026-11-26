import {
  Chip,
  Tag,
  CardFrame,
  ImageFrame,
  KeyValue,
  ProgressBar,
  Rule,
  StillBackdrop,
  Text,
  Title,
  cleanText,
  rankTone,
} from "./haiiro/index.ts";
import { CardHeader } from "./card-header.tsx";
import { fmtDate } from "../util.ts";

/** Width in px of every community card (profile, election, leaderboard, results, winner). */
export const PROFILE_WIDTH = 640;

/** Space between the image edge and the card frame, in px. */
const BACKDROP_PAD = 32;
/** Frame chrome plus content padding on the vertical axis: 2 x 5px frame + 24px top + 16px bottom. */
const FRAME_CHROME_Y = 10 + 24 + 16;
/** Content width inside a 640px card: 640 - 2 x 32 backdrop - 2 x 5 frame - 2 x 20 padding. */
const CONTENT_WIDTH = PROFILE_WIDTH - 2 * BACKDROP_PAD - 10 - 40;
/** Height of one 16px text line: 16px at line-height 1.125. */
const LINE = 18;
/** Gap between a card's sections in px (the CardFrame default). */
const SECTION_GAP = 12;

/**
 * Image height for a framed card whose content column is `contentHeight` px tall: the
 * backdrop padding and frame chrome added on. Shared by the community cards so each
 * `*CardHeight` helper stays in step with the layout.
 *
 * @param contentHeight - Height of everything inside the frame's padding, in px.
 * @returns The PNG height in px.
 */
export function framedCardHeight(contentHeight: number): number {
  return 2 * BACKDROP_PAD + FRAME_CHROME_Y + contentHeight;
}

/** The framed-card geometry shared by the community cards, in px. */
export const CARD_GEOMETRY = {
  /** Space between the image edge and the card frame. */
  backdropPad: BACKDROP_PAD,
  /** Usable content width inside the frame. */
  contentWidth: CONTENT_WIDTH,
  /** One 16px text line. */
  line: LINE,
  /** Gap between sections. */
  gap: SECTION_GAP,
} as const;

/** One presidency term shown in the profile's presidency log. */
export interface PresidencyTerm {
  /** Term start, unix seconds. */
  termStart: number;
  /** Term end, unix seconds, or null while the term is running. */
  termEnd: number | null;
  /** Votes the member won the term with. */
  votes: number;
}

/** Props for {@link ProfileCard}. */
export interface ProfileCardProps {
  /** Member display name, shown as the card title. */
  displayName: string;
  /** Avatar as a PNG/JPEG data URI, or null for the placeholder with the initial. */
  avatarDataUri: string | null;
  /** Current level. */
  level: number;
  /** Total XP. */
  xp: number;
  /** XP earned inside the current level. */
  xpCurrent: number;
  /** XP the current level needs in total; 0 hides progress. */
  xpNeeded: number;
  /** Social credits. */
  credits: number;
  /** 1-based rank by XP. */
  rank: number;
  /** Names of the clubs the member belongs to. */
  clubs: string[];
  /** Presidency terms, shown as a log under the stats when there are any. */
  presidency: PresidencyTerm[];
}

/** Most club chips shown; the rest collapse into a `+n` chip. */
const MAX_CLUBS = 8;
/** Most presidency terms listed; the rest collapse into a `+n more` line. */
const MAX_TERMS = 6;
/** Longest club name drawn on a chip. */
const CLUB_NAME_MAX = 18;

/** Group separators for a number, `en-US` style: `160,440`. */
function fmt(n: number): string {
  return Math.round(n).toLocaleString("en-US");
}

/** Cut `text` to `max` characters with an ellipsis. */
function clip(text: string, max: number): string {
  const chars = Array.from(text);
  return chars.length > max ? `${chars.slice(0, max - 1).join("")}…` : text;
}

/** Width of one character at 16px: Unifont's CJK and wide forms are 16px, the rest 8px. */
function charWidth(ch: string): number {
  const cp = ch.codePointAt(0) ?? 0;
  const wide =
    (cp >= 0x1100 && cp <= 0x115f) ||
    (cp >= 0x2e80 && cp <= 0xa4cf) ||
    (cp >= 0xac00 && cp <= 0xd7a3) ||
    (cp >= 0xf900 && cp <= 0xfaff) ||
    (cp >= 0xff00 && cp <= 0xff60) ||
    (cp >= 0x20000 && cp <= 0x3ffff);
  return wide ? 16 : 8;
}

/** Estimated tag width in px: text and the chip's padding and border. */
function chipWidth(label: string): number {
  let w = 14 + 2; // padding + hairline
  for (const ch of label) w += charWidth(ch);
  return w;
}

/** Club chip labels: cleaned, clipped, capped at {@link MAX_CLUBS} with a `+n` tail. */
function clubLabels(clubs: string[]): { labels: string[]; hasMore: boolean } {
  const names = clubs.map((c) => clip(cleanText(c), CLUB_NAME_MAX)).filter(Boolean);
  if (names.length <= MAX_CLUBS) return { labels: names, hasMore: false };
  return { labels: [...names.slice(0, MAX_CLUBS - 1), `+${names.length - (MAX_CLUBS - 1)}`], hasMore: true };
}

/** Number of chip lines the labels need when wrapped at the content width with an 8px gap. */
function chipLines(labels: string[]): number {
  if (labels.length === 0) return 1;
  let lines = 1;
  let used = 0;
  for (const label of labels) {
    const w = chipWidth(label);
    if (used > 0 && used + 8 + w > CONTENT_WIDTH) {
      lines += 1;
      used = w;
    } else {
      used += used > 0 ? 8 + w : w;
    }
  }
  return lines;
}

/** Height of the presidency block's text column: key line, term lines, optional overflow line. */
function presidencyHeight(terms: number): number {
  const items = 1 + Math.min(terms, MAX_TERMS) + (terms > MAX_TERMS ? 1 : 0);
  return items * LINE + (items - 1) * 4;
}

/**
 * Pixel height of the profile card for these props: header, club chips (wrapped), xp bar,
 * two stat rows and, when the member has served, the presidency log. Pass it to the
 * renderer so the PNG fits the content exactly.
 *
 * @param props - The card's props.
 * @returns The PNG height in px.
 */
export function profileCardHeight(props: ProfileCardProps): number {
  const lines = chipLines(clubLabels(props.clubs).labels);
  const chips = lines * 20 + (lines - 1) * 8;
  const sections = [96, chips, 32, 2 * LINE + 6];
  if (props.presidency.length > 0) sections.push(1, presidencyHeight(props.presidency.length));
  const content = sections.reduce((a, b) => a + b, 0) + (sections.length - 1) * SECTION_GAP;
  return framedCardHeight(content);
}

/**
 * Member profile in haiiro: a character sheet in one window labelled `profile: ~/<name>`.
 * Avatar and name (Jacquard title) with a rose rank line, club chips, a level and XP bar,
 * a two-column stat grid (rank, social credits, total XP, XP still needed) and, for
 * members who have served, a presidency log with dates like `4 Nov 2026`.
 *
 * @param props - {@link ProfileCardProps}
 */
export function ProfileCard(props: ProfileCardProps) {
  const name = cleanText(props.displayName) || "?";
  const { labels } = clubLabels(props.clubs);
  const hasNext = props.xpNeeded > 0;
  const shownTerms = props.presidency.slice(0, MAX_TERMS);
  const height = profileCardHeight(props);
  return (
    <StillBackdrop width={PROFILE_WIDTH} height={height} padding={BACKDROP_PAD} seed={21}>
      <CardFrame label={`profile: ~/${clip(name.toLowerCase().replace(/\s/g, "-"), 24)}`} grow>
        <CardHeader
          width={CONTENT_WIDTH}
          displayName={name}
          avatarDataUri={props.avatarDataUri}
          subtitle={`level ${props.level}, rank #${props.rank}`}
        />

        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
          {labels.length === 0 ? (
            <Chip active={false}>no clubs</Chip>
          ) : (
            labels.map((label, i) => <Tag key={i}>{label}</Tag>)
          )}
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <KeyValue
            label={`level ${props.level}`}
            value={hasNext ? `${fmt(props.xpCurrent)} / ${fmt(props.xpNeeded)} xp` : `${fmt(props.xp)} xp`}
            tone="foam"
          />
          <ProgressBar value={hasNext ? props.xpCurrent : 0} max={hasNext ? props.xpNeeded : 1} />
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <div style={{ display: "flex", gap: 24 }}>
            <KeyValue grow label="rank" value={`#${props.rank}`} tone={props.rank <= 3 ? rankTone(props.rank) : "text"} />
            <KeyValue grow label="sc" value={fmt(props.credits)} tone="gold" />
          </div>
          <div style={{ display: "flex", gap: 24 }}>
            <KeyValue grow label="xp" value={fmt(props.xp)} />
            <KeyValue grow label="next" value={hasNext ? `${fmt(Math.max(0, props.xpNeeded - props.xpCurrent))} xp` : "-"} />
          </div>
        </div>

        {props.presidency.length > 0 && <Rule gap={0} />}
        {props.presidency.length > 0 && (
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <Text tone="muted" upper>
              presidency
            </Text>
            {shownTerms.map((t, i) => (
              <div key={i} style={{ display: "flex", justifyContent: "space-between" }}>
                <Text tone="iris">{`${fmtDate(t.termStart)} to ${t.termEnd ? fmtDate(t.termEnd) : "present"}`}</Text>
                <Text tone="subtle">{`${t.votes} vote${t.votes === 1 ? "" : "s"}`}</Text>
              </div>
            ))}
            {props.presidency.length > MAX_TERMS && (
              <Text tone="muted">{`+${props.presidency.length - MAX_TERMS} more terms`}</Text>
            )}
          </div>
        )}
      </CardFrame>
    </StillBackdrop>
  );
}
