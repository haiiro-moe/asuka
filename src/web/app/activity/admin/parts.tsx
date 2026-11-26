/**
 * Small shared pieces of the admin diagnostics page: the view-state switch (loading, failed, empty or
 * the data, as narrator lines), the scrolling data table, a quiet note line and the ink classes of the
 * status words.
 *
 * @module
 */
import { Fragment, type ReactNode } from "react";
import { Empty, ErrorLine, Loading, cx } from "../../ui/index.ts";
import type { ActivityState } from "../useActivity.ts";
import { formatCount, steppedPercent } from "./format.ts";
import type { StatusInk } from "./status.ts";

/** Props of {@link ViewState}. */
export interface ViewStateProps<T> {
  /** The fetch, from `useActivity`. */
  state: ActivityState<T>;
  /** What is being read, for the narrator lines: `the moderation log`. */
  what: string;
  /** True when the data has nothing to show. Defaults to an empty array. */
  isEmpty?: (data: T) => boolean;
  /** The narrator line for an empty result. */
  empty: ReactNode;
  /** Renders the data. */
  children: (data: T) => ReactNode;
}

/**
 * Picks the narrator line for a fetch: `Reading the moderation log`, a love line with retry when it
 * failed, the empty line, or the content. Never a spinner graphic.
 *
 * @param props - See {@link ViewStateProps}.
 */
export function ViewState<T>({ state, what, isEmpty, empty, children }: ViewStateProps<T>) {
  if (state.loading && state.data == null) return <Loading className="px-2">Reading {what}</Loading>;
  if (state.error !== null) {
    return (
      <ErrorLine className="px-2" onRetry={state.reload}>
        {what[0]?.toUpperCase()}
        {what.slice(1)} did not load: {state.error}.
      </ErrorLine>
    );
  }
  if (state.data == null) return <Loading className="px-2">Reading {what}</Loading>;
  const blank = isEmpty ? isEmpty(state.data) : Array.isArray(state.data) && state.data.length === 0;
  if (blank) return <Empty className="px-2">{empty}</Empty>;
  return <>{children(state.data)}</>;
}

/**
 * A dense table that scrolls sideways inside its window, never the page (`.fx-scroll > table.fx-table`).
 * Use `th.r` and `td.r` for numbers.
 *
 * @param props - `head`: the header row's cells; `children`: the body rows.
 */
export function DataTable({ head, children }: { head: ReactNode; children: ReactNode }) {
  return (
    <div className="fx-scroll">
      <table className="fx-table">
        <thead>
          <tr>{head}</tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

/**
 * A quiet line in `subtle` (5.5:1 on surface, so it is readable at body size; `muted` is not): an as-of
 * line, a note under a button, the reason a step is disabled.
 *
 * @param props - `children` and an optional `className`.
 */
export function Quiet({ className, children }: { className?: string; children: ReactNode }) {
  return <p className={cx("text-subtle px-2", className)}>{children}</p>;
}

/**
 * A key-value sheet (`.fx-sheet`): uppercase labels and plain values in two columns.
 *
 * @param props - `rows`: label and value pairs, in order.
 */
export function Sheet({ rows }: { rows: [string, ReactNode][] }) {
  return (
    <div className="fx-sheet px-2 py-1">
      {rows.map(([label, value]) => (
        <Fragment key={label}>
          <span className="kv_label">{label}</span>
          <span>{value}</span>
        </Fragment>
      ))}
    </div>
  );
}

/** Props of {@link ProgressBar}. */
export interface ProgressBarProps {
  /** What is counted, lowercase: `channels done`. */
  label: string;
  /** Units finished. */
  done: number;
  /** Units known. */
  total: number;
}

/**
 * The system's square progress bar (`.progress`) with a tabular `n / N` count. The fill moves in 5%
 * steps ({@link steppedPercent}), never eased.
 *
 * @param props - See {@link ProgressBarProps}.
 */
export function ProgressBar({ label, done, total }: ProgressBarProps) {
  const pct = steppedPercent(done, total);
  return (
    <div
      className="progress px-2 py-1"
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={Math.max(0, total)}
      aria-valuenow={Math.min(Math.max(0, done), Math.max(0, total))}
    >
      <div className="progress_head">
        <span>{label}</span>
        <span className="progress_num">
          {formatCount(done)} / {formatCount(total)}
        </span>
      </div>
      <div className="progress_track">
        <div className="progress_fill" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

/** The ink class for a status word; subtle for idle, bright hues otherwise (never pine or muted). */
export const STATUS_INK: Record<StatusInk, string> = {
  subtle: "text-subtle",
  gold: "c3",
  foam: "c6",
  love: "c2",
  rose: "c4",
};

/** The glyph that leads a status word: the glyph is the state, colour only backs it up. */
export const STATUS_GLYPH: Record<StatusInk, string> = {
  subtle: "·",
  gold: "»",
  foam: "✓",
  love: "×",
  rose: "»",
};
