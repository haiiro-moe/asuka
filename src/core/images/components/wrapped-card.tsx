import type { WrappedData } from "../../../plugins/activity/types/wrapped.ts";
import { CardFrame, ImageFrame, KeyValue, Rule, StillBackdrop, Text, Title, cleanText } from "./haiiro/index.ts";
import { CARD_GEOMETRY, PROFILE_WIDTH, framedCardHeight } from "./profile-card.tsx";

/** Width in px of the Wrapped card. */
export const WRAPPED_CARD_WIDTH = PROFILE_WIDTH;

/** Height of the Jacquard title line, in px. */
const TITLE_HEIGHT = 48;
/** Side of the avatar, in px. */
const AVATAR = 128;
/** Stat rows on the card. */
const STAT_ROWS = 5;
/** Gap between two stat rows, in px. */
const STAT_GAP = 8;

/**
 * Height in px of the Wrapped card: title, rule, avatar row, five stat rows, rule and
 * the closing line, inside the frame.
 */
export const WRAPPED_CARD_HEIGHT = framedCardHeight(
  TITLE_HEIGHT +
    1 +
    AVATAR +
    (STAT_ROWS * CARD_GEOMETRY.line + (STAT_ROWS - 1) * STAT_GAP) +
    1 +
    CARD_GEOMETRY.line +
    5 * CARD_GEOMETRY.gap,
);

/** Props for {@link WrappedCard}. */
export interface WrappedCardProps {
  /** The member's snapshot. */
  data: WrappedData;
  /** The member's display name. */
  displayName: string;
  /** Avatar as a PNG/JPEG data URI, or null for the placeholder. */
  avatarDataUri: string | null;
}

/** A whole number with thousands separators, e.g. `12,480`. */
function num(n: number): string {
  return n.toLocaleString("en-US");
}

/**
 * The top emoji as text. satori has no emoji font, so a unicode emoji is shown
 * by its use count only; a custom emoji by its `:name:` and count.
 */
function topEmojiText(data: WrappedData): string {
  const top = data.topEmoji[0];
  if (!top) return "none";
  const uses = `${num(top.count)} use${top.count === 1 ? "" : "s"}`;
  const name = top.name ? cleanText(top.name) : "";
  return name ? `:${name}: ${uses}` : uses;
}

/**
 * The shareable Wrapped card in haiiro, labelled `wrapped: ~/<year>`: a gold Jacquard
 * title, the member's full-colour avatar and name, their level, five stat rows
 * (messages, voice hours, busiest hour and weekday in UTC, top emoji) and a rose
 * narrator line. It shows only the member's own numbers: the friend fields of the
 * snapshot are never drawn, since the card is meant to be shared.
 *
 * @param props - {@link WrappedCardProps}
 */
export function WrappedCard(props: WrappedCardProps) {
  const { data } = props;
  const name = cleanText(props.displayName) || "?";
  const hour = data.busiestHour === null ? "none" : `${String(data.busiestHour).padStart(2, "0")}:00 utc`;
  return (
    <StillBackdrop
      width={WRAPPED_CARD_WIDTH}
      height={WRAPPED_CARD_HEIGHT}
      padding={CARD_GEOMETRY.backdropPad}
      seed={2026 + (data.year % 7)}
    >
      <CardFrame label={`wrapped: ~/${data.year}`} grow>
        <Title tone="gold" truncate>
          {`wrapped ${data.year}`}
        </Title>
        <Rule gap={0} />
        <div style={{ display: "flex", gap: 16, alignItems: "center" }}>
          <ImageFrame src={props.avatarDataUri} size={AVATAR} initial={name} />
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
            <Text tone="rose">{`your ${data.year}, in numbers`}</Text>
            <KeyValue label="level" value={String(data.xpLevel)} tone="gold" />
          </div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: STAT_GAP }}>
          <KeyValue label="messages" value={num(data.messages)} tone="foam" />
          <KeyValue label="in voice" value={`${data.voiceHours} h`} tone="foam" />
          <KeyValue label="your hour" value={hour} />
          <KeyValue label="busiest day" value={data.busiestDay ?? "none"} />
          <KeyValue label="top emoji" value={topEmojiText(data)} />
        </div>
        <Rule gap={0} />
        <Text tone="rose">{`that is all of it. see you in ${data.year + 1}.`}</Text>
      </CardFrame>
    </StillBackdrop>
  );
}
