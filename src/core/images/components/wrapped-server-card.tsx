import type { ServerWrapped } from "../../../plugins/activity/types/wrapped.ts";
import { CardFrame, KeyValue, Rule, StillBackdrop, Text, Title, cleanText } from "./haiiro/index.ts";
import { CARD_GEOMETRY, PROFILE_WIDTH, framedCardHeight } from "./profile-card.tsx";

/** Width in px of the server Wrapped card. */
export const WRAPPED_SERVER_CARD_WIDTH = PROFILE_WIDTH;

/** Height of the Jacquard title line, in px. */
const TITLE_HEIGHT = 48;
/** Stat rows on the card when voice is shown; one fewer without it. */
const STAT_ROWS = 8;
/** Gap between two stat rows, in px. */
const STAT_GAP = 8;

/**
 * Height in px of the server Wrapped card: title, rule, the stat rows (eight, or seven
 * without a voice figure), rule and the closing line, inside the frame.
 *
 * @param data - The snapshot; `voiceHours` null drops the voice row.
 */
export function wrappedServerCardHeight(data: Pick<ServerWrapped, "voiceHours">): number {
  const rows = data.voiceHours === null ? STAT_ROWS - 1 : STAT_ROWS;
  return framedCardHeight(TITLE_HEIGHT + 1 + (rows * CARD_GEOMETRY.line + (rows - 1) * STAT_GAP) + 1 + CARD_GEOMETRY.line + 4 * CARD_GEOMETRY.gap);
}

/** Props for {@link WrappedServerCard}. */
export interface WrappedServerCardProps {
  /** The server's snapshot. */
  data: ServerWrapped;
}

/** A whole number with thousands separators, e.g. `12,480`. */
function num(n: number): string {
  return n.toLocaleString("en-US");
}

/** A name cut to fit one row (IBM VGA is 8px a cell). */
function short(text: string, max = 28): string {
  const clean = cleanText(text);
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean;
}

/**
 * The shareable server Wrapped card in haiiro, labelled `wrapped: ~/server/<year>`:
 * a gold Jacquard title, eight stat rows (messages, speakers, voice hours, busiest
 * UTC hour and weekday, top channel, best club, president) and a rose narrator
 * line. Only the public roles are named (the best club and the president); the
 * best pair is never drawn.
 *
 * @param props - {@link WrappedServerCardProps}
 */
export function WrappedServerCard(props: WrappedServerCardProps) {
  const { data } = props;
  const hour = data.busiestHour === null ? "none" : `${String(data.busiestHour).padStart(2, "0")}:00 utc`;
  const channel = data.topChannels[0];
  const channelName = channel
    ? channel.parentName
      ? short(`${channel.name ?? "a thread"} in #${channel.parentName}`)
      : short(`#${channel.name ?? "a channel"}`)
    : "none";
  return (
    <StillBackdrop
      width={WRAPPED_SERVER_CARD_WIDTH}
      height={wrappedServerCardHeight(data)}
      padding={CARD_GEOMETRY.backdropPad}
      seed={3026 + (data.year % 7)}
    >
      <CardFrame label={`wrapped: ~/server/${data.year}`} grow>
        <Title tone="gold" truncate>
          {`the house, ${data.year}`}
        </Title>
        <Rule gap={0} />
        <div style={{ display: "flex", flexDirection: "column", gap: STAT_GAP }}>
          <KeyValue label="messages" value={num(data.messages)} tone="foam" />
          <KeyValue label="voices" value={`${num(data.speakers)} spoke`} tone="foam" />
          {data.voiceHours === null ? null : <KeyValue label="in voice" value={`${data.voiceHours} h`} tone="foam" />}
          <KeyValue label="busiest hour" value={hour} />
          <KeyValue label="busiest day" value={data.busiestWeekday ?? "none"} />
          <KeyValue label="top channel" value={channelName} />
          <KeyValue label="best club" value={data.bestClub ? short(data.bestClub.name) : "none"} />
          <KeyValue label="president" value={data.president?.name ? short(data.president.name) : "none"} tone="gold" />
        </div>
        <Rule gap={0} />
        <Text tone="rose">{`that was the year. see you in ${data.year + 1}.`}</Text>
      </CardFrame>
    </StillBackdrop>
  );
}
