import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { RelationsBody } from "../RelationsTab.tsx";
import { sampleId, samplePairs } from "./fixtures.ts";
import { layoutGraph } from "./layout.ts";
import { NodeGraph } from "./NodeGraph.tsx";

(globalThis as { matchMedia?: unknown }).matchMedia ??= () => ({ matches: false, addEventListener() {}, removeEventListener() {} });

const LONG_ID = /\d{15,}/;
const COLOUR_LITERAL = /#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(|\b(?:red|blue|green|white|black)\b/i;
const NAMES = ["Ember", "Kite", "Moss", "Wren", "Cobalt", "Juno", "Pip", "Tarn", "Fern", "Sable", "A Rather Long Display Name"];

const pairs = samplePairs(11, 18);
const layout = layoutGraph(pairs, { width: 640 });
const named = (id: string) => NAMES[[...Array(11).keys()].findIndex((i) => sampleId(i) === id)] ?? null;

function render(nameOf: (id: string) => string | null, selected?: string | null) {
  return renderToStaticMarkup(
    createElement(NodeGraph, { layout, nameOf, word: "replies", formatWeight: (w: number) => String(w), selected, onSelect: () => {} }),
  );
}

/** The `aria-label` of every node button. */
function buttonLabels(html: string): string[] {
  return [...html.matchAll(/<button[^>]*class="fx-node[^"]*"[^>]*aria-label="([^"]*)"/g)].map((m) => m[1]!);
}

describe("NodeGraph markup", () => {
  test("nodes are real buttons with the full name as their accessible name", () => {
    const html = render(named);
    const labels = buttonLabels(html);
    expect(labels.length).toBe(layout.nodes.length);
    expect(html.match(/<button[^>]*type="button"[^>]*class="fx-node /g)?.length).toBe(layout.nodes.length);
    expect(labels.some((l) => l.startsWith("A Rather Long Display Name,"))).toBe(true);
    for (const l of labels) expect(l).toMatch(/^[A-Za-z ]+, \d+ replies, \d+ ties?$/);
    expect(html).toContain('aria-pressed="false"');
    // the visible label is shortened, the name is whole in the accessible name
    expect(html).toContain(">a rather …</span>");
  });

  test("one tab stop: a single node has tabindex 0", () => {
    const html = render(named);
    expect(html.match(/tabindex="0"/g)?.length).toBe(1);
  });

  test("the stage is a labelled group summing the graph up, described by the side panel", () => {
    const html = render(named);
    const m = html.match(/<div class="fx-graph-stage" role="group" aria-label="([^"]*)" aria-describedby="([^"]*)"/);
    expect(m).not.toBeNull();
    expect(m![1]).toContain(`who talks to whom, replies: ${layout.nodes.length} people, ${layout.edges.length} ties. strongest: `);
    expect(html).toContain(`<aside class="fx-graph-side" id="${m![2]}" aria-live="polite">`);
    expect(html).toContain('<svg class="fx-graph-edges"');
    expect(html).toContain('aria-hidden="true"');
  });

  test("no colour literals and no ids as text", () => {
    const html = render(named);
    expect(html).not.toMatch(COLOUR_LITERAL);
    expect(html).not.toMatch(LONG_ID);
    expect(html).toContain("fx-graph-legend");
  });

  test("names still loading show the neutral placeholder, never the snowflake", () => {
    const html = render(() => null);
    expect(html).not.toMatch(LONG_ID);
    expect(html).toContain('<span class="fx-node-label">···</span>');
    expect(buttonLabels(html).every((l) => l.startsWith("a member, name loading,"))).toBe(true);
  });

  test("a member the server could not resolve is an unknown member, not an id", () => {
    const html = render((id) => id);
    expect(html).not.toMatch(LONG_ID);
    expect(html).toContain("unknown member");
  });

  test("selected: pressed, outlined class, neighbours lit, others dimmed, side panel inspects", () => {
    const hub = layout.nodes[0]!;
    const html = render(named, hub.id);
    expect(html).toMatch(/class="fx-node s\d t\d sel"[^>]*aria-pressed="true"/);
    expect(html).toContain(`@ ${named(hub.id)} » inspect`);
    expect(html).toContain("closest ties");
    const tied = new Set(layout.edges.filter((e) => e.a === hub.id || e.b === hub.id).flatMap((e) => [e.a, e.b]));
    const dimCount = (html.match(/class="fx-node [^"]*\bdim\b/g) ?? []).length;
    expect(dimCount).toBe(layout.nodes.length - tied.size);
  });
});

describe("RelationsBody", () => {
  const props = { view: null, onView: () => {}, selected: null, onSelect: () => {}, onPick: () => {} };

  test("locked voice renders the unlock line only: no graph, no table, no zeros", () => {
    const html = renderToStaticMarkup(
      createElement(RelationsBody, { ...props, kind: "voice", rows: pairs, voice: { ready: false, readyAt: 1_800_000_000 } }),
    );
    expect(html).toContain("Voice stats unlock on");
    expect(html).not.toContain("fx-graph");
    expect(html).not.toContain("<table");
    expect(html).not.toContain("graph</button>");
    expect(html).not.toMatch(/\b0(\.0)?h?\b/);
  });

  test("three pairs or more open on the graph, fewer on the table", () => {
    const many = renderToStaticMarkup(createElement(RelationsBody, { ...props, kind: "replies", rows: pairs }));
    expect(many).toContain('class="fx-graph"');
    expect(many).toContain('aria-label="how to show the pairs"');
    const few = renderToStaticMarkup(createElement(RelationsBody, { ...props, kind: "replies", rows: pairs.slice(0, 2) }));
    expect(few).not.toContain("fx-graph");
    expect(few).toContain("<table");
  });

  test("ready voice draws the graph in hours", () => {
    const html = renderToStaticMarkup(
      createElement(RelationsBody, { ...props, kind: "voice", rows: pairs, voice: { ready: true, readyAt: 1 } }),
    );
    expect(html).toContain("voice time");
    expect(html).toMatch(/\d+(\.\d)?h/);
  });
});

describe("admin only", () => {
  test("no president or user page reaches the graph or the relations tab", () => {
    const root = join(import.meta.dir, "..", "..");
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const e of readdirSync(dir, { withFileTypes: true })) {
        if (e.isDirectory()) walk(join(dir, e.name));
        else if (/\.tsx?$/.test(e.name)) files.push(join(dir, e.name));
      }
    };
    walk(join(root, "president"));
    walk(join(root, "user"));
    walk(join(root, "wrapped"));
    expect(files.length).toBeGreaterThan(0);
    for (const f of files) {
      const src = readFileSync(f, "utf8");
      expect(src).not.toMatch(/admin\/graph|RelationsTab|NodeGraph|fx-graph/);
    }
    const adminPages = readFileSync(join(root, "admin", "pages.tsx"), "utf8");
    expect(adminPages).toContain('minRole: "admin"');
  });
});
