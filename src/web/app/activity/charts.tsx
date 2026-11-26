/**
 * Chart wrappers for the activity pages. Each one renders the haiiro system's markup (`fx-heat`,
 * `fx-cols`, `fx-tiles`, `fx-rank`, `fx-legend`) and takes plain numbers, so a page never writes chart
 * markup itself. Colours come from the bundle's classes; the only inline styles are data-driven sizes.
 *
 * @module
 */
import type { CSSProperties } from "react";
import { cx } from "../ui/index.ts";
import { heatLevel, scaleToPercent } from "./scale.ts";

/** Props of {@link ActivityHeatmap}. */
export interface ActivityHeatmapProps {
  /** One label per row (for example weekday names). */
  rowLabels: string[];
  /** `cells[row][bucket]` counts; 24 buckets per row fit the bundle's grid. */
  cells: number[][];
  /** The largest count, which gets the brightest step. */
  max: number;
  /**
   * The chart's accessible name, specific to what it shows (`messages by weekday and hour, utc; busiest
   * tue 21:00`; see `heatmapAriaLabel`). Required: every chart says what it is.
   */
  ariaLabel: string;
  /** A longer reading for screen readers, rendered visually hidden under the chart. */
  summary?: string;
}

/**
 * A grid of square cells in four lightness steps with a legend underneath.
 *
 * @param props - See {@link ActivityHeatmapProps}.
 */
export function ActivityHeatmap({ rowLabels, cells, max, ariaLabel, summary }: ActivityHeatmapProps) {
  const width = Math.max(0, ...cells.map((r) => r.length));
  const style: CSSProperties | undefined =
    width && width !== 24 ? { gridTemplateColumns: `4ch repeat(${width}, minmax(0, 1fr))` } : undefined;
  return (
    <div>
      <div className="fx-heat" role="img" aria-label={ariaLabel} style={style}>
        {cells.map((row, r) => (
          <HeatRow key={r} label={rowLabels[r] ?? ""} row={row} max={max} />
        ))}
      </div>
      <div className="fx-legend" aria-hidden="true">
        <span>less</span>
        <i />
        <i className="h1" />
        <i className="h2" />
        <i className="h3" />
        <i className="h4" />
        <span>more</span>
      </div>
      {summary && <p className="sr-only">{summary}</p>}
    </div>
  );
}

function HeatRow({ label, row, max }: { label: string; row: number[]; max: number }) {
  return (
    <>
      <span>{label}</span>
      {row.map((v, i) => {
        const level = heatLevel(v, max);
        return <i key={i} className={level ? `h${level}` : undefined} title={String(v)} />;
      })}
    </>
  );
}

/** Props of {@link ActivityColumns}. */
export interface ActivityColumnsProps {
  /** One value per column. Heights are percentages of the largest value. */
  values: number[];
  /** Labels under the columns, spread along the base (for example `["00", "12", "24"]`). */
  axis?: string[];
  /** `foam` (default) or `iris` for a second measure. */
  tone?: "foam" | "iris";
  /** Index of the current bucket, drawn gold. */
  nowIndex?: number;
  /**
   * The chart's accessible name, specific to what it shows (`replies per week; highest week of 2 Nov at
   * 40`; see `columnsAriaLabel`). Required: every chart says what it is.
   */
  ariaLabel: string;
  /** A longer reading for screen readers, rendered visually hidden under the chart. */
  summary?: string;
}

/**
 * Square columns on a hairline base with an optional axis line.
 *
 * @param props - See {@link ActivityColumnsProps}.
 */
export function ActivityColumns({ values, axis, tone = "foam", nowIndex, ariaLabel, summary }: ActivityColumnsProps) {
  const heights = scaleToPercent(values);
  return (
    <div>
      <div className={cx("fx-cols", tone === "iris" && "iris")} role="img" aria-label={ariaLabel}>
        {heights.map((h, i) => (
          <i
            key={i}
            className={i === nowIndex ? "now" : undefined}
            style={{ height: `${h}%` }}
            title={String(values[i] ?? 0)}
          />
        ))}
      </div>
      {axis && axis.length > 0 && (
        <div className="fx-axis" aria-hidden="true">
          {axis.map((a, i) => (
            <span key={i}>{a}</span>
          ))}
        </div>
      )}
      {summary && <p className="sr-only">{summary}</p>}
    </div>
  );
}

/** One tile of {@link ActivityTiles}. */
export interface ActivityTile {
  label: string;
  value: string;
  /** Small mono unit after the value. */
  unit?: string;
  /** The comparison or as-of line. */
  note?: string;
  /** Dashes the border for a figure with nothing yet. */
  off?: boolean;
}

/**
 * A row of hairline stat tiles: one fact per tile.
 *
 * @param props - `tiles`, in display order.
 */
export function ActivityTiles({ tiles }: { tiles: ActivityTile[] }) {
  return (
    <div className="fx-grid fx-tiles">
      {tiles.map((t, i) => (
        <div key={i} className={t.off ? "off" : undefined}>
          <span className="kv_label">{t.label}</span>
          <span className="kv_value">
            {t.value}
            {t.unit && <small>{t.unit}</small>}
          </span>
          {t.note && <span className="note">{t.note}</span>}
        </div>
      ))}
    </div>
  );
}

/** One row of {@link ActivityRank}. */
export interface ActivityRankRow {
  label: string;
  value: number;
  /** A second line under the label. */
  sub?: string;
}

/** Props of {@link ActivityRank}. */
export interface ActivityRankProps {
  rows: ActivityRankRow[];
  /** The value that fills a bar; defaults to the largest row. */
  max?: number;
}

/**
 * A ranked list with a bar against the leader. The top three get the gold, iris and foam ranks.
 *
 * @param props - See {@link ActivityRankProps}.
 */
export function ActivityRank({ rows, max }: ActivityRankProps) {
  const top = max ?? Math.max(0, ...rows.map((r) => r.value));
  const tones = ["g", "i", "f"];
  return (
    <div className="fx-rank">
      {rows.map((r, i) => (
        <div key={i} className="row">
          <span className={cx("pos", tones[i])}>{i + 1}</span>
          <span aria-hidden="true" />
          <span className="who">
            {r.label}
            {r.sub && <span className="note"> {r.sub}</span>}
          </span>
          <span className="bar" aria-hidden="true">
            <i style={{ width: `${top > 0 ? Math.min(100, (r.value / top) * 100) : 0}%` }} />
          </span>
          <span className="val">{r.value.toLocaleString("en-GB")}</span>
        </div>
      ))}
    </div>
  );
}
