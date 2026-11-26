/**
 * Select: a choice from a list. Closed it is a `.pick` (`‹ member ›`); open it is the cakeos ChoiceList,
 * a ListRow list in a window under the control with the current row marked by a rose `»`.
 *
 * @module
 */
import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, KeyboardEvent, ReactNode } from "react";
import { cx } from "./basics.tsx";

/** One option of a {@link Select}. */
export interface SelectOption<T extends string | number> {
  value: T;
  /** The row text, also what typing and the filter match. */
  label: string;
  /** A muted note on the right of the row (a count, `default`). */
  meta?: ReactNode;
  disabled?: boolean;
}

/** Props of {@link Select}. */
export interface SelectProps<T extends string | number> {
  options: SelectOption<T>[];
  /** The chosen value; null or undefined shows the placeholder. */
  value: T | null | undefined;
  onChange: (value: T) => void;
  /** Shown in subtle while nothing is chosen. Default `pick one`. */
  placeholder?: string;
  disabled?: boolean;
  /** An error line under the control, in love; the box turns love too. */
  error?: ReactNode;
  /** Accessible name when the control is not labelled by a SettingRow. */
  ariaLabel?: string;
  /** Id of the element that names the control (for example a SettingRow's `labelId`). */
  ariaLabelledBy?: string;
  id?: string;
  /** Show a filter line at the top of the list from this many options on. Default 13. */
  filterFrom?: number;
  className?: string;
}

const POP_MAX = 320;

/**
 * A select in the haiiro look. Closed: Left and Right step through the choices without opening it;
 * Down, Enter or Space opens it. Open: Up and Down move, Enter picks, Esc closes and returns focus,
 * typing jumps to a row (or filters, for long lists), a click outside closes. The popup is fixed to the
 * viewport, so a scrolling window or modal never clips it.
 */
