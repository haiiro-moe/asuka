/**
 * The server Wrapped story at `/wrapped/s/:token`: the whole server's year as a phone-shaped story of
 * slides. Public: no cookie session, the token is the authorisation. Reads
 * `GET /api/activity/wrapped/s/:token` (`{ data }`) and offers the card from
 * `GET /api/activity/wrapped/s/:token/card.png`. An admin's private preview (`preview: true`) gets
 * ` (preview)` in the window label and a preview line on the intro. See docs/activity/web-wrapped.md.
 *
 * @module
 */
import type { ServerWrappedResponse } from "../../../../plugins/activity/types/wrapped.ts";
import { ServerSlideView, StoryFrame, StoryNotice, usePublicJson } from "./slides.tsx";
import { serverSlides, storyLabel } from "./story.ts";

/** True when `v` looks like a {@link ServerWrappedResponse}. */
function isServerResponse(v: unknown): v is ServerWrappedResponse {
  const r = v as Partial<ServerWrappedResponse> | null;
  return (
    !!r &&
    typeof r === "object" &&
    !!r.data &&
    typeof r.data.year === "number" &&
    Array.isArray(r.data.topEmoji) &&
    Array.isArray(r.data.topChannels)
  );
}

/**
 * The server story page: intro, totals, emoji, channels, rhythm, the best pair, the best club, the
 * president and the outro (pair, club and president only when present). An unknown or truncated token
 * shows one narrator error line.
 *
 * @param props.token - The server token from the path.
 */
export function WrappedServerStory({ token }: { token: string }) {
  const base = `/api/activity/wrapped/s/${encodeURIComponent(token)}`;
  const { load, retry } = usePublicJson(base, isServerResponse);
  if (load.state !== "ready") return <StoryNotice label="fish: ~/wrapped/server" load={load} retry={retry} />;
  const data = load.value.data;
  const preview = load.value.preview === true;
  const cardUrl = `${base}/card.png`;
  return (
    <StoryFrame
      label={storyLabel(data.year, preview, "server")}
      who="server"
      slides={serverSlides(data)}
      render={(slide) => <ServerSlideView slide={slide} data={data} preview={preview} cardUrl={cardUrl} />}
      cardUrl={cardUrl}
      cardFile={`wrapped-server-${data.year}.png`}
    />
  );
}
