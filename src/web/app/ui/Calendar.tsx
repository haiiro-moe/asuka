/**
 * The wide month calendar of the events pages (decision 5 of the approved mockups): hairline cells,
 * today a pine band on the day number, events as one-line bars in their group colour, `+N more` when a
 * day is full. Under 720px the same data is an agenda list grouped by day. Bar text picks the palette
 * colour that reads on the bar ({@link barInk}), so every bar keeps 4.5:1.
 *
 * @module
 */
import type { CSSProperties } from "react";
import { Empty } from "./states.tsx";
import { Heading, Swatch, cx } from "./basics.tsx";
import { dayKey, formatMonth } from "./datetime.ts";

/** One event on the {@link Calendar}. */
export interface CalendarEvent {
  id: string | number;
  title: string;
  /** The bar colour: a data colour (`#rrggbb`) or a token (`var(--color-foam)`). Default iris. */
  colour?: string | null;
  /** When it starts, local time. */
  date: Date;
  /** An all-day event: the agenda shows `all day` instead of a time. */
  allDay?: boolean;
}

/** Props of {@link Calendar}. */
export interface CalendarProps {
  /** Any day in the month to show. */
  month: Date;
  events: CalendarEvent[];
  /** Called with an event's id when its bar or agenda row is chosen. */
  onSelect?: (id: CalendarEvent["id"]) => void;
  /** Called with a day when its `+N more` line is chosen; without it the line is plain text. */
  onSelectDay?: (day: Date) => void;
  /** Shows `‹ month ›` stepping above the grid, called with the first of the new month. */
  onMonthChange?: (month: Date) => void;
  /** Bars per day before `+N more`. Default 3. */
  maxPerDay?: number;
  /** Which day is today. Default now. */
  today?: Date;
  className?: string;
}

const WEEKDAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
const pad = (n: number) => String(n).padStart(2, "0");

/** How a bar's text is drawn: `surface` or `text` ink on the colour, or `stripe` (text on overlay beside a 4px bar of the colour) when no palette ink reaches 4.5:1 on it. */
export type BarInk = "surface" | "text" | "stripe";

const inkCache = new Map<string, BarInk>();

/** Resolves `#rrggbb` or `var(--token)` to linear-light relative luminance, or null when it is neither. */
function luminance(colour: string): number | null {
  let c = colour.trim();
  const token = /^var\((--[\w-]+)\)$/.exec(c);
  if (token) c = getComputedStyle(document.documentElement).getPropertyValue(token[1]!).trim();
  const m = /^#?([0-9a-f]{6})$/i.exec(c);
  if (!m) return null;
  const n = parseInt(m[1]!, 16);
  const lin = (v: number) => {
    const s = v / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin((n >> 16) & 255) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255);
}

/** WCAG contrast ratio of two relative luminances. */
const ratio = (a: number, b: number) => (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);

/**
 * Picks the text ink for a calendar bar of `colour` (a data colour `#rrggbb` or a token `var(--color-x)`):
 * `surface` on light hues (foam, gold, rose, iris, love), `text` on dark ones that still reach 4.5:1, and
 * `stripe` for mid tones such as pine or Discord blurple, where neither does. Unknown colours get
 * `surface` (the default bar is iris). Results are cached per colour.
 *
 * @param colour - The bar colour.
 */
export function barInk(colour: string): BarInk {
  const hit = inkCache.get(colour);
  if (hit) return hit;
  const bg = luminance(colour);
  const surface = luminance("var(--color-surface)");
  const text = luminance("var(--color-text)");
  let ink: BarInk = "surface";
  if (bg != null && surface != null && text != null) {
    const onSurface = ratio(bg, surface);
    const onText = ratio(bg, text);
    ink = onSurface >= 4.5 && onSurface >= onText ? "surface" : onText >= 4.5 ? "text" : onSurface >= 4.5 ? "surface" : "stripe";
    inkCache.set(colour, ink);
  }
  return ink;
}

/** The 6x7 (or 5x7) days shown for `month`, weeks starting on Monday. */
function gridDays(month: Date): Date[] {
  const first = new Date(month.getFullYear(), month.getMonth(), 1);
  const lead = (first.getDay() + 6) % 7;
  const start = new Date(first.getFullYear(), first.getMonth(), 1 - lead);
  const last = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
  const weeks = Math.ceil((lead + last) / 7);
  return Array.from({ length: weeks * 7 }, (_, i) => new Date(start.getFullYear(), start.getMonth(), start.getDate() + i));
}

