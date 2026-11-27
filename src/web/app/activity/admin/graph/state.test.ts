import { describe, expect, test } from "bun:test";
import { DIM_FRAMES, EDGE_STEP, LAST_STEP, LIFT_FRAMES, dimLook, edgeDashed, graphReducer, tabStop, type GraphFocusState } from "./state.ts";

const none: GraphFocusState = { selected: null, hovered: null };

describe("graphReducer", () => {
  test("touch: a tap selects without hovering, a second tap deselects and nothing stays lit", () => {
    let s = graphReducer(none, { type: "enter", id: "a", pointer: "touch" });
    expect(s).toEqual(none);
    s = graphReducer(s, { type: "focus", id: "a", viaTouch: true });
    expect(s).toEqual(none);
    s = graphReducer(s, { type: "tap", id: "a" });
    expect(s).toEqual({ selected: "a", hovered: null });
    s = graphReducer(s, { type: "tap", id: "a" });
    expect(s).toEqual(none);
  });

  test("tapping the selected member clears a hover too", () => {
    expect(graphReducer({ selected: "a", hovered: "a" }, { type: "tap", id: "a" })).toEqual(none);
  });

  test("tapping another member moves the selection", () => {
    expect(graphReducer({ selected: "a", hovered: null }, { type: "tap", id: "b" })).toEqual({ selected: "b", hovered: null });
  });

  test("a tap on the stage background clears selection and hover", () => {
    expect(graphReducer({ selected: "a", hovered: "b" }, { type: "background" })).toEqual(none);
  });

  test("mouse hover then leave", () => {
    let s = graphReducer(none, { type: "enter", id: "a", pointer: "mouse" });
    expect(s.hovered).toBe("a");
    s = graphReducer(s, { type: "leave", id: "b" });
    expect(s.hovered).toBe("a");
    s = graphReducer(s, { type: "leave", id: "a" });
    expect(s).toEqual(none);
  });

  test("keyboard focus hovers, blur clears, Escape clears only the selection", () => {
    let s = graphReducer(none, { type: "focus", id: "a", viaTouch: false });
    expect(s.hovered).toBe("a");
    s = graphReducer(s, { type: "tap", id: "a" });
    s = graphReducer(s, { type: "escape" });
    expect(s).toEqual({ selected: null, hovered: "a" });
    expect(graphReducer(s, { type: "blur" })).toEqual(none);
  });
});

describe("tabStop", () => {
  const order = ["a", "b", "c"];
  test("the selected member, else the last focused, else the first", () => {
    expect(tabStop(order, "c", "b")).toBe("c");
    expect(tabStop(order, null, "b")).toBe("b");
    expect(tabStop(order, null, null)).toBe("a");
  });
  test("ids no longer drawn are skipped", () => {
    expect(tabStop(order, "gone", "also-gone")).toBe("a");
    expect(tabStop([], null, null)).toBeNull();
  });
});

describe("dim frames", () => {
  test("dimming: sparse, checker, muted label, then settled dim", () => {
    expect([0, 1, 2, 3].map((s) => dimLook(false, true, s, false))).toEqual(["fr1", "fr2", "fr3", "dim"]);
    expect(DIM_FRAMES.length).toBe(LAST_STEP + 1);
  });

  test("lifting: the reverse, the label back at once, the dither thinning, then clear", () => {
    expect([0, 1, 2, 3].map((s) => dimLook(true, false, s, false))).toEqual(["fr2", "fr1", null, null]);
    expect(LIFT_FRAMES.length).toBe(LAST_STEP + 1);
  });

  test("unchanged nodes hold their look at every step", () => {
    for (const s of [0, 1, 2, 3]) {
      expect(dimLook(true, true, s, false)).toBe("dim");
      expect(dimLook(false, false, s, false)).toBeNull();
    }
  });

  test("reduced motion: the settled look at once", () => {
    expect(dimLook(false, true, 0, true)).toBe("dim");
    expect(dimLook(true, false, 0, true)).toBeNull();
  });

  test("edges turn dashed on frame 3, at once under reduced motion, and lit edges return at once", () => {
    expect([0, 1, 2, 3].map((s) => edgeDashed(true, false, s, false))).toEqual([false, false, true, true]);
    expect(EDGE_STEP).toBe(2);
    expect(edgeDashed(true, false, 0, true)).toBe(true);
    expect(edgeDashed(true, true, 0, false)).toBe(true);
    expect(edgeDashed(false, true, 0, false)).toBe(false);
  });
});
