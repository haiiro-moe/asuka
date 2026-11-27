/**
 * The relations graph layout: turns the relations rows (pairs of members with a weight) into the
 * positions and classes the haiiro `NodeGraph` component draws. Pure and deterministic: the same rows
 * and stage width always give the same layout (a fixed seed, no `Math.random`, no dependencies).
 *
 * The steps: cap the pairs ({@link capPairs}), give every member a size, tint and total, seed the
 * positions on rings (the busiest member in the centre, their ties around them, strongest nearest,
 * everyone else on an outer ring next to the member they are most tied to), refine with a fixed number
 * of force iterations, then place each member on the 4px grid in order of total, moving a member to the
 * nearest free cell when its tile or label would touch one already placed. When the stage is too
 * crowded to place everyone, it grows taller and the placement runs again.
 *
 * @module
 */
import type { RelationPair } from "../../../../../plugins/activity/types/admin.ts";

/** The most members the graph draws; past it the weakest pairs are left out. */
export const MAX_NODES = 60;
/** The most ties the graph draws. */
export const MAX_EDGES = 200;
/** Every node centre sits on this grid, so edges land on whole pixels. */
export const GRID = 4;
/** Space between the stage frame and any tile or label. */
export const PAD = 16;
/** The longest node label in characters, ellipsis included; longer names are shortened. */
export const LABEL_CHARS = 10;
/** Width of one IBM VGA character at 16px. */
const CHAR_W = 8;
/** Half the width of the widest label band (characters plus the 4px padding each side). */
export const LABEL_HALF = (LABEL_CHARS * CHAR_W + 8) / 2;
/** The label band's height under a tile (16px IBM at line-height 1.15, rounded up). */
export const LABEL_H = 20;
/** The gap between the tile and its label (the component's `top: calc(var(--r) + 4px)`). */
export const LABEL_GAP = 4;
/** The least free space between two members' boxes (tile plus label). */
export const NODE_GAP = 4;
/** Force iterations; fixed, so the run time is bounded and the result repeatable. */
export const ITERATIONS = 300;
/** The shortest stage the layout returns. */
export const MIN_HEIGHT = 400;
/** The share of the stage the boxes are assumed to fill when picking the first height; the stage grows when they do not fit. */
const PACKING = 0.6;
/** How much taller the stage gets on each retry when the members do not fit. */
const GROW = 64;
/** Placement retries before the layout gives up growing (it never returns overlaps; see below). */
const MAX_GROW = 24;

/** Tile size class: `s1` 16px, `s2` 32px, `s3` 48px. */
export type SizeClass = 1 | 2 | 3;
/** Edge weight class: `w1` lowest quarter of the period's weights … `w4` top quarter. */
export type WeightClass = 1 | 2 | 3 | 4;
/** Placeholder tint of a tile: `t1` iris, `t2` rose, `t3` foam, `t4` gold. Carries no meaning. */
export type TintClass = 1 | 2 | 3 | 4;

/** Half the tile of each size class (the component's `--r`). */
export const TILE_HALF: Record<SizeClass, number> = { 1: 8, 2: 16, 3: 24 };

/** One member on the stage. */
export interface GraphNode {
  /** The member's id. */
  id: string;
  /** Centre, px from the stage's left edge, a multiple of {@link GRID}. */
  x: number;
  /** Centre, px from the stage's top edge, a multiple of {@link GRID}. */
  y: number;
  /** Tile size class, from the member's total weight tier ({@link sizeClasses}). */
  size: SizeClass;
  /** Tint class, from a hash of the id ({@link tintOf}). */
  tint: TintClass;
  /** Sum of the weights of the member's drawn ties. */
  total: number;
  /** How many drawn ties the member has. */
  ties: number;
}

/** One tie on the stage. */
export interface GraphEdge {
  /** One member (as the row had it). */
  a: string;
  /** The other member. */
  b: string;
  /** The raw weight: replies, mentions or seconds together in voice. */
  weight: number;
  /** Weight class from the quartiles of the drawn weights ({@link weightClasses}). */
  w: WeightClass;
}

/** What {@link layoutGraph} returns. */
export interface GraphLayout {
  /** Stage width in px (the width asked for). */
  width: number;
  /** Stage height in px; at least {@link MIN_HEIGHT}, taller when the members need it. */
  height: number;
  /** Members, busiest first. */
  nodes: GraphNode[];
  /** Ties, strongest first. */
  edges: GraphEdge[];
  /** Pairs drawn. */
  shown: number;
  /** Pairs in the input (self-pairs and duplicates left out). */
  total: number;
}

