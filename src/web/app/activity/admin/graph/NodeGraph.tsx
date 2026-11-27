/**
 * The React wrapper of the haiiro `NodeGraph` component (`fx-graph`): square member nodes as real
 * buttons on a dithered stage, straight crisp edges in four weights, a side panel inspecting the
 * selected member, and the legend. Presentation only: positions, sizes, tints and weights come from
 * {@link layoutGraph}. The dim runs through the component's classes (`dim`, `lift`, edges `.dim` on
 * frame 3) with timers only to toggle them; under reduced motion `.still` makes every change instant.
 *
 * @module
 */
import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { InkButton, cx } from "../../../ui/index.ts";
import { useReducedMotion } from "../../../ui/motion.ts";
import { SIZE_WORDS, type GraphLayout, type SizeClass } from "./layout.ts";
import { arrowDirection, graphAriaLabel, litSet, nearestInDirection, readingOrder, shortLabel, tiesOf } from "./view.ts";

/** How long a node keeps `.lift` after leaving the dim (3 frames of 100ms). */
const LIFT_MS = 300;
/** When the edges of a dimmed neighbourhood go dashed: frame 3 of the dim. */
const EDGE_MS = 200;
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

/**
 * The relations graph. Every node is a `button` with `aria-pressed` and the member's full name as
 * its accessible name; one tab stop (roving `tabindex`), arrows move to the nearest member that way,
 * Enter or Space selects, Escape clears. The side panel lists the strongest ties (nothing selected)
 * or the selected member's totals and closest ties, and announces changes politely.
 *
 * @param props - See {@link NodeGraphProps}.
 */
export function NodeGraph({ layout, nameOf, word, formatWeight, selected: selectedProp, onSelect, onInspect }: NodeGraphProps) {
  const reduced = useReducedMotion();
  const sideId = useId();
  const [ownSelected, setOwnSelected] = useState<string | null>(null);
  const [hovered, setHovered] = useState<string | null>(null);
  const [active, setActive] = useState<string | null>(null);
  const refs = useRef(new Map<string, HTMLButtonElement | null>());

  const { nodes, edges, width, height } = layout;
  const order = useMemo(() => readingOrder(nodes), [nodes]);
  const byId = useMemo(() => new Map(nodes.map((n) => [n.id, n])), [nodes]);
  const wanted = selectedProp !== undefined ? selectedProp : ownSelected;
  const selected = wanted != null && byId.has(wanted) ? wanted : null;
  const select = (id: string | null) => {
    if (onSelect) onSelect(id);
    else setOwnSelected(id);
  };
  const hov = hovered != null && byId.has(hovered) ? hovered : null;
  const focus = selected ?? hov;
  const lit = useMemo(() => litSet(edges, focus), [edges, focus]);
  const dimmed = (id: string) => lit != null && !lit.has(id);

  // lift-out: nodes leaving the dim keep `.lift` for 300ms; a new focus cancels the pending timer
  const [lifting, setLifting] = useState<ReadonlySet<string>>(new Set());
  const prevDim = useRef<Set<string>>(new Set());
  useEffect(() => {
    const now = new Set(nodes.filter((n) => lit != null && !lit.has(n.id)).map((n) => n.id));
    const lifted = [...prevDim.current].filter((id) => !now.has(id) && byId.has(id));
    prevDim.current = now;
    if (reduced || lifted.length === 0) {
      setLifting((s) => (s.size === 0 ? s : new Set()));
      return;
    }
    setLifting(new Set(lifted));
    const t = setTimeout(() => setLifting(new Set()), LIFT_MS);
    return () => clearTimeout(t);
  }, [lit, nodes, byId, reduced]);

  // edges: those tied to the new focus return at once; the rest go dashed on frame 3 (or at once when still)
  const [lateFocus, setLateFocus] = useState<string | null>(null);
  useEffect(() => {
    if (focus == null || reduced) {
      setLateFocus(focus);
      return;
    }
    const t = setTimeout(() => setLateFocus(focus), EDGE_MS);
    return () => clearTimeout(t);
  }, [focus, reduced]);
  const edgeFocus = reduced ? focus : lateFocus;
  const touches = (e: { a: string; b: string }, id: string) => e.a === id || e.b === id;
  const edgeDim = (e: { a: string; b: string }) => focus != null && edgeFocus != null && !touches(e, focus) && !touches(e, edgeFocus);

  const stop = active != null && byId.has(active) ? active : (order[0]?.id ?? null);
  const onKey = (e: KeyboardEvent<HTMLButtonElement>, id: string) => {
    if (e.key === "Escape") {
      e.preventDefault();
      select(null);
      return;
    }
    const dir = arrowDirection(e.key);
    if (!dir) return;
    e.preventDefault();
    const next = nearestInDirection(nodes, id, dir);
    if (next) {
      setActive(next);
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
        <div className="fx-graph-stage" role="group" aria-label={ariaLabel} aria-describedby={sideId} style={{ height }}>
          <svg className="fx-graph-edges" width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden="true">
            {drawOrder.map((e) => {
              const a = byId.get(e.a)!;
              const b = byId.get(e.b)!;
              return <line key={`${e.a}-${e.b}`} className={cx("fx-edge", `w${e.w}`, edgeDim(e) && "dim")} x1={a.x} y1={a.y} x2={b.x} y2={b.y} />;
            })}
          </svg>
          {order.map((n) => {
            const full = name(n.id);
            const isDim = dimmed(n.id);
            return (
              <button
                key={n.id}
                ref={(el) => {
                  refs.current.set(n.id, el);
                }}
                type="button"
                className={cx(
                  "fx-node",
                  `s${n.size}`,
                  `t${n.tint}`,
                  n.id === selected && "sel",
                  n.id === hov && "hov",
                  isDim && "dim",
                  !isDim && lifting.has(n.id) && "lift",
                )}
                style={{ left: n.x, top: n.y }}
                tabIndex={n.id === stop ? 0 : -1}
                aria-pressed={n.id === selected}
                aria-label={`${full ?? "a member, name loading"}, ${formatWeight(n.total)} ${word}, ${n.ties} ${n.ties === 1 ? "tie" : "ties"}`}
                onMouseEnter={() => setHovered(n.id)}
                onMouseLeave={() => setHovered(null)}
                onFocus={() => {
                  setActive(n.id);
                  setHovered(n.id);
                }}
                onBlur={() => setHovered(null)}
                onClick={() => select(selected === n.id ? null : n.id)}
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
              <p className="kv_label m-0">select a member to inspect them</p>
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
