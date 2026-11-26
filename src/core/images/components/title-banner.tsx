import { StillBackdrop } from "./haiiro/still-backdrop.tsx";
import { Text, cleanText, type Tone } from "./haiiro/text.tsx";
import { Title } from "./haiiro/title.tsx";

/** Banner width in px. */
export const BANNER_WIDTH = 900;
/** Banner height in px. */
export const BANNER_HEIGHT = 160;

/** Props for {@link TitleBanner}. */
export interface TitleBannerProps {
  /** The announcement title. Drawn lowercase, as haiiro titles are. */
  title: string;
  /** Title ink (default `text`). Must be a token name, never a CSS colour. */
  color?: Tone;
}

/**
 * Announcement banner in haiiro: the still dithered backdrop, a prompt line
 * (`@ asuka » announce`) and the title in Jacquard 24 with the hard base shadow, like a
 * page head. Titles up to 22 characters use the 86px display size; longer ones drop to
 * 43px and may wrap to two lines.
 *
 * @param props - {@link TitleBannerProps}
 */
export function TitleBanner(props: TitleBannerProps) {
  const title = cleanText(props.title).toLowerCase();
  const display = title.length <= 22;
  return (
    <StillBackdrop width={BANNER_WIDTH} height={BANNER_HEIGHT} padding={20} gap={display ? 2 : 8} seed={11}>
      <div style={{ display: "flex", gap: 8 }}>
        <Text tone="love">@</Text>
        <Text tone="foam">asuka</Text>
        <Text tone="rose">»</Text>
        <Text tone="gold">announce</Text>
      </div>
      <div style={{ display: "flex" }}>
        <Title size={display ? "display" : "title"} tone={props.color}>
          {title}
        </Title>
      </div>
    </StillBackdrop>
  );
}