/** What {@link capPairs} returns. */
export interface CappedPairs {
  /** The pairs kept, strongest first. */
  kept: RelationPair[];
  /** Pairs in the input after dropping self-pairs and repeated pairs. */
  total: number;
}

/** Strongest first; ties broken by ids so the order never depends on the input order. */
function byWeight(x: RelationPair, y: RelationPair): number {
  return y.weight - x.weight || cmp(x.a, y.a) || cmp(x.b, y.b);
}

/** Plain string order (not locale order, which may differ between machines). */
function cmp(x: string, y: string): number {
  return x < y ? -1 : x > y ? 1 : 0;
}

/** The pair's key with both directions folded together. */
function pairKey(p: RelationPair): string {
  return p.a < p.b ? `${p.a}\u0000${p.b}` : `${p.b}\u0000${p.a}`;
}

/**
 * Keeps the strongest pairs that fit in {@link MAX_NODES} members and {@link MAX_EDGES} ties. Pairs
 * are taken strongest first; a pair that would bring in a member past the cap is skipped, while a
 * later pair between members already in is still kept. Self-pairs, repeated pairs and pairs with no
 * positive weight are dropped.
 *
 * @param pairs - The relations rows, in any order.
 * @param maxNodes - The member cap (default {@link MAX_NODES}).
 * @param maxEdges - The tie cap (default {@link MAX_EDGES}).
 */
export function capPairs(pairs: RelationPair[], maxNodes = MAX_NODES, maxEdges = MAX_EDGES): CappedPairs {
  const seen = new Set<string>();
  const clean: RelationPair[] = [];
  for (const p of [...pairs].sort(byWeight)) {
    if (p.a === p.b || !(p.weight > 0)) continue;
    const key = pairKey(p);
    if (seen.has(key)) continue;
    seen.add(key);
    clean.push(p);
  }
  const members = new Set<string>();
  const kept: RelationPair[] = [];
  for (const p of clean) {
    if (kept.length >= maxEdges) break;
    const fresh = (members.has(p.a) ? 0 : 1) + (members.has(p.b) ? 0 : 1);
    if (members.size + fresh > maxNodes) continue;
    members.add(p.a);
    members.add(p.b);
    kept.push(p);
  }
  return { kept, total: clean.length };
}

/**
 * The narrator line under the stage when pairs were left out: `showing the strongest 48 of 50 pairs.`;
 * null when every pair is drawn.
 *
 * @param shown - Pairs drawn.
 * @param total - Pairs in the input.
 */
export function capLine(shown: number, total: number): string | null {
  return shown < total ? `showing the strongest ${shown} of ${total} pairs.` : null;
}

/**
 * Weight classes from the quartiles of the given weights, so a quiet period still has a top step: a
 * weight's class is `1 + floor(4 * i / n)` where `i` is the index of its first occurrence in the
 * weights sorted from low to high (equal weights share a class).
 *
 * @param weights - The drawn weights, in any order.
 * @returns The class of each weight, in the input's order.
 */
export function weightClasses(weights: number[]): WeightClass[] {
  const sorted = [...weights].sort((p, q) => p - q);
  const first = new Map<number, number>();
  sorted.forEach((w, i) => {
    if (!first.has(w)) first.set(w, i);
  });
  return weights.map((w) => Math.min(4, 1 + Math.floor(((first.get(w) ?? 0) * 4) / sorted.length)) as WeightClass);
}

/**
 * Size classes from tiers of each member's total weight: `s3` for totals at or above the 80th
 * percentile (the top fifth), `s2` at or above the median, `s1` below. Equal totals share a class.
 *
 * @param totals - Each member's total weight.
 * @returns The class per member id.
 */
export function sizeClasses(totals: Map<string, number>): Map<string, SizeClass> {
  const sorted = [...totals.values()].sort((p, q) => p - q);
  const at = (q: number) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] ?? 0;
  const top = at(0.8);
  const mid = at(0.5);
  const out = new Map<string, SizeClass>();
  for (const [id, t] of totals) out.set(id, t >= top ? 3 : t >= mid ? 2 : 1);
  return out;
}

/** The size tiers in words, for the legend, in class order. */
export const SIZE_WORDS: Record<SizeClass, string> = { 1: "lower half", 2: "upper half", 3: "top fifth" };

/**
 * A 32-bit FNV-1a hash of a string.
 *
 * @param s - Any string.
 */
