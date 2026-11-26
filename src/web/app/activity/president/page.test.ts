import { expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ClubsBody, ConnectionPage, EngagementBody } from "./ConnectionPage.tsx";

(globalThis as { matchMedia?: unknown }).matchMedia ??= () => ({ matches: false, addEventListener() {}, removeEventListener() {} });

const NAME_LIKE = /alice|bob|carol|@|avatar|<img|\bid=|title=|alt=/i;
const LONG_ID = /\d{15,}/;

test("the page has the engagement and clubs sections, each with its own state line", () => {
  const html = renderToStaticMarkup(createElement(ConnectionPage));
  expect(html).toContain("engagement");
  expect(html).toContain("clubs and events");
  expect(html).not.toMatch(LONG_ID);
});

test("section bodies draw numbers only: no ids, names, images or titles", () => {
  const voice = { ready: false, readyAt: 1_800_000_000 };
  const parts = [
    renderToStaticMarkup(
      createElement(EngagementBody, {
        period: "week",
        data: { messages: 120, activeMembers: null, voiceHours: null },
        voice,
        voiceFailed: false,
      }),
    ),
    renderToStaticMarkup(
      createElement(ClubsBody, {
        period: "term",
        data: { clubsActive: null, clubsQuiet: null, eventsHeld: 0, avgAttendance: 0 },
      }),
    ),
  ];
  for (const html of parts) {
    expect(html).not.toMatch(LONG_ID);
    expect(html).not.toMatch(NAME_LIKE);
  }
  expect(parts[0]).toContain("voice stats unlock on");
  expect(parts[0]).toContain("off");
  expect(parts[1]).toContain("per event");
});
