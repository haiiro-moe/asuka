// Server-side render checks of the story player. Written without JSX (`createElement`) so the web
// tsconfig, which excludes *.test.ts, never has to know about bun:test.
import { expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { ServerWrapped, WrappedLinkResponse } from "../../../../plugins/activity/types/wrapped.ts";
import { PersonalSlideView, STORY_TITLE, STORY_WINDOW_SIZE, ServerSlideView, StoryFrame } from "./slides.tsx";
import { personalSlides, storyLabel } from "./story.ts";

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
  preview: false,
  displayName: "cakes",
  soulmateName: null,
  mostRepliedToName: null,
  topChannelName: null,
  topChannelParentName: null,
};
const server: ServerWrapped = {
  year: 2026,
  voiceReady: true,
  messages: 10,
  speakers: 2,
  voiceHours: null,
  topEmoji: [],
  unusedCustomEmoji: 0,
  topChannels: [],
  busiestHour: null,
  busiestWeekday: null,
  bestPair: null,
  bestClub: null,
  president: null,
};


function frame(preview = false): string {
  return renderToStaticMarkup(
    createElement(StoryFrame<string>, {
      label: storyLabel(2026, preview),
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

test("a preview's intro carries the preview line in subtle text, a real link's does not", () => {
  const intro = (preview: boolean) =>
    renderToStaticMarkup(createElement(PersonalSlideView, { slide: "intro", res: { ...res, preview }, cardUrl: "/card.png" }));
  expect(intro(true)).toMatch(/<p class="[^"]*text-subtle[^"]*">A preview for the admin, not sent to anyone\.<\/p>/);
  expect(intro(true)).not.toMatch(/class="[^"]*c1[^"]*">A preview/);
  expect(intro(false)).not.toContain("A preview for the admin");
});

test("a preview's server intro carries the preview line", () => {
  const html = renderToStaticMarkup(
    createElement(ServerSlideView, { slide: "intro", data: server, preview: true, cardUrl: "/card.png" }),
  );
  expect(html).toContain("A preview for the admin, not sent to anyone.");
});

test("the window label of a preview says so", () => {
  const html = frame(true);
  expect(html).toContain("fish: ~/wrapped/2026 (preview)");
  expect(frame(false)).not.toContain("(preview)");
});

test("the story page has one visually hidden, generic h1", () => {
  const html = frame();
  expect(html.match(/<h1/g)?.length).toBe(1);
  expect(html).toContain(`<h1 class="sr-only">${STORY_TITLE}</h1>`);
  expect(STORY_TITLE).not.toContain("cakes");
});

test("the 9:19.5 shape applies only on wide screens at least 800px tall", () => {
  const classes = STORY_WINDOW_SIZE.split(" ");
  const shaped = classes.filter((c) => c.includes("aspect-"));
  expect(shaped).toEqual(["desk:[@media(min-height:800px)]:aspect-[9/19.5]"]);
  expect(classes).toContain("desk:[@media(max-height:799.98px)]:w-[min(420px,100%)]");
  expect(classes).toContain("desk:[@media(max-height:799.98px)]:h-[calc(100dvh-48px)]");
  expect(classes).not.toContain("desk:w-auto");
});
