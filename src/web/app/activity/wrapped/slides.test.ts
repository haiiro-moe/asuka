// Server-side render checks of the story player. Written without JSX (`createElement`) so the web
// tsconfig, which excludes *.test.ts, never has to know about bun:test.
import { expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { WrappedLinkResponse } from "../../../../plugins/activity/types/wrapped.ts";
import { PersonalSlideView, StoryFrame } from "./slides.tsx";
import { personalSlides } from "./story.ts";

// useReducedMotion reads matchMedia during render; give the server render a quiet one.
(globalThis as { matchMedia?: unknown }).matchMedia = () => ({
  matches: false,
  addEventListener() {},
  removeEventListener() {},
});

const res: WrappedLinkResponse = {
  data: {
    year: 2026,
    messages: 1200,
    voiceHours: 40,
    topEmoji: [],
    busiestHour: 21,
    busiestDay: "tuesday",
    soulmateId: null,
    mostRepliedToId: null,
    topChannelId: null,
    xpLevel: 3,
    club: null,
    presidency: {
      terms: 2,
      daysInOffice: 120,
      votes: 40,
      votePercent: 62,
      messagesInOffice: 900,
      perDay: 7.5,
      serverActivityPercent: 12,
      topEmojiInOffice: null,
    },
    titles: Array.from({ length: 7 }, (_, i) => ({ key: `t${i}`, label: `title ${i}`, detail: "1st of 9" })),
    voiceReady: true,
  },
  voiceReady: true,
  displayName: "cakes",
  soulmateName: null,
  mostRepliedToName: null,
  topChannelName: null,
  topChannelParentName: null,
};

function frame(): string {
  return renderToStaticMarkup(
    createElement(StoryFrame<string>, {
      label: "fish: ~/wrapped/2026",
      who: "cakes",
      slides: personalSlides(res.data),
      render: (slide: string) => createElement(PersonalSlideView, { slide, res, cardUrl: "/card.png" }),
      cardUrl: "/card.png",
      cardFile: "wrapped-2026.png",
    }),
  );
}

test("the slide sits in a vertical scroll container", () => {
  const html = frame();
  expect(html).toContain("data-slide-scroll");
  expect(html).toMatch(/data-slide-scroll[^>]*overflow-y-auto|overflow-y-auto[^>]*data-slide-scroll/);
  expect(html).toContain("overscroll-contain");
});

test("prev and next are real, labelled, focusable buttons", () => {
  const html = frame();
  expect(html).toMatch(/<button[^>]*aria-label="previous slide"/);
  expect(html).toMatch(/<button[^>]*aria-label="next slide"/);
  expect(html).not.toMatch(/<button[^>]*aria-label="(previous|next) slide"[^>]*tabindex="-1"/);
});

test("a tall titles slide shows four titles and an `and n more` line", () => {
  const html = renderToStaticMarkup(createElement(PersonalSlideView, { slide: "titles", res, cardUrl: "/card.png" }));
  expect(html.match(/★/g)?.length).toBe(4);
  expect(html).toContain("and 3 more");
});
