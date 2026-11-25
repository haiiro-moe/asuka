import { OutlinedText, sanitizeText } from "./outlined-text.tsx";
import { randomVibrant } from "../util.ts";

export const BANNER_WIDTH = 900;
export const BANNER_HEIGHT = 160;

/**
 * Transparent-background announcement title: huge comic text in a random
 * vibrant color with a black outline, slightly tilted for energy.
 */
export function TitleBanner(props: { title: string; color?: string }) {
  const title = sanitizeText(props.title);
  // Scale down long titles so they stay on one line at 900px.
  const size = title.length > 20 ? Math.max(40, Math.round(1500 / title.length)) : 76;
  return (
    <div
      style={{
        display: "flex",
        width: "100%",
        height: "100%",
        alignItems: "center",
        justifyContent: "center",
        transform: "rotate(-2deg)",
      }}
    >
      <OutlinedText size={size} color={props.color ?? randomVibrant()} align="center">
        {title}
      </OutlinedText>
    </div>
  );
}
