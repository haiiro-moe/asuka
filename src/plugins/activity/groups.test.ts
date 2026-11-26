import { expect, test } from "bun:test";
import { countBridges, detectGroups } from "./groups.ts";
import type { Edge } from "./groups.ts";

/** An edge, weight 1 unless given. */
function edge(a: string, b: string, weight = 1): Edge {
  return { a, b, weight };
}

/** Every pair of `ids` joined by one edge. */
function clique(ids: string[], weight = 1): Edge[] {
  const edges: Edge[] = [];
  ids.forEach((a, i) => {
    for (const b of ids.slice(i + 1)) edges.push(edge(a, b, weight));
  });
  return edges;
}

/** Two triangles, a-b-c and d-e-f, joined by the single edge c-d. */
const TWO_TRIANGLES: Edge[] = [...clique(["a", "b", "c"]), ...clique(["d", "e", "f"]), edge("c", "d")];

/** A fixed pseudo-random graph: the same edges on every run. */
function scrambledGraph(members: number, edges: number): Edge[] {
  let state = 12345;
  const next = (bound: number) => {
    state = (state * 1103515245 + 12345) % 2147483648;
    return state % bound;
  };
  const out: Edge[] = [];
  for (let i = 0; i < edges; i++) {
    out.push(edge(`m${next(members)}`, `m${next(members)}`, 1 + next(5)));
  }
  return out;
}

// --- detectGroups ----------------------------------------------------------

test("two triangles joined by one edge are two groups", () => {
  expect(detectGroups(TWO_TRIANGLES)).toEqual([
    ["a", "b", "c"],
    ["d", "e", "f"],
  ]);
});

test("the same input twice gives identical output", () => {
  expect(detectGroups(TWO_TRIANGLES)).toEqual(detectGroups(TWO_TRIANGLES));
  const graph = scrambledGraph(40, 120);
  expect(detectGroups(graph)).toEqual(detectGroups(graph));
});

test("the order and the direction of the edges do not matter", () => {
  const graph = scrambledGraph(40, 120);
  const turned = [...graph].reverse().map((e) => edge(e.b, e.a, e.weight));
  expect(detectGroups(turned)).toEqual(detectGroups(graph));
});

test("the two triangles stay apart whichever members the joining edge connects", () => {
  for (const left of ["a", "b", "c"]) {
    for (const right of ["d", "e", "f"]) {
      const edges = [...clique(["a", "b", "c"]), ...clique(["d", "e", "f"]), edge(left, right)];
      expect(detectGroups(edges)).toEqual([
        ["a", "b", "c"],
        ["d", "e", "f"],
      ]);
    }
  }
});

test("a clique is one group", () => {
  const ids = ["p1", "p2", "p3", "p4", "p5", "p6"];
  expect(detectGroups(clique(ids))).toEqual([ids]);
});

test("components are separate groups, the largest first, then by first member", () => {
  const edges = [edge("y", "z"), ...clique(["k", "l", "m", "n"]), edge("b", "a"), ...clique(["r", "s", "t"])];
  expect(detectGroups(edges)).toEqual([
    ["k", "l", "m", "n"],
    ["r", "s", "t"],
    ["a", "b"],
    ["y", "z"],
  ]);
});

test("a star is one group around its hub", () => {
  const edges = ["a", "b", "c", "d"].map((leaf) => edge("hub", leaf));
  expect(detectGroups(edges)).toEqual([["a", "b", "c", "d", "hub"]]);
});

test("no edges give no groups", () => {
  expect(detectGroups([])).toEqual([]);
});

test("self loops and edges without a positive weight are ignored", () => {
  const edges = [
    edge("a", "a", 5),
    edge("a", "b", 0),
    edge("b", "c", -3),
    edge("c", "d", Number.NaN),
    edge("d", "e", Number.POSITIVE_INFINITY),
    edge("x", "y", 2),
  ];
  expect(detectGroups(edges)).toEqual([["x", "y"]]);
});

