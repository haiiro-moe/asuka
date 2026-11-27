/**
 * The React wrapper of the haiiro `NodeGraph` component (`fx-graph`): square member nodes as real
 * buttons on a dithered stage, straight crisp edges in four weights, a side panel inspecting the
 * selected member, and the legend. Presentation only: positions, sizes, tints and weights come from
 * {@link layoutGraph}.
 *
 * The dim is stepped from JS, not CSS: the dashboard's kill switch (`asuka.css`) turns every CSS
 * animation off, so each change runs through the component's still frame classes (`fr1` `fr2` `fr3`,
 * then the settled `dim`; lifting out goes `fr2` `fr1` then clear) on {@link useStepped}, 100ms a
 * frame, and edges turn dashed on frame 3 ({@link dimLook}, {@link edgeDashed}). Under reduced motion
 * every change is instant and `.still` is set.
 *
 * @module
 */
import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { InkButton, cx } from "../../../ui/index.ts";
import { useReducedMotion, useStepped } from "../../../ui/motion.ts";
import { SIZE_WORDS, type GraphLayout, type SizeClass } from "./layout.ts";
import { FRAME_MS, LAST_STEP, dimLook, edgeDashed, graphReducer, tabStop, type GraphAction } from "./state.ts";
import { arrowDirection, graphAriaLabel, litSet, nearestInDirection, readingOrder, shortLabel, tiesOf } from "./view.ts";

/** Rows of the side panel's lists. */
const PANEL_TIES = 6;
const PANEL_PAIRS = 8;

/** Props of {@link NodeGraph}. */
export interface NodeGraphProps {
  /** The laid-out graph. */
  layout: GraphLayout;
  /**
   * A member's display name; null while it is still being read. A value equal to the id means the
   * server could not resolve the member.
   */
  nameOf: (id: string) => string | null;
  /** What a tie counts, lowercase: `replies`, `mentions`, `voice time`. */
  word: string;
  /** Writes a weight for people: `118`, `4.5h`. */
  formatWeight: (weight: number) => string;
  /** The selected member when the parent keeps the selection (so it survives a kind switch). */
  selected?: string | null;
  /** Called when the selection changes; without it the graph keeps its own selection. */
  onSelect?: (id: string | null) => void;
  /** Opens a member in the inspect panel; adds an `inspect` button to the side panel. */
  onInspect?: (id: string) => void;
}

/** The text shown for a member: the name, `unknown member` when unresolvable, null while loading. */
function nameText(nameOf: (id: string) => string | null, id: string): string | null {
  const n = nameOf(id);
  return n == null ? null : n === id ? "unknown member" : n;
}

/** One dim change being stepped: who was dimmed before, who is now, and the focus on each side. */
interface DimRun {
  key: number;
  from: ReadonlySet<string>;
  to: ReadonlySet<string>;
  toKey: string;
  fromFocus: string | null;
  toFocus: string | null;
  done: boolean;
}

/**
 * The relations graph. Every node is a `button` with `aria-pressed` and the member's full name as
 * its accessible name; one tab stop (roving `tabindex`: the selected member, else the last focused,
 * else the first), arrows move to the nearest member that way, Enter or Space selects (again to
 * clear), Escape clears, a tap on the stage background clears. Touch never hovers. The side panel
 * lists the strongest ties (nothing selected) or the selected member's totals and closest ties, and
 * announces changes politely.
 *
 * @param props - See {@link NodeGraphProps}.
 */