/**
 * A month grid with event bars (desk) and an agenda list (phone). The event colour is only ever the bar
 * background; the text ink comes from {@link barInk}. Offer `BAR_COLOUR_PRESETS` (no pine, from
 * `fields.tsx`) when people pick an event colour.
 */
export function Calendar({
  month,
  events,
  onSelect,
  onSelectDay,
  onMonthChange,
  maxPerDay = 3,
  today = new Date(),
  className,
}: CalendarProps) {
  const days = gridDays(month);
  const byDay = new Map<string, CalendarEvent[]>();
  for (const e of [...events].sort((a, b) => a.date.getTime() - b.date.getTime())) {
    const k = dayKey(e.date);
    byDay.set(k, [...(byDay.get(k) ?? []), e]);
  }
  const todayKey = dayKey(today);
  const m = month.getMonth();
  const monthName = formatMonth(month);
  const inMonth = [...byDay.entries()]
    .filter(([, list]) => list[0]!.date.getMonth() === m && list[0]!.date.getFullYear() === month.getFullYear())
    .sort(([a], [b]) => (a < b ? -1 : 1));
  const bar = (e: CalendarEvent) => (e.colour ? ({ "--sw": e.colour } as CSSProperties) : undefined);
  const time = (e: CalendarEvent) => (e.allDay ? "all day" : `${pad(e.date.getHours())}:${pad(e.date.getMinutes())}`);

  return (
    <div className={className}>
      {onMonthChange && (
        <div className="mcal-nav">
          <span className="spin">
            <button
              type="button"
              aria-label="previous month"
              onClick={() => onMonthChange(new Date(month.getFullYear(), m - 1, 1))}
            >
              ‹
            </button>
            <span className="c6" aria-live="polite">
              {monthName}
            </span>
            <button type="button" aria-label="next month" onClick={() => onMonthChange(new Date(month.getFullYear(), m + 1, 1))}>
              ›
            </button>
          </span>
        </div>
      )}

      <div className="mcal" role="group" aria-label={monthName}>
        {WEEKDAYS.map((w) => (
          <div key={w} className="hd7" aria-hidden="true">
            {w}
          </div>
        ))}
        {days.map((d) => {
          const k = dayKey(d);
          const list = byDay.get(k) ?? [];
          const extra = list.length - maxPerDay;
          return (
            <div key={k} className={cx("day", d.getMonth() !== m && "o", k === todayKey && "t")}>
              <span className="dn">
                {d.getDate()}
                {k === todayKey && <span className="sr-only"> (today)</span>}
              </span>
              {list.slice(0, maxPerDay).map((e) => (
                <button
                  key={e.id}
                  type="button"
                  className={`ev on-${barInk(e.colour ?? "var(--color-iris)")}`}
                  style={bar(e)}
                  title={e.title}
                  onClick={() => onSelect?.(e.id)}
                >
                  {e.title}
                </button>
              ))}
              {extra > 0 &&
                (onSelectDay ? (
                  <button type="button" className="more" onClick={() => onSelectDay(d)}>
                    +{extra} more
                  </button>
                ) : (
                  <span className="more">+{extra} more</span>
                ))}
            </div>
          );
        })}
      </div>

      <div className="mcal-agenda list" aria-label={`${monthName}, list`}>
        {inMonth.length === 0 && <Empty>No events this month. The page of the calendar is blank.</Empty>}
        {inMonth.map(([k, list]) => {
          const d = list[0]!.date;
          return (
            <div key={k}>
              <Heading first={k === inMonth[0]![0]}>
                {WEEKDAYS[(d.getDay() + 6) % 7]} {d.getDate()} {monthName.split(" ")[0]!.slice(0, 3)}
                {k === todayKey && <span className="text-subtle"> today</span>}
              </Heading>
              {list.map((e) => (
                <button key={e.id} type="button" className="li" onClick={() => onSelect?.(e.id)}>
                  <Swatch colour={e.colour ?? "var(--color-iris)"} />
                  <span className="grow">{e.title}</span>
                  <span className="meta">{time(e)}</span>
                </button>
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}