test("a member tied to two groups joins the one it is tied to more strongly", () => {
  const edges = [
    ...clique(["a1", "a2", "a3"]),
    ...clique(["b1", "b2", "b3"]),
    ...["a1", "a2", "a3"].map((a) => edge("x", a, 1)),
    ...["b1", "b2", "b3"].map((b) => edge("x", b, 5)),
  ];
  expect(detectGroups(edges)).toEqual([
    ["b1", "b2", "b3", "x"],
    ["a1", "a2", "a3"],
  ]);
});

test("duplicate edges add up", () => {
  const split = [
    ...clique(["a1", "a2", "a3"]),
    ...clique(["b1", "b2", "b3"]),
    ...["a1", "a2", "a3"].map((a) => edge("x", a, 1)),
    // 2 + 3 in two rows and two directions is the weight 5 of the test above.
    ...["b1", "b2", "b3"].flatMap((b) => [edge("x", b, 2), edge(b, "x", 3)]),
  ];
  expect(detectGroups(split)).toEqual([
    ["b1", "b2", "b3", "x"],
    ["a1", "a2", "a3"],
  ]);
});

test("two members with a very strong tie stay in their group", () => {
  const ids = ["o1", "o2", "o3", "p", "q"];
  const edges = [...clique(ids, 10), edge("p", "q", 190)];
  expect(detectGroups(edges)).toEqual([ids]);
});

test("a member closest to another circle does not pull their own circle along", () => {
  // x is one of five who all know each other, and much closer to a1, a2 and a3.
  // Once with an id before the other four, once with one after them.
  for (const x of ["m", "z"]) {
    const circle = ["n1", "n2", "n3", "n4"];
    const edges = [
      ...clique(["a1", "a2", "a3"]),
      ...clique([x, ...circle]),
      ...["a1", "a2", "a3"].map((a) => edge(x, a, 20)),
    ];
    expect(detectGroups(edges)).toEqual([["a1", "a2", "a3", x], circle]);
  }
});

test("every member with an edge is in exactly one group, and members are sorted", () => {
  const graph = scrambledGraph(60, 150);
  const expected = new Set<string>();
  for (const e of graph) {
    if (e.a === e.b) continue;
    expected.add(e.a);
    expected.add(e.b);
  }
  const groups = detectGroups(graph);
  const seen = groups.flat();
  expect(new Set(seen).size).toBe(seen.length);
  expect(new Set(seen)).toEqual(expected);
  for (const group of groups) {
    expect(group).toEqual([...group].sort());
  }
});

test("every group is connected through its own members", () => {
  const graph = scrambledGraph(60, 90);
  for (const group of detectGroups(graph)) {
    const inside = new Set(group);
    const reached = new Set([group[0]!]);
    const queue = [group[0]!];
    while (queue.length > 0) {
      const at = queue.pop()!;
      for (const e of graph) {
        const other = e.a === at ? e.b : e.b === at ? e.a : null;
        if (other !== null && inside.has(other) && !reached.has(other)) {
          reached.add(other);
          queue.push(other);
        }
      }
    }
    expect(reached.size).toBe(group.length);
  }
});

// --- countBridges ----------------------------------------------------------

test("countBridges is 1 for two triangles joined by one edge", () => {
  expect(countBridges(TWO_TRIANGLES, detectGroups(TWO_TRIANGLES))).toBe(1);
});

test("countBridges is 0 without an edge between two groups", () => {
  const edges = [...clique(["a", "b", "c"]), ...clique(["d", "e", "f"])];
  expect(countBridges(edges, detectGroups(edges))).toBe(0);
  expect(countBridges([], [])).toBe(0);
});

test("countBridges counts a pair of members once, however many edges join them", () => {
  const groups = [
    ["a", "b", "c"],
    ["d", "e", "f"],
  ];
  const edges = [edge("c", "d", 1), edge("d", "c", 4), edge("c", "d", 2), edge("a", "e"), edge("a", "b")];
  expect(countBridges(edges, groups)).toBe(2);
});

test("countBridges ignores members outside the given groups and edges that are no tie", () => {
  const groups = [
    ["a", "b", "c"],
    ["d", "e", "f"],
  ];
  const edges = [edge("c", "z"), edge("y", "z"), edge("a", "d", 0), edge("b", "e", -1), edge("c", "c")];
  expect(countBridges(edges, groups)).toBe(0);
});
