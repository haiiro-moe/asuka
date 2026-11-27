import { describe, expect, test } from "bun:test";
import {
  NAME_PLACEHOLDER,
  arrowDirection,
  cellWidth,
  defaultView,
  graphAriaLabel,
  litSet,
  nearestInDirection,
  readingOrder,
  shortLabel,
  tiesOf,
} from "./view.ts";

describe("defaultView", () => {
  test("graph from three pairs up, table below", () => {
    expect(defaultView(0)).toBe("table");
    expect(defaultView(2)).toBe("table");
    expect(defaultView(3)).toBe("graph");
    expect(defaultView(50)).toBe("graph");
  });
});

describe("shortLabel", () => {
  test("lowercase, shortened with an ellipsis at ten characters", () => {
    expect(shortLabel("Ember")).toBe("ember");
    expect(shortLabel("abcdefghij")).toBe("abcdefghij");
    expect(shortLabel("Abcdefghijk")).toBe("abcdefghi…");
    expect(Array.from(shortLabel("x".repeat(40))).length).toBe(10);
  });

  test("never cuts inside a character, and wide glyphs take two cells", () => {
    expect(shortLabel("ありがとう")).toBe("ありがとう");
    expect(shortLabel("ありがとうございますね")).toBe("ありがと…");
    expect(shortLabel("𝔞𝔟𝔠𝔡𝔢𝔣𝔤𝔥𝔦𝔧𝔨")).toBe("𝔞𝔟𝔠𝔡𝔢𝔣𝔤𝔥𝔦…");
    expect(cellWidth("あ")).toBe(2);
    expect(cellWidth("a")).toBe(1);
  });

  test("a loading or blank name gives the neutral placeholder", () => {
    expect(shortLabel(null)).toBe(NAME_PLACEHOLDER);
    expect(shortLabel("   ")).toBe(NAME_PLACEHOLDER);
  });
});

describe("keyboard", () => {
  const nodes = [
    { id: "c", x: 300, y: 200 },
    { id: "r", x: 500, y: 210 },
    { id: "far-r", x: 600, y: 200 },
    { id: "u", x: 310, y: 60 },
    { id: "d", x: 290, y: 360 },
    { id: "l", x: 100, y: 180 },
  ];

  test("arrows move to the nearest member that way", () => {
    expect(nearestInDirection(nodes, "c", "right")).toBe("r");
    expect(nearestInDirection(nodes, "c", "left")).toBe("l");
    expect(nearestInDirection(nodes, "c", "up")).toBe("u");
    expect(nearestInDirection(nodes, "c", "down")).toBe("d");
    expect(nearestInDirection(nodes, "far-r", "right")).toBeNull();
    expect(nearestInDirection(nodes, "nobody", "right")).toBeNull();
  });

  test("arrow keys map to directions, other keys to null", () => {
    expect(arrowDirection("ArrowLeft")).toBe("left");
    expect(arrowDirection("ArrowDown")).toBe("down");
    expect(arrowDirection("Enter")).toBeNull();
  });

  test("reading order is top to bottom, then left to right", () => {
    expect(readingOrder(nodes).map((n) => n.id)).toEqual(["u", "l", "c", "far-r", "r", "d"]);
  });
});

describe("focus and ties", () => {
  const edges = [
    { a: "1", b: "2", weight: 5 },
    { a: "2", b: "3", weight: 9 },
    { a: "4", b: "5", weight: 1 },
  ];

  test("litSet is the focus and its ties; null without focus", () => {
    expect(litSet(edges, null)).toBeNull();
    expect([...litSet(edges, "2")!].sort()).toEqual(["1", "2", "3"]);
    expect([...litSet(edges, "9")!]).toEqual(["9"]);
  });

  test("tiesOf lists the other member, strongest first", () => {
    expect(tiesOf(edges, "2")).toEqual([
      { id: "3", weight: 9 },
      { id: "1", weight: 5 },
    ]);
    expect(tiesOf(edges, "7")).toEqual([]);
  });

  test("the stage summary names the relation, counts and strongest tie", () => {
    expect(graphAriaLabel({ word: "replies", people: 12, ties: 18, strongest: { a: "ember", b: "kite", value: "118" } })).toBe(
      "who talks to whom, replies: 12 people, 18 ties. strongest: ember and kite, 118. the ties are listed beside the graph.",
    );
    expect(graphAriaLabel({ word: "voice time", people: 2, ties: 1, strongest: null })).toContain("2 people, 1 tie.");
  });
});
