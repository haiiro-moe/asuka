import { describe, expect, test } from "bun:test";
import type { RelationPair } from "../../../../../plugins/activity/types/admin.ts";
import {
  GRID,
  LABEL_GAP,
  LABEL_H,
  LABEL_HALF,
  MAX_EDGES,
  MAX_NODES,
  PAD,
  TILE_HALF,
  boxesTouch,
  capLine,
  capPairs,
  layoutGraph,
  nodeBox,
  sizeClasses,
  tintOf,
  weightClasses,
  type GraphLayout,
} from "./layout.ts";
import { sampleId as id, samplePairs } from "./fixtures.ts";

function checkLayout(l: GraphLayout) {
  const ids = new Set(l.nodes.map((n) => n.id));
  for (const e of l.edges) {
    expect(ids.has(e.a)).toBe(true);
    expect(ids.has(e.b)).toBe(true);
  }
  for (const n of l.nodes) {
    expect(n.x % GRID).toBe(0);
    expect(n.y % GRID).toBe(0);
    const b = nodeBox(n.x, n.y, n.size);
    expect(b.left).toBeGreaterThanOrEqual(PAD);
    expect(b.top).toBeGreaterThanOrEqual(PAD);
    expect(b.right).toBeLessThanOrEqual(l.width - PAD);
    expect(b.bottom).toBeLessThanOrEqual(l.height - PAD);
  }
  for (let i = 0; i < l.nodes.length; i++) {
    for (let j = i + 1; j < l.nodes.length; j++) {
      const p = l.nodes[i]!;
      const q = l.nodes[j]!;
      expect(boxesTouch(nodeBox(p.x, p.y, p.size), nodeBox(q.x, q.y, q.size))).toBe(false);
    }
  }
}

describe("layoutGraph", () => {
  test("empty input gives an empty stage", () => {
    const l = layoutGraph([], { width: 640 });
    expect(l.nodes).toEqual([]);
    expect(l.edges).toEqual([]);
    expect(l.shown).toBe(0);
    expect(l.total).toBe(0);
    expect(l.height).toBeGreaterThanOrEqual(400);
  });

  test("is deterministic: same input, same output, whatever the input order", () => {
    const pairs = samplePairs(20, 40);
    const a = layoutGraph(pairs, { width: 640 });
    const b = layoutGraph(pairs, { width: 640 });
    const c = layoutGraph([...pairs].reverse(), { width: 640 });
    expect(b).toEqual(a);
    expect(c).toEqual(a);
  });

  test("never calls Math.random", () => {
    const real = Math.random;
    Math.random = () => {
      throw new Error("Math.random was called");
    };
    try {
      expect(() => layoutGraph(samplePairs(30, 50), { width: 640 })).not.toThrow();
    } finally {
      Math.random = real;
    }
  });

  test("a single pair: two members inside the stage, apart, on the grid", () => {
    const l = layoutGraph([{ a: "1", b: "2", weight: 5 }], { width: 640 });
    expect(l.nodes.length).toBe(2);
    expect(l.edges.length).toBe(1);
    checkLayout(l);
  });

  test("a disconnected graph places every part", () => {
    const pairs: RelationPair[] = [
      { a: "1", b: "2", weight: 9 },
      { a: "2", b: "3", weight: 4 },
      { a: "10", b: "11", weight: 7 },
      { a: "20", b: "21", weight: 1 },
    ];
    const l = layoutGraph(pairs, { width: 640 });
    expect(l.nodes.length).toBe(7);
    checkLayout(l);
  });

  for (const [n, m, w] of [
    [12, 18, 640],
    [20, 50, 640],
    [20, 50, 480],
    [40, 50, 800],
    [60, 50, 640],
    [60, 200, 640],
  ] as const) {
    test(`${n} members, ${m} pairs at ${w}px: bounds, grid, no overlaps`, () => {
      checkLayout(layoutGraph(samplePairs(n, m), { width: w }));
    });
  }

  test("over the caps it keeps the strongest pairs and says so", () => {
    const pairs = samplePairs(100, 260);
    const l = layoutGraph(pairs, { width: 640 });
    expect(l.nodes.length).toBeLessThanOrEqual(MAX_NODES);
    expect(l.edges.length).toBeLessThanOrEqual(MAX_EDGES);
    expect(l.total).toBe(260);
    expect(l.shown).toBe(l.edges.length);
    expect(capLine(l.shown, l.total)).toBe(`showing the strongest ${l.shown} of 260 pairs.`);
    checkLayout(l);
  });

  test("edges come strongest first and the busiest member is first", () => {
    const l = layoutGraph(samplePairs(15, 30), { width: 640 });
    for (let i = 1; i < l.edges.length; i++) expect(l.edges[i - 1]!.weight).toBeGreaterThanOrEqual(l.edges[i]!.weight);
    for (let i = 1; i < l.nodes.length; i++) expect(l.nodes[i - 1]!.total).toBeGreaterThanOrEqual(l.nodes[i]!.total);
  });
});

