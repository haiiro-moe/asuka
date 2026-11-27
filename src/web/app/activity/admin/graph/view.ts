/**
 * Pure helpers of the relations graph view: which view opens first, node labels, the keyboard's
 * nearest-neighbour move, the focus neighbourhood, the side panel's tie lists and the stage summary.
 *
 * @module
 */
import { LABEL_CHARS, type GraphEdge, type GraphNode } from "./layout.ts";

/** The two ways the relations tab shows the pairs. */
export type RelationsView = "graph" | "table";

/** Pairs needed before the graph is the first view; fewer read better as a table. */
export const GRAPH_MIN_PAIRS = 3;

/**
 * The view the tab opens on when the admin has not picked one: the graph from
 * {@link GRAPH_MIN_PAIRS} pairs up, the table below that.
 *
 * @param pairs - How many pairs the period has.
 */
export function defaultView(pairs: number): RelationsView {
  return pairs >= GRAPH_MIN_PAIRS ? "graph" : "table";
}

/** What a node label shows while the member's name is still being read. */
export const NAME_PLACEHOLDER = "···";

/** Code point ranges drawn two cells wide (Unifont's wide glyphs: CJK, Hangul, fullwidth forms). */
const WIDE: [number, number][] = [
  [0x1100, 0x115f],
  [0x2e80, 0xa4cf],
  [0xac00, 0xd7a3],
  [0xf900, 0xfaff],
  [0xfe30, 0xfe4f],
  [0xff00, 0xff60],
  [0xffe0, 0xffe6],
  [0x1f300, 0x1faff],
  [0x20000, 0x3fffd],
];

/**
 * How many 8px cells a character takes in the bitmap fonts: 2 for wide glyphs, 1 otherwise.
 *
 * @param ch - One character (a code point).
 */
export function cellWidth(ch: string): 1 | 2 {
  const c = ch.codePointAt(0) ?? 0;
  return WIDE.some(([lo, hi]) => c >= lo && c <= hi) ? 2 : 1;
}

/**
 * A node label: the name in lowercase, shortened with an ellipsis to fit `max` cells (a wide
 * character takes two; cut by code point, so never inside a character). The full name stays in the
 * side panel and the button's accessible name.
 *
 * @param name - The display name; null while it loads (gives {@link NAME_PLACEHOLDER}).
 * @param max - The widest label in 8px cells, ellipsis included (default {@link LABEL_CHARS}).
 */
export function shortLabel(name: string | null, max = LABEL_CHARS): string {
  if (name == null) return NAME_PLACEHOLDER;
  const chars = Array.from(name.trim().toLowerCase());
  if (chars.length === 0) return NAME_PLACEHOLDER;
  const width = chars.reduce((s, ch) => s + cellWidth(ch), 0);
  if (width <= max) return chars.join("");
  let used = 1;
  let out = "";
  for (const ch of chars) {
    if (used + cellWidth(ch) > max) break;
    used += cellWidth(ch);
    out += ch;
  }
  return `${out}…`;
}

/** An arrow key's direction on the stage. */
export type Direction = "left" | "right" | "up" | "down";

/** The direction of an arrow key, or null for any other key. */
export function arrowDirection(key: string): Direction | null {
  return key === "ArrowLeft" ? "left" : key === "ArrowRight" ? "right" : key === "ArrowUp" ? "up" : key === "ArrowDown" ? "down" : null;
}

const STEP: Record<Direction, [number, number]> = { left: [-1, 0], right: [1, 0], up: [0, -1], down: [0, 1] };

/**
 * The nearest member in a direction, for the arrow keys: among members strictly that way, the one with
 * the least distance along the direction plus twice the distance across it (so the move stays near
 * the line). Ties go to the earlier member. Null when nobody is that way.
 *
 * @param nodes - Members with their centres.
 * @param fromId - The member that has focus.
 * @param dir - The arrow's direction.
 */
export function nearestInDirection(nodes: Pick<GraphNode, "id" | "x" | "y">[], fromId: string, dir: Direction): string | null {
  const from = nodes.find((n) => n.id === fromId);
  if (!from) return null;
  const [sx, sy] = STEP[dir];
  let best: string | null = null;
  let score = Infinity;
  for (const n of nodes) {
    if (n.id === fromId) continue;
    const dx = n.x - from.x;
    const dy = n.y - from.y;
    const along = dx * sx + dy * sy;
    if (along <= 0) continue;
    const s = along + 2 * Math.abs(dx * sy + dy * sx);
    if (s < score) {
      score = s;
      best = n.id;
    }
  }
  return best;
}

/**
 * Members in reading order (top to bottom, then left to right): the DOM and tab order of the nodes.
 *
 * @param nodes - Members with their centres.
 */
export function readingOrder<T extends Pick<GraphNode, "id" | "x" | "y">>(nodes: T[]): T[] {
  return [...nodes].sort((p, q) => p.y - q.y || p.x - q.x || (p.id < q.id ? -1 : 1));
}

/**
 * The members that stay lit around a focus: the focus and everyone tied to it. Null when nothing has
 * focus (nobody is dimmed).
 *
 * @param edges - The drawn ties.
 * @param focus - The selected or hovered member, or null.
 */
export function litSet(edges: Pick<GraphEdge, "a" | "b">[], focus: string | null): Set<string> | null {
  if (focus == null) return null;
  const lit = new Set([focus]);
  for (const e of edges) {
    if (e.a === focus) lit.add(e.b);
    else if (e.b === focus) lit.add(e.a);
  }
  return lit;
}

/** One of a member's ties, for the side panel. */
export interface Tie {
  /** The other member. */
  id: string;
  /** The tie's raw weight. */
  weight: number;
}

/**
 * A member's ties, strongest first (ids break ties).
 *
 * @param edges - The drawn ties.
 * @param id - The member.
 */
export function tiesOf(edges: Pick<GraphEdge, "a" | "b" | "weight">[], id: string): Tie[] {
  return edges
    .filter((e) => e.a === id || e.b === id)
    .map((e) => ({ id: e.a === id ? e.b : e.a, weight: e.weight }))
    .sort((p, q) => q.weight - p.weight || (p.id < q.id ? -1 : 1));
}

/** Props of {@link graphAriaLabel}. */
export interface GraphSummary {
  /** What a tie counts, in words: `replies`, `mentions`, `voice time`. */
  word: string;
  /** Members drawn. */
  people: number;
  /** Ties drawn. */
  ties: number;
  /** The strongest tie's two names and its weight in words, or null for none. */
  strongest: { a: string; b: string; value: string } | null;
}

/**
 * The stage's `aria-label`: the relation, how many people and ties, the strongest tie, and where the
 * text alternative is.
 *
 * @param s - See {@link GraphSummary}.
 */
export function graphAriaLabel(s: GraphSummary): string {
  const people = `${s.people} ${s.people === 1 ? "person" : "people"}`;
  const ties = `${s.ties} ${s.ties === 1 ? "tie" : "ties"}`;
  const top = s.strongest ? ` strongest: ${s.strongest.a} and ${s.strongest.b}, ${s.strongest.value}.` : "";
  return `who talks to whom, ${s.word}: ${people}, ${ties}.${top} the ties are listed beside the graph.`;
}
