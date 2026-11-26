/**
 * The personal Wrapped story at `/wrapped/:token`: a member's year as a phone-shaped story of slides.
 * Public: no cookie session, the token is the authorisation. Reads `GET /api/activity/wrapped/t/:token`
 * (the holder's own snapshot plus resolved names) and offers the card from
 * `GET /api/activity/wrapped/t/:token/card.png`. An admin's private preview (`preview: true`) gets
 * ` (preview)` in the window label and a preview line on the intro. See docs/activity/web-wrapped.md.
 *
 * @module
 */
import type { WrappedLinkResponse } from "../../../../plugins/activity/types/wrapped.ts";
import { PersonalSlideView, StoryFrame, StoryNotice, usePublicJson } from "./slides.tsx";
import { personalSlides, storyLabel } from "./story.ts";

/** True when `v` looks like a {@link WrappedLinkResponse}. */
function isLinkResponse(v: unknown): v is WrappedLinkResponse {
  const r = v as Partial<WrappedLinkResponse> | null;
  return (
    !!r &&
    typeof r === "object" &&
    !!r.data &&
    typeof r.data.year === "number" &&
    Array.isArray(r.data.topEmoji) &&
    Array.isArray(r.data.titles) &&
    typeof r.displayName === "string"
  );
}

/**
 * The personal story page. An unknown or truncated token shows one narrator error line; a member with
 * almost nothing still gets the intro and the outro.
 *
 * @param props.token - The link token from the path.
 */
export function WrappedStory({ token }: { token: string }) {
  const base = `/api/activity/wrapped/t/${encodeURIComponent(token)}`;
  const { load, retry } = usePublicJson(base, isLinkResponse);
  if (load.state !== "ready") return <StoryNotice label="fish: ~/wrapped" load={load} retry={retry} />;
  const res = load.value;
  const cardUrl = `${base}/card.png`;
  return (
    <StoryFrame
      label={storyLabel(res.data.year, res.preview === true)}
      who={res.displayName}
      slides={personalSlides(res.data)}
      render={(slide) => <PersonalSlideView slide={slide} res={res} cardUrl={cardUrl} />}
      cardUrl={cardUrl}
      cardFile={`wrapped-${res.data.year}.png`}
    />
  );
}