describe("capPairs", () => {
  test("keeps everything under the caps and drops self-pairs, repeats and zero weights", () => {
    const r = capPairs([
      { a: "1", b: "2", weight: 3 },
      { a: "2", b: "1", weight: 2 },
      { a: "3", b: "3", weight: 9 },
      { a: "4", b: "5", weight: 0 },
    ]);
    expect(r.kept).toEqual([{ a: "1", b: "2", weight: 3 }]);
    expect(r.total).toBe(1);
  });

  test("skips a pair that would bring in a member past the cap, but keeps later pairs among members in", () => {
    const r = capPairs(
      [
        { a: "1", b: "2", weight: 10 },
        { a: "3", b: "4", weight: 9 },
        { a: "1", b: "3", weight: 5 },
      ],
      3,
    );
    expect(r.kept.map((p) => p.weight)).toEqual([10, 5]);
    const s = capPairs(
      [
        { a: "1", b: "2", weight: 10 },
        { a: "2", b: "3", weight: 9 },
        { a: "4", b: "5", weight: 8 },
        { a: "1", b: "3", weight: 1 },
      ],
      3,
    );
    expect(s.kept.map((p) => p.weight)).toEqual([10, 9, 1]);
    expect(s.total).toBe(4);
  });

  test("the tie cap", () => {
    expect(capPairs(samplePairs(60, 120), 60, 50).kept.length).toBe(50);
  });

  test("capLine is null when nothing is left out", () => {
    expect(capLine(5, 5)).toBeNull();
    expect(capLine(48, 50)).toBe("showing the strongest 48 of 50 pairs.");
  });
});

describe("classes", () => {
  test("weight classes are quartiles, equal weights share one", () => {
    expect(weightClasses([1, 2, 3, 4, 5, 6, 7, 8])).toEqual([1, 1, 2, 2, 3, 3, 4, 4]);
    expect(weightClasses([8, 1])).toEqual([3, 1]);
    expect(weightClasses([5, 5, 5])).toEqual([1, 1, 1]);
    expect(weightClasses([100])).toEqual([1]);
    expect(weightClasses([10, 20, 30, 40])).toEqual([1, 2, 3, 4]);
  });

  test("a quiet period still has a top step", () => {
    expect(Math.max(...weightClasses([1, 2, 2, 3]))).toBe(4);
  });

  test("size classes: top fifth s3, upper half s2, lower half s1", () => {
    const totals = new Map([...Array(10).keys()].map((i) => [String(i), (i + 1) * 10]));
    const s = sizeClasses(totals);
    expect([...s.values()]).toEqual([1, 1, 1, 1, 1, 2, 2, 2, 3, 3]);
  });

  test("tints are stable per id and spread over the four", () => {
    expect(tintOf("123456789012345678")).toBe(tintOf("123456789012345678"));
    const seen = new Set([...Array(40).keys()].map((i) => tintOf(id(i))));
    expect(seen.size).toBe(4);
    // a member keeps their tint in another period's layout
    const a = layoutGraph(samplePairs(20, 30), { width: 640 });
    const b = layoutGraph(samplePairs(20, 12), { width: 800 });
    for (const n of b.nodes) {
      const m = a.nodes.find((x) => x.id === n.id);
      if (m) expect(m.tint).toBe(n.tint);
    }
  });

  test("boxes include the label band at its widest", () => {
    const b = nodeBox(100, 100, 3);
    expect(b.left).toBe(100 - LABEL_HALF);
    expect(b.top).toBe(100 - TILE_HALF[3]);
    expect(b.bottom).toBe(100 + TILE_HALF[3] + LABEL_GAP + LABEL_H);
  });
});