export function hash32(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/**
 * The tint of a member's tile, from a hash of the id, so a member keeps their tint across periods and
 * kinds.
 *
 * @param id - The member's id.
 */
export function tintOf(id: string): TintClass {
  return ((hash32(id) % 4) + 1) as TintClass;
}

/** A small seeded generator (mulberry32); the layout's only source of jitter. */
function seeded(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Snaps a coordinate to the {@link GRID}.
 *
 * @param v - Any coordinate.
 */
export function snap(v: number): number {
  return Math.round(v / GRID) * GRID;
}

/** A member's box (tile plus label band), relative to its centre. */
export interface NodeBox {
  /** Left edge. */
  left: number;
  /** Right edge. */
  right: number;
  /** Top edge (the tile's top). */
  top: number;
  /** Bottom edge (the label band's bottom). */
  bottom: number;
}

/**
 * The box a member takes on the stage: the tile, and the label hanging under it at its widest
 * ({@link LABEL_CHARS} characters), so two members never touch whatever their names turn out to be.
 *
 * @param x - Centre x.
 * @param y - Centre y.
 * @param size - The size class.
 */
export function nodeBox(x: number, y: number, size: SizeClass): NodeBox {
  const r = TILE_HALF[size];
  const half = Math.max(r, LABEL_HALF);
  return { left: x - half, right: x + half, top: y - r, bottom: y + r + LABEL_GAP + LABEL_H };
}

/**
 * True when two boxes are closer than {@link NODE_GAP}.
 *
 * @param p - One box.
 * @param q - The other.
 */
export function boxesTouch(p: NodeBox, q: NodeBox): boolean {
  return p.left < q.right + NODE_GAP && q.left < p.right + NODE_GAP && p.top < q.bottom + NODE_GAP && q.top < p.bottom + NODE_GAP;
}

/** The range a centre may take so the whole box stays inside the stage and its padding. */
function bounds(size: SizeClass, width: number, height: number) {
  const r = TILE_HALF[size];
  const half = Math.max(r, LABEL_HALF);
  return {
    minX: Math.ceil((PAD + half) / GRID) * GRID,
    maxX: Math.floor((width - PAD - half) / GRID) * GRID,
    minY: Math.ceil((PAD + r) / GRID) * GRID,
    maxY: Math.floor((height - PAD - r - LABEL_GAP - LABEL_H) / GRID) * GRID,
  };
}

/** The stage height to start from: enough room for every box at {@link PACKING}. */
function startHeight(sizes: SizeClass[], width: number, minHeight: number): number {
  const usable = Math.max(1, width - 2 * PAD);
  const area = sizes.reduce((s, z) => s + (2 * Math.max(TILE_HALF[z], LABEL_HALF) + NODE_GAP) * (2 * TILE_HALF[z] + LABEL_GAP + LABEL_H + NODE_GAP), 0);
  return Math.max(minHeight, Math.ceil((area / PACKING / usable + 2 * PAD) / GRID) * GRID);
}

/** Options of {@link layoutGraph}. */
export interface LayoutOptions {
  /** Stage width in px. */
  width: number;
  /** Shortest stage height (default {@link MIN_HEIGHT}). */
  minHeight?: number;
  /** Member cap (default {@link MAX_NODES}). */
  maxNodes?: number;
  /** Tie cap (default {@link MAX_EDGES}). */
  maxEdges?: number;
}

/**
 * Lays out the relations graph. See the module comment for the steps.
 *
 * @param pairs - The relations rows (`GET /api/activity/admin/relations`), in any order.
 * @param options - Stage width, and optional minimum height and caps.
 */
export function layoutGraph(pairs: RelationPair[], options: LayoutOptions): GraphLayout {
  const width = Math.max(2 * (PAD + LABEL_HALF) + GRID, Math.floor(options.width / GRID) * GRID);
  const minHeight = Math.max(MIN_HEIGHT, snap(options.minHeight ?? MIN_HEIGHT));
  const { kept, total } = capPairs(pairs, options.maxNodes ?? MAX_NODES, options.maxEdges ?? MAX_EDGES);
  if (kept.length === 0) return { width, height: minHeight, nodes: [], edges: [], shown: 0, total };

  // members, busiest first
  const totals = new Map<string, number>();
  const ties = new Map<string, number>();
  const adj = new Map<string, Map<string, number>>();
  for (const p of kept) {
    for (const [u, v] of [
      [p.a, p.b],
      [p.b, p.a],
    ] as const) {
      totals.set(u, (totals.get(u) ?? 0) + p.weight);
      ties.set(u, (ties.get(u) ?? 0) + 1);
      const m = adj.get(u) ?? new Map<string, number>();
      m.set(v, (m.get(v) ?? 0) + p.weight);
      adj.set(u, m);
    }
  }
  const ids = [...totals.keys()].sort((x, y) => totals.get(y)! - totals.get(x)! || cmp(x, y));
  const sizes = sizeClasses(totals);
  const index = new Map(ids.map((id, i) => [id, i]));
  const maxW = kept[0]!.weight;
  const links = kept.map((p) => ({ i: index.get(p.a)!, j: index.get(p.b)!, s: 0.4 + 0.6 * (p.weight / maxW) }));
  const sizeOf = ids.map((id) => sizes.get(id)!);

  let height = startHeight(sizeOf, width, minHeight);
  let placed: { x: number; y: number }[] | null = null;
  for (let attempt = 0; attempt <= MAX_GROW && !placed; attempt++) {
    const rough = forceLayout(ids, adj, links, width, height, hash32(ids.join(",")));
    placed = place(rough, sizeOf, width, height);
    if (!placed) height += GROW;
  }
  // Past MAX_GROW (never reached within the caps) fall back to a plain grid, which cannot overlap.
  if (!placed) ({ placed, height } = gridFallback(sizeOf, width));

  const nodes: GraphNode[] = ids.map((id, i) => ({
    id,
    x: placed![i]!.x,
    y: placed![i]!.y,
    size: sizeOf[i]!,
    tint: tintOf(id),
    total: totals.get(id)!,
    ties: ties.get(id)!,
  }));
  const classes = weightClasses(kept.map((p) => p.weight));
  const edges: GraphEdge[] = kept.map((p, k) => ({ a: p.a, b: p.b, weight: p.weight, w: classes[k]! }));
  return { width, height, nodes, edges, shown: kept.length, total };
}

/**
 * Seeds positions on rings and refines them with {@link ITERATIONS} Fruchterman-Reingold steps.
 * Coordinates are unsnapped and may overlap; {@link place} fixes both.
 */
function forceLayout(
  ids: string[],
  adj: Map<string, Map<string, number>>,
  links: { i: number; j: number; s: number }[],
  width: number,
  height: number,
  seed: number,
): { x: number; y: number }[] {
  const n = ids.length;
  const rand = seeded(seed);
  const cx = width / 2;
  const cy = height / 2;
  const rx = (width - 2 * (PAD + LABEL_HALF)) / 2;
  const ry = (height - 2 * PAD - 48) / 2;
  const pos: { x: number; y: number }[] = new Array(n);
  const angle: number[] = new Array(n).fill(0);
  const done = new Set<number>();
  const index = new Map(ids.map((id, i) => [id, i]));

  // the hub in the centre, its ties on an inner ring, strongest first
  pos[0] = { x: cx, y: cy };
  done.add(0);
  const hubTies = [...(adj.get(ids[0]!) ?? new Map<string, number>()).entries()].sort((p, q) => q[1] - p[1] || cmp(p[0], q[0]));
  hubTies.forEach(([id], k) => {
    const i = index.get(id)!;
    const a = (2 * Math.PI * k) / hubTies.length - Math.PI / 2;
    angle[i] = a;
    pos[i] = { x: cx + 0.45 * rx * Math.cos(a), y: cy + 0.45 * ry * Math.sin(a) };
    done.add(i);
  });
  // everyone else: next to the placed member they are most tied to, on the outer ring
  let lone = 0;
  while (done.size < n) {
    let best = -1;
    let bestW = 0;
    let anchor = -1;
    for (let i = 0; i < n; i++) {
      if (done.has(i)) continue;
      for (const [id, w] of adj.get(ids[i]!) ?? []) {
        const j = index.get(id)!;
        if (done.has(j) && w > bestW) {
          best = i;
          bestW = w;
          anchor = j;
        }
      }
    }
    if (best < 0) {
      // a member of a part not tied to anything placed yet: spread these around the outer ring
      best = [...Array(n).keys()].find((i) => !done.has(i))!;
      angle[best] = 2 * Math.PI * (0.13 + 0.37 * lone++) + rand() * 0.2;
    } else {
      angle[best] = angle[anchor]! + (rand() - 0.5) * 0.8;
    }
    const a = angle[best]!;
    pos[best] = { x: cx + 0.85 * rx * Math.cos(a), y: cy + 0.85 * ry * Math.sin(a) };
    done.add(best);
  }

  // refine: repulsion between all, attraction along ties (stronger ties pull harder), a little gravity.
  // Distances are measured with x squeezed, since boxes are wider than tall.
  const SX = 0.6;
  const k = Math.sqrt((width * SX * height) / n) * 0.75;
  let temp = Math.max(width, height) / 8;
  const cool = temp / (ITERATIONS + 1);
  const disp = pos.map(() => ({ x: 0, y: 0 }));
  for (let it = 0; it < ITERATIONS; it++) {
    for (const d of disp) {
      d.x = 0;
      d.y = 0;
    }
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        let dx = (pos[i]!.x - pos[j]!.x) * SX;
        let dy = pos[i]!.y - pos[j]!.y;
        let d2 = dx * dx + dy * dy;
        if (d2 < 0.01) {
          dx = (i - j) * 0.1;
          dy = 0.1;
          d2 = dx * dx + dy * dy;
        }
        const f = (k * k) / d2;
        disp[i]!.x += dx * f;
        disp[i]!.y += dy * f;
        disp[j]!.x -= dx * f;
        disp[j]!.y -= dy * f;
      }
    }
    for (const { i, j, s } of links) {
      const dx = (pos[i]!.x - pos[j]!.x) * SX;
      const dy = pos[i]!.y - pos[j]!.y;
      const d = Math.sqrt(dx * dx + dy * dy) || 0.01;
      const f = (d / k) * s;
      disp[i]!.x -= dx * f;
      disp[i]!.y -= dy * f;
      disp[j]!.x += dx * f;
      disp[j]!.y += dy * f;
    }
    for (let i = 0; i < n; i++) {
      const p = pos[i]!;
      const d = disp[i]!;
      d.x = d.x / SX - (p.x - cx) * 0.02;
      d.y -= (p.y - cy) * 0.03;
      const len = Math.sqrt(d.x * d.x + d.y * d.y) || 1;
      const step = Math.min(len, temp);
      p.x = Math.min(cx + rx, Math.max(cx - rx, p.x + (d.x / len) * step));
      p.y = Math.min(cy + ry, Math.max(cy - ry, p.y + (d.y / len) * step));
    }
    temp -= cool;
  }
  return pos;
}

