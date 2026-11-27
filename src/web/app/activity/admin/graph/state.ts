/**
 * Pure state of the relations graph: the hover and selection reducer (mouse, keyboard and touch),
 * the roving tab stop, and the stepped dim frames. The dashboard's kill switch (`asuka.css`) turns
 * every CSS animation off, so the dim is stepped from JS through the component's still frame classes
 * (`fr1` sparse dither, `fr2` checker, `fr3` checker with the muted label) and settles on `dim`.
 *
 * @module
 */

/** Hover and selection of the graph. */
export interface GraphFocusState {
  /** The selected member, or null. */
  selected: string | null;
  /** The member under the mouse or keyboard focus, or null. Touch never sets it. */
  hovered: string | null;
}

/** What happens to the graph. */
export type GraphAction =
  | { type: "enter"; id: string; pointer: string }
  | { type: "leave"; id: string }
  | { type: "focus"; id: string; viaTouch: boolean }
  | { type: "blur" }
  | { type: "tap"; id: string }
  | { type: "background" }
  | { type: "escape" };

/**
 * The next hover and selection. A touch pointer never hovers (a tap fires an emulated enter and a
 * focus with no leave); tapping the selected member deselects it and clears the hover so nothing stays
 * dimmed; a tap on the stage background clears both; Escape clears the selection.
 *
 * @param s - The current state.
 * @param a - The action.
 */
export function graphReducer(s: GraphFocusState, a: GraphAction): GraphFocusState {
  switch (a.type) {
    case "enter":
      return a.pointer === "touch" ? s : { ...s, hovered: a.id };
    case "leave":
      return s.hovered === a.id ? { ...s, hovered: null } : s;
    case "focus":
      return a.viaTouch ? s : { ...s, hovered: a.id };
    case "blur":
      return { ...s, hovered: null };
    case "tap":
      return s.selected === a.id ? { selected: null, hovered: null } : { ...s, selected: a.id };
    case "background":
      return { selected: null, hovered: null };
    case "escape":
      return { ...s, selected: null };
  }
}

/**
 * The node that holds the graph's one tab stop: the selected member, else the last focused, else the
 * first in reading order. Ids no longer drawn are skipped. Null for an empty graph.
 *
 * @param order - Drawn member ids in reading order.
 * @param selected - The selected member, or null.
 * @param lastFocused - The member that last had focus, or null.
 */
export function tabStop(order: string[], selected: string | null, lastFocused: string | null): string | null {
  if (selected != null && order.includes(selected)) return selected;
  if (lastFocused != null && order.includes(lastFocused)) return lastFocused;
  return order[0] ?? null;
}

/** A node's dim look: a still frame class, the settled `dim`, or nothing. */
export type DimLook = "fr1" | "fr2" | "fr3" | "dim" | null;

/** How long each dim frame holds, in ms. */
export const FRAME_MS = 100;

/** Dimming: sparse dither at 0 ms, checker at 100, muted label at 200, settled at 300. */
export const DIM_FRAMES: readonly DimLook[] = ["fr1", "fr2", "fr3", "dim"];

/**
 * Lifting out of the dim, the reverse: the label returns at once (`fr2` keeps it subtle), the checker
 * thins to the sparse dither at 100 ms and clears at 200 ms; settled at 300.
 */
export const LIFT_FRAMES: readonly DimLook[] = ["fr2", "fr1", null, null];

/** The step that ends a run (the settled look); {@link DIM_FRAMES} and {@link LIFT_FRAMES} are this long plus one. */
export const LAST_STEP = 3;

/** The step at which edges no longer tied to the focus turn dashed (frame 3 of the dim, 200 ms). */
export const EDGE_STEP = 2;

/**
 * A node's look at one step of a dim change.
 *
 * @param wasDim - The node was dimmed before the change.
 * @param isDim - The node is dimmed after it.
 * @param step - 0 to {@link LAST_STEP}; {@link LAST_STEP} is the settled look.
 * @param reduced - Reduced motion: every change is instant (the settled look at any step).
 */
export function dimLook(wasDim: boolean, isDim: boolean, step: number, reduced: boolean): DimLook {
  const s = reduced ? LAST_STEP : Math.max(0, Math.min(LAST_STEP, step));
  if (wasDim && isDim) return "dim";
  if (!wasDim && isDim) return DIM_FRAMES[s]!;
  if (wasDim && !isDim) return LIFT_FRAMES[s]!;
  return null;
}

/**
 * Whether an edge is drawn dashed at one step: it is not tied to the focus, and it was dashed already
 * or the dim has reached {@link EDGE_STEP} (at once under reduced motion). Edges tied to the new focus
 * return at once.
 *
 * @param offFocus - The edge touches neither the current focus nor is there no focus.
 * @param wasDashed - The edge was dashed before the change.
 * @param step - The current step.
 * @param reduced - Reduced motion.
 */
export function edgeDashed(offFocus: boolean, wasDashed: boolean, step: number, reduced: boolean): boolean {
  return offFocus && (wasDashed || reduced || step >= EDGE_STEP);
}