export function NodeGraph({ layout, nameOf, word, formatWeight, selected: selectedProp, onSelect, onInspect }: NodeGraphProps) {
  const reduced = useReducedMotion();
  const sideId = useId();
  const [ownSelected, setOwnSelected] = useState<string | null>(null);
  const [hovered, setHovered] = useState<string | null>(null);
  const [lastFocused, setLastFocused] = useState<string | null>(null);
  const refs = useRef(new Map<string, HTMLButtonElement | null>());
  const lastPointer = useRef<string>("mouse");

  const { nodes, edges, width, height } = layout;
  const order = useMemo(() => readingOrder(nodes), [nodes]);
  const byId = useMemo(() => new Map(nodes.map((n) => [n.id, n])), [nodes]);
  const wanted = selectedProp !== undefined ? selectedProp : ownSelected;
  const selected = wanted != null && byId.has(wanted) ? wanted : null;
  const hov = hovered != null && byId.has(hovered) ? hovered : null;
  const dispatch = (a: GraphAction) => {
    const next = graphReducer({ selected, hovered: hov }, a);
    if (next.selected !== selected) {
      if (onSelect) onSelect(next.selected);
      else setOwnSelected(next.selected);
    }
    if (next.hovered !== hov) setHovered(next.hovered);
  };
  const focus = selected ?? hov;
  const lit = useMemo(() => litSet(edges, focus), [edges, focus]);
  const dimNow = useMemo(() => new Set(nodes.filter((n) => lit != null && !lit.has(n.id)).map((n) => n.id)), [nodes, lit]);
  const dimKey = [...dimNow].join(",");

  // each change of the dimmed set starts a run of 4 steps (0, 100, 200, 300 ms); a new change restarts it
  const [run, setRun] = useState<DimRun>(() => ({ key: 0, from: dimNow, to: dimNow, toKey: dimKey, fromFocus: focus, toFocus: focus, done: true }));
  if (run.toKey !== dimKey || run.toFocus !== focus) {
    setRun({ key: run.key + 1, from: run.to, to: dimNow, toKey: dimKey, fromFocus: run.toFocus, toFocus: focus, done: false });
  }
  const frame = useStepped(LAST_STEP + 1, FRAME_MS, !run.done && !reduced, run.key);
  const step = run.done || reduced ? LAST_STEP : frame;
  useEffect(() => {
    if (!run.done && (reduced || frame === LAST_STEP)) setRun((r) => (r.key === run.key ? { ...r, done: true } : r));
  }, [frame, reduced, run.done, run.key]);
  const touches = (e: { a: string; b: string }, id: string | null) => id != null && (e.a === id || e.b === id);
  const dashed = (e: { a: string; b: string }) =>
    edgeDashed(focus != null && !touches(e, focus), run.fromFocus != null && !touches(e, run.fromFocus), step, reduced);

  const stop = tabStop(
    order.map((n) => n.id),
    selected,
    lastFocused,
  );
  const onKey = (e: KeyboardEvent<HTMLButtonElement>, id: string) => {
    if (e.key === "Escape") {
      e.preventDefault();
      dispatch({ type: "escape" });
      return;
    }
    const dir = arrowDirection(e.key);
    if (!dir) return;
    e.preventDefault();
    const next = nearestInDirection(nodes, id, dir);
    if (next) {
      setLastFocused(next);
      refs.current.get(next)?.focus();
    }
  };

  const name = (id: string) => nameText(nameOf, id);
  const strongest = edges[0];
  const ariaLabel = graphAriaLabel({
    word,
    people: nodes.length,
    ties: edges.length,
    strongest: strongest
      ? { a: name(strongest.a) ?? "a member", b: name(strongest.b) ?? "a member", value: formatWeight(strongest.weight) }
      : null,
  });
  const drawOrder = useMemo(() => [...edges].sort((p, q) => p.w - q.w || p.weight - q.weight), [edges]);

  return (
    <div className={cx("fx-graph", reduced && "still")}>
      <div className="fx-graph-body">
        <div
          className="fx-graph-stage"
          role="group"
          aria-label={ariaLabel}
          aria-describedby={sideId}
          style={{ height }}
          onClick={(e) => {
            if (e.target === e.currentTarget) dispatch({ type: "background" });
          }}
        >
          <svg className="fx-graph-edges" width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden="true">
            {drawOrder.map((e) => {
              const a = byId.get(e.a)!;
              const b = byId.get(e.b)!;
              return <line key={`${e.a}-${e.b}`} className={cx("fx-edge", `w${e.w}`, dashed(e) && "dim")} x1={a.x} y1={a.y} x2={b.x} y2={b.y} />;
            })}
          </svg>
          {order.map((n) => {
            const full = name(n.id);
            const look = dimLook(run.from.has(n.id), run.to.has(n.id), step, reduced);
            return (
              <button
                key={n.id}
                ref={(el) => {
                  refs.current.set(n.id, el);
                }}
                type="button"
                className={cx("fx-node", `s${n.size}`, `t${n.tint}`, n.id === selected && "sel", n.id === hov && "hov", look)}
                style={{ left: n.x, top: n.y }}
                tabIndex={n.id === stop ? 0 : -1}
                aria-pressed={n.id === selected}
                aria-label={`${full ?? "a member, name loading"}, ${formatWeight(n.total)} ${word}, ${n.ties} ${n.ties === 1 ? "tie" : "ties"}`}
                onPointerDown={(e) => {
                  lastPointer.current = e.pointerType;
                }}
                onPointerEnter={(e) => dispatch({ type: "enter", id: n.id, pointer: e.pointerType })}
                onPointerLeave={() => dispatch({ type: "leave", id: n.id })}
                onFocus={() => {
                  setLastFocused(n.id);
                  dispatch({ type: "focus", id: n.id, viaTouch: lastPointer.current === "touch" });
                }}
                onBlur={() => {
                  lastPointer.current = "mouse";
                  dispatch({ type: "blur" });
                }}
                onClick={() => dispatch({ type: "tap", id: n.id })}
                onKeyDown={(e) => onKey(e, n.id)}
              >
                <span className="fx-node-tile" />
                <span className="fx-node-label">{shortLabel(full)}</span>
              </button>
            );
          })}
        </div>
        <aside className="fx-graph-side" id={sideId} aria-live="polite">
          {selected ? (
            <SelectedPanel
              id={selected}
              name={name(selected)}
              total={byId.get(selected)!.total}
              size={byId.get(selected)!.size}
              ties={tiesOf(edges, selected)}
              word={word}
              formatWeight={formatWeight}
              nameOf={name}
              onInspect={onInspect}
            />
          ) : (
            <>
              <div className="c6">@ {word} » strongest ties</div>
              <div className="fx-graph-rule" />
              <ol className="fx-graph-list">
                {edges.slice(0, PANEL_PAIRS).map((e) => (
                  <li key={`${e.a}-${e.b}`} className="fx-graph-row">
                    <span className="min-w-0 break-words">
                      <span className="c4">»</span> {name(e.a) ?? "···"} and {name(e.b) ?? "···"}
                    </span>
                    <span>{formatWeight(e.weight)}</span>
                  </li>
                ))}
              </ol>
              <div className="fx-graph-rule" />
              <p className="text-subtle m-0">select a member to inspect them.</p>
            </>
          )}
        </aside>
      </div>
      <GraphLegend />
    </div>
  );
}