/**
 * Places members busiest first on the grid: at their snapped spot when it is free, else at the nearest
 * free cell (searched in growing square rings, nearest by straight distance within a ring). Returns
 * null when someone finds no free cell inside the stage.
 */
function place(rough: { x: number; y: number }[], sizes: SizeClass[], width: number, height: number): { x: number; y: number }[] | null {
  const out: { x: number; y: number }[] = [];
  const boxes: NodeBox[] = [];
  const free = (x: number, y: number, size: SizeClass) => {
    const b = nodeBox(x, y, size);
    return boxes.every((o) => !boxesTouch(b, o));
  };
  const reach = Math.max(width, height);
  for (let i = 0; i < rough.length; i++) {
    const size = sizes[i]!;
    const lim = bounds(size, width, height);
    if (lim.maxX < lim.minX || lim.maxY < lim.minY) return null;
    const clampX = (v: number) => Math.min(lim.maxX, Math.max(lim.minX, v));
    const clampY = (v: number) => Math.min(lim.maxY, Math.max(lim.minY, v));
    const tx = clampX(snap(rough[i]!.x));
    const ty = clampY(snap(rough[i]!.y));
    let spot: { x: number; y: number } | null = free(tx, ty, size) ? { x: tx, y: ty } : null;
    const STEP = 2 * GRID;
    for (let r = STEP; !spot && r <= reach; r += STEP) {
      let bestD = Infinity;
      for (let dx = -r; dx <= r; dx += STEP) {
        for (let dy = -r; dy <= r; dy += STEP) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
          const x = tx + dx;
          const y = ty + dy;
          if (x < lim.minX || x > lim.maxX || y < lim.minY || y > lim.maxY) continue;
          const d = dx * dx + dy * dy;
          if (d < bestD && free(x, y, size)) {
            bestD = d;
            spot = { x, y };
          }
        }
      }
    }
    if (!spot) return null;
    out.push(spot);
    boxes.push(nodeBox(spot.x, spot.y, size));
  }
  return out;
}

/** Members in rows of equal cells, busiest first; the last resort, which never overlaps. */
function gridFallback(sizes: SizeClass[], width: number): { placed: { x: number; y: number }[]; height: number } {
  const cellW = 2 * LABEL_HALF + NODE_GAP + GRID;
  const cellH = 2 * TILE_HALF[3] + LABEL_GAP + LABEL_H + NODE_GAP + GRID;
  const cols = Math.max(1, Math.floor((width - 2 * PAD) / cellW));
  const placed = sizes.map((_, i) => ({
    x: snap(PAD + LABEL_HALF + (i % cols) * cellW + GRID),
    y: snap(PAD + TILE_HALF[3] + Math.floor(i / cols) * cellH + GRID),
  }));
  const rows = Math.ceil(sizes.length / cols);
  return { placed, height: Math.max(MIN_HEIGHT, snap(2 * PAD + rows * cellH + GRID)) };
}
