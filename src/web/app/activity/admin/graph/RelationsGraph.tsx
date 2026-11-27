/**
 * The relations graph as the tab mounts it: measures the room for the stage, lays the pairs out for
 * that width ({@link layoutGraph}), resolves names through the shared batched name cache, and draws
 * {@link NodeGraph}, with the cap line when pairs were left out. Admin only: it names members.
 *
 * @module
 */
import { useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from "react";
import type { RelationPair } from "../../../../../plugins/activity/types/admin.ts";
import { useKnownNames } from "../../../names.tsx";
import { Quiet } from "../parts.tsx";
import { capLine, layoutGraph } from "./layout.ts";
import { NodeGraph } from "./NodeGraph.tsx";

/** The side panel's width plus the gap beside it (`.fx-graph-side` 264px, `--space-4` 16px). */
const SIDE_ROOM = 264 + 16;
/** Below this the panel drops under the stage (the component's media query). */
const STACK_BELOW = 720;
/** The stage's hairline frame, both sides. */
const FRAME = 2;
/** The narrowest stage that still fits names; below it the tab shows the table alone. */
export const MIN_STAGE = 480;
/** The stage width assumed before the first measurement (and in a server render). */
export const DEFAULT_STAGE = 640;

/**
 * The stage's inner width for a container width: the container less the side panel when they sit
 * side by side, less the stage's frame.
 *
 * @param container - The graph's container width in px.
 * @param viewport - The window's width in px (the panel stacks at {@link STACK_BELOW} and under).
 */
export function stageWidth(container: number, viewport: number): number {
  return Math.floor(container - (viewport > STACK_BELOW ? SIDE_ROOM : 0) - FRAME);
}

/** Tracks the stage width the container leaves (inside its `px-2` padding), in 16px steps so a small resize does not relayout. */
function useStageWidth(): [RefObject<HTMLDivElement | null>, number] {
  const ref = useRef<HTMLDivElement | null>(null);
  const [w, setW] = useState(DEFAULT_STAGE);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const measure = () => setW(Math.floor(stageWidth(el.clientWidth - 16, window.innerWidth) / 16) * 16);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, w];
}

/** Props of {@link RelationsGraph}. */
export interface RelationsGraphProps {
  /** The relations rows of the shown kind and period. */
  pairs: RelationPair[];
  /** What a tie counts, lowercase. */
  word: string;
  /** Writes a weight for people. */
  formatWeight: (weight: number) => string;
  /** The selected member, kept by the tab across kinds. */
  selected: string | null;
  /** Selection changes. */
  onSelect: (id: string | null) => void;
  /** Opens a member in the inspect panel. */
  onInspect: (id: string) => void;
  /** Shown instead of the graph when the window is too narrow (the ranked table). */
  narrow: ReactNode;
}

/**
 * The graph, or the narrow fallback with a line saying why.
 *
 * @param props - See {@link RelationsGraphProps}.
 */
export function RelationsGraph({ pairs, word, formatWeight, selected, onSelect, onInspect, narrow }: RelationsGraphProps) {
  const [ref, width] = useStageWidth();
  const layout = useMemo(() => layoutGraph(pairs, { width: Math.max(MIN_STAGE, width) }), [pairs, width]);
  const nameOf = useKnownNames(layout.nodes.map((n) => n.id));
  const cap = capLine(layout.shown, layout.total);
  return (
    <div ref={ref} className="px-2 pb-2">
      {width < MIN_STAGE ? (
        <>
          <Quiet className="px-0">The window is too narrow for the graph. The table lists the same pairs.</Quiet>
          {narrow}
        </>
      ) : (
        <>
          <NodeGraph
            layout={layout}
            nameOf={nameOf}
            word={word}
            formatWeight={formatWeight}
            selected={selected}
            onSelect={onSelect}
            onInspect={onInspect}
          />
          {cap && <p className="nar pt-2">{cap}</p>}
        </>
      )}
    </div>
  );
}
