// Server-side render checks of the chart wrappers' accessible names. Written without JSX
// (`createElement`) so the web tsconfig, which excludes *.test.ts, never has to know about bun:test.
import { expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ActivityColumns, ActivityHeatmap } from "./charts.tsx";

test("a heatmap carries the label it is given and an optional hidden summary", () => {
  const html = renderToStaticMarkup(
    createElement(ActivityHeatmap, {
      rowLabels: ["mon"],
      cells: [[0, 3]],
      max: 3,
      ariaLabel: "messages by weekday and hour, utc; busiest mon 01:00",
      summary: "three messages in all",
    }),
  );
  expect(html).toContain('role="img" aria-label="messages by weekday and hour, utc; busiest mon 01:00"');
  expect(html).toContain('<p class="sr-only">three messages in all</p>');
  expect(html).not.toContain("activity heatmap");
});

test("columns carry the label they are given, and no summary unless asked", () => {
  const html = renderToStaticMarkup(createElement(ActivityColumns, { values: [1, 2], ariaLabel: "replies per week, utc" }));
  expect(html).toContain('role="img" aria-label="replies per week, utc"');
  expect(html).not.toContain("sr-only");
  expect(html).not.toContain("activity columns");
});