export function Select<T extends string | number>({
  options,
  value,
  onChange,
  placeholder = "pick one",
  disabled,
  error,
  ariaLabel,
  ariaLabelledBy,
  id,
  filterFrom = 13,
  className,
}: SelectProps<T>) {
  const auto = useId();
  const baseId = id ?? auto;
  const listId = `${baseId}-list`;
  const noteId = `${baseId}-note`;
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [filter, setFilter] = useState("");
  const [pos, setPos] = useState<CSSProperties>({});
  const [listMax, setListMax] = useState(POP_MAX - 20);
  const wrap = useRef<HTMLSpanElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const filterRef = useRef<HTMLInputElement>(null);
  const rows = useRef<(HTMLDivElement | null)[]>([]);
  const bad = error != null && error !== false && error !== "";
  const withFilter = options.length >= filterFrom;

  const selected = options.find((o) => o.value === value);
  const shown = useMemo(() => {
    const f = filter.trim().toLowerCase();
    return f ? options.filter((o) => o.label.toLowerCase().includes(f)) : options;
  }, [options, filter]);

  const firstEnabled = (list: SelectOption<T>[], from = 0, dir = 1) => {
    for (let i = from; i >= 0 && i < list.length; i += dir) if (!list[i]!.disabled) return i;
    return -1;
  };

  const place = () => {
    const r = button.current?.getBoundingClientRect();
    if (!r) return;
    const vw = document.documentElement.clientWidth;
    const below = window.innerHeight - r.bottom;
    const up = below < Math.min(POP_MAX, 200) && r.top > below;
    // open towards the side with room: from the control's left edge, or back from its right edge
    const fromRight = r.left + 320 > vw;
    setPos({
      position: "fixed",
      ...(fromRight ? { right: Math.max(8, vw - r.right) } : { left: Math.max(8, r.left) }),
      minWidth: Math.max(r.width, 240),
      maxWidth: "calc(100vw - 16px)",
      margin: 0,
      ...(up ? { bottom: window.innerHeight - r.top + 4 } : { top: r.bottom + 4 }),
    });
    // the frame (2 x 5px) and its padding (2 x 5px) sit around the scrolling content
    setListMax(Math.max(80, Math.min(POP_MAX, (up ? r.top : below) - 12) - 20));
  };

  const openList = () => {
    if (disabled) return;
    setFilter("");
    const i = options.findIndex((o) => o.value === value);
    setActive(i >= 0 ? i : Math.max(0, firstEnabled(options)));
    place();
    setOpen(true);
  };
  const close = (refocus = true) => {
    setOpen(false);
    if (refocus) button.current?.focus();
  };
  const pick = (o: SelectOption<T> | undefined) => {
    if (!o || o.disabled) return;
    onChange(o.value);
    close();
  };

  // focus the active row (or the filter) while open
  useLayoutEffect(() => {
    if (open && !withFilter) rows.current[active]?.focus();
  }, [open, active, withFilter]);
  useEffect(() => {
    if (open && withFilter) filterRef.current?.focus();
  }, [open, withFilter]);

  // close on a click outside; follow the control while the page scrolls
  useEffect(() => {
    if (!open) return;
    const down = (e: MouseEvent) => {
      if (!wrap.current?.contains(e.target as Node)) close(false);
    };
    const move = () => place();
    document.addEventListener("mousedown", down);
    window.addEventListener("resize", move);
    window.addEventListener("scroll", move, true);
    return () => {
      document.removeEventListener("mousedown", down);
      window.removeEventListener("resize", move);
      window.removeEventListener("scroll", move, true);
    };
  }, [open]);

  const stepValue = (dir: 1 | -1) => {
    const from = options.findIndex((o) => o.value === value);
    for (let k = 1; k <= options.length; k++) {
      const i = from < 0 ? (dir === 1 ? k - 1 : options.length - k) : from + dir * k;
      if (i < 0 || i >= options.length) return;
      if (!options[i]!.disabled) return onChange(options[i]!.value);
    }
  };

  const onButtonKey = (e: KeyboardEvent<HTMLButtonElement>) => {
    if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
      e.preventDefault();
      stepValue(e.key === "ArrowRight" ? 1 : -1);
    } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      openList();
    }
  };

  const onListKey = (e: KeyboardEvent<HTMLElement>) => {
    const list = shown;
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      close();
    } else if (e.key === "Tab") {
      close(false);
    } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const dir = e.key === "ArrowDown" ? 1 : -1;
      const fromFilter = document.activeElement === filterRef.current;
      const next = fromFilter ? firstEnabled(list, dir === 1 ? 0 : list.length - 1, dir) : firstEnabled(list, active + dir, dir);
      if (next >= 0) {
        setActive(next);
        rows.current[next]?.focus();
      } else if (dir === -1 && withFilter) {
        filterRef.current?.focus();
      }
    } else if (e.key === "Home" || e.key === "End") {
      if (document.activeElement === filterRef.current) return;
      e.preventDefault();
      const next = e.key === "Home" ? firstEnabled(list) : firstEnabled(list, list.length - 1, -1);
      if (next >= 0) {
        setActive(next);
        rows.current[next]?.focus();
      }
    } else if (e.key === "Enter" || (e.key === " " && document.activeElement !== filterRef.current)) {
      e.preventDefault();
      e.stopPropagation();
      const fromFilter = document.activeElement === filterRef.current;
      pick(fromFilter ? list[firstEnabled(list)] : list[active]);
    } else if (!withFilter && e.key.length === 1 && /\S/.test(e.key)) {
      const ch = e.key.toLowerCase();
      const n = list.length;
      for (let k = 1; k <= n; k++) {
        const i = (active + k) % n;
        if (!list[i]!.disabled && list[i]!.label.toLowerCase().startsWith(ch)) {
          setActive(i);
          rows.current[i]?.focus();
          break;
        }
      }
    }
  };

  return (
    <span ref={wrap} className={cx("relative inline-block max-w-full", className)}>
      <button
        ref={button}
        id={baseId}
        type="button"
        className={cx("pick", bad && "bad")}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-label={ariaLabel}
        aria-labelledby={ariaLabelledBy ? `${ariaLabelledBy} ${baseId}` : undefined}
        aria-invalid={bad || undefined}
        aria-describedby={bad ? noteId : undefined}
        disabled={disabled}
        onClick={() => (open ? close() : openList())}
        onKeyDown={onButtonKey}
      >
        <b aria-hidden="true">‹</b>
        <span className={cx("truncate", !selected && "text-subtle")}>{selected ? selected.label : `${placeholder}…`}</span>
        <b aria-hidden="true">›</b>
      </button>
      {bad && (
        <span id={noteId} className="fld-note err block pl-0">
          {error}
        </span>
      )}
      {open && (
        <section className="window pick-pop" style={pos} onKeyDown={onListKey}>
          <div className="content" style={{ maxHeight: listMax }}>
            {withFilter && (
              <label className="fld sticky top-0 z-10 bg-surface">
                <span className="pr">
                  <span className="c4" aria-hidden="true">»</span> <span className="c3">filter:</span>
                </span>
                <input
                  ref={filterRef}
                  value={filter}
                  aria-controls={listId}
                  aria-label="filter the choices"
                  onChange={(e) => {
                    setFilter(e.target.value);
                    setActive(-1);
                  }}
                />
              </label>
            )}
            <div className="list" role="listbox" id={listId} aria-label={ariaLabel} aria-labelledby={ariaLabelledBy}>
              {shown.map((o, i) => {
                const sel = o.value === value;
                return (
                  <div
                    key={String(o.value)}
                    ref={(el) => {
                      rows.current[i] = el;
                    }}
                    className={cx("li", sel && "sel")}
                    role="option"
                    aria-selected={sel}
                    aria-disabled={o.disabled || undefined}
                    tabIndex={i === active ? 0 : -1}
                    onClick={() => pick(o)}
                    onFocus={() => setActive(i)}
                  >
                    <span className="mk" aria-hidden="true">
                      »
                    </span>
                    <span className="grow">{o.label}</span>
                    {o.meta != null && <span className="meta">{o.meta}</span>}
                  </div>
                );
              })}
              {shown.length === 0 && <p className="nar px-2">Nothing matches.</p>}
            </div>
          </div>
        </section>
      )}
    </span>
  );
}
