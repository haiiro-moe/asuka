import type { ReactNode } from "react";
import {
  CardFrame,
  ImageFrame,
  KeyValue,
  RankMark,
  Rule,
  StillBackdrop,
  Text,
  Title,
  cleanText,
  color,
} from "./haiiro/index.ts";
import { CARD_GEOMETRY, PROFILE_WIDTH, framedCardHeight } from "./profile-card.tsx";

/** Width in px of the leaderboard card. */
export const LEADERBOARD_WIDTH = PROFILE_WIDTH;

/** Height of one ranked row in px. */
export const RANK_ROW_HEIGHT = 32;

/** One leaderboard line. */
export interface LeaderboardRow {
  /** 1-based rank. */
  rank: number;
  /** Member display name. */
  name: string;
  /** Social credits. */
  credits: number;
  /** Level. */
  level: number;
  /** Optional avatar as a PNG/JPEG data URI. Avatars show only when at least one row has one. */
  avatarDataUri?: string | null;
}

/** Props for {@link LeaderboardCard}. */
export interface LeaderboardCardProps {
  /** The rows of this page, in rank order. */
  rows: LeaderboardRow[];
  /** Rank of the viewing member, to mark their row with `»` on an overlay band. */
  currentRank?: number;
  /** 1-based page number; with `pages`, adds a `page 1 of 3` footer. */
  page?: number;
  /** Total number of pages. */
  pages?: number;
}

/** Group separators, `en-US` style. */
function fmt(n: number): string {
  return Math.round(n).toLocaleString("en-US");
}

/** Props for {@link RankRow}. */
export interface RankRowProps {
  /** 1-based rank. */
  rank: number;
  /** Name, drawn as given (emoji stripped) and cut with an ellipsis. */
  name: string;
  /** Mark as the viewer's own row: overlay band and `»`. */
  current?: boolean;
  /** Avatar data URI; `undefined` omits the avatar slot, null draws the placeholder. */
  avatarDataUri?: string | null;
  /** Right-hand columns (already laid out), after the name. */
  children: ReactNode;
}

/**
 * One 32px ranked row: rank in its colour job, optional 24px avatar, name, then the
 * caller's columns. The viewer's row sits on an `overlay` band. Shared by the leaderboard
 * and the election results.
 *
 * @param props - {@link RankRowProps}
 */
export function RankRow(props: RankRowProps) {
  const name = cleanText(props.name) || "?";
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 12,
        height: RANK_ROW_HEIGHT,
        paddingLeft: 6,
        paddingRight: 6,
        backgroundColor: props.current ? color.overlay : "transparent",
      }}
    >
      <RankMark rank={props.rank} current={props.current} width={40} />
      {props.avatarDataUri !== undefined && <ImageFrame src={props.avatarDataUri} size={24} initial={name} />}
      <Text
        truncate
        style={{ flexGrow: 1, flexShrink: 1, flexBasis: 0, minWidth: 0 }}
      >
        {name}
      </Text>
      {props.children}
    </div>
  );
}

/** Content height of the leaderboard (title block, rows, optional footer), in px. */
function contentHeight(props: LeaderboardCardProps): number {
  const rows = Math.max(1, props.rows.length) * RANK_ROW_HEIGHT;
  const footer = props.page !== undefined && props.pages !== undefined;
  const sections = [48 + 4 + CARD_GEOMETRY.line, 1, rows];
  if (footer) sections.push(CARD_GEOMETRY.line);
  return sections.reduce((a, b) => a + b, 0) + (sections.length - 1) * CARD_GEOMETRY.gap;
}

/**
 * Pixel height of the leaderboard card: title block, one 32px row per entry (at least
 * one, for the empty message) and the optional page footer.
 *
 * @param props - The card's props.
 * @returns The PNG height in px.
 */
export function leaderboardCardHeight(props: LeaderboardCardProps): number {
  return framedCardHeight(contentHeight(props));
}

/**
 * Social-credit leaderboard in haiiro: one window labelled `top: ~/leaderboard` with a
 * Jacquard title, a rose subtitle, and ranked rows (rank gold/foam/iris then muted,
 * name, level in foam, credits). The viewer's row is on an overlay band with `»`.
 * An optional footer reads `page 1 of 3`.
 *
 * @param props - {@link LeaderboardCardProps}
 */
export function LeaderboardCard(props: LeaderboardCardProps) {
  const showAvatars = props.rows.some((r) => r.avatarDataUri);
  const footer = props.page !== undefined && props.pages !== undefined;
  return (
    <StillBackdrop
      width={LEADERBOARD_WIDTH}
      height={leaderboardCardHeight(props)}
      padding={CARD_GEOMETRY.backdropPad}
      seed={33}
    >
      <CardFrame label="top: ~/leaderboard" grow>
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <Title>leaderboard</Title>
          <Text tone="rose">who holds the most social credit</Text>
        </div>
        <Rule gap={0} />
        <div style={{ display: "flex", flexDirection: "column" }}>
          {props.rows.length === 0 ? (
            <div style={{ display: "flex", height: RANK_ROW_HEIGHT, alignItems: "center", paddingLeft: 6 }}>
              <Text tone="subtle">no ranked members yet.</Text>
            </div>
          ) : (
            props.rows.map((row) => (
              <RankRow
                key={row.rank}
                rank={row.rank}
                name={row.name}
                current={props.currentRank === row.rank}
                avatarDataUri={showAvatars ? (row.avatarDataUri ?? null) : undefined}
              >
                <Text tone="foam" style={{ width: 56, justifyContent: "flex-end" }}>{`lv ${row.level}`}</Text>
                <Text style={{ width: 96, justifyContent: "flex-end" }}>{fmt(row.credits)}</Text>
              </RankRow>
            ))
          )}
        </div>
        {footer && (
          <KeyValue label={`page ${props.page} of ${props.pages}`} value="by sc" labelTone="muted" tone="muted" />
        )}
      </CardFrame>
    </StillBackdrop>
  );
}