/** Props of {@link SelectedPanel}. */
interface SelectedPanelProps {
  id: string;
  name: string | null;
  total: number;
  size: SizeClass;
  ties: { id: string; weight: number }[];
  word: string;
  formatWeight: (weight: number) => string;
  nameOf: (id: string) => string | null;
  onInspect?: (id: string) => void;
}

/** The side panel for a selected member: their full name, totals and closest ties. */
function SelectedPanel({ id, name, total, size, ties, word, formatWeight, nameOf, onInspect }: SelectedPanelProps) {
  return (
    <>
      <div className="c6 break-words">@ {name ?? "···"} » inspect</div>
      <div className="fx-graph-rule" />
      <div className="fx-graph-row">
        <span className="k">{word}</span>
        <span>{formatWeight(total)}</span>
      </div>
      <div className="fx-graph-row">
        <span className="k">ties</span>
        <span>{ties.length}</span>
      </div>
      <div className="fx-graph-row">
        <span className="k">total</span>
        <span>{SIZE_WORDS[size]}</span>
      </div>
      <div className="fx-graph-rule" />
      <div className="kv_label">closest ties</div>
      <ol className="fx-graph-list">
        {ties.slice(0, PANEL_TIES).map((t) => (
          <li key={t.id} className="fx-graph-row">
            <span className="min-w-0 break-words">
              <span className="c4">»</span> {nameOf(t.id) ?? "···"}
            </span>
            <span>{formatWeight(t.weight)}</span>
          </li>
        ))}
      </ol>
      {onInspect && (
        <div>
          <InkButton tone="gold" onClick={() => onInspect(id)}>
            inspect
          </InkButton>
        </div>
      )}
    </>
  );
}

/** The legend: tie strength in four steps, and the three member-total tiers as tile sizes. */
export function GraphLegend() {
  return (
    <div className="fx-graph-legend">
      <span>tie strength</span>
      <span className="fx-legend">
        <span>few</span>
        <i className="h1" />
        <i className="h2" />
        <i className="h3" />
        <i className="h4" />
        <span>many</span>
      </span>
      <span>member total</span>
      <span className="fx-graph-swatch" />
      <span>{SIZE_WORDS[1]}</span>
      <span className="fx-graph-swatch s2" />
      <span>{SIZE_WORDS[2]}</span>
      <span className="fx-graph-swatch s3" />
      <span>{SIZE_WORDS[3]}</span>
    </div>
  );
}
