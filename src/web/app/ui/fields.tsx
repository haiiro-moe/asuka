/**
 * Form controls in haiiro (the system's Forms group): PromptField, TextArea, SettingRow, Toggle,
 * Segmented, Tabs, ColourField and DateTimeField. Every control is a real `<label>`, `<input>`,
 * `<textarea>` or `<button>`, square, with the 2px foam focus ring and no transitions.
 *
 * @module
 */
import { useEffect, useId, useRef, useState } from "react";
import type { CSSProperties, InputHTMLAttributes, KeyboardEvent, ReactNode, Ref } from "react";
import { Swatch, cx } from "./basics.tsx";
import { formatDateTimeInput, parseDateTimeInput, timeZoneName } from "./datetime.ts";

/** The `@ user » label:` prompt that introduces a field. */
function FieldPrompt({ user, label, width }: { user: ReactNode; label?: ReactNode; width?: number }) {
  const style = width ? ({ "--pr-w": `${width}ch` } as CSSProperties) : undefined;
  return (
    <span className={width ? "pr w" : "pr"} style={style}>
      <span className="c2">@</span> <span className="c6">{user}</span>{" "}
      <span className="c4" aria-hidden="true">
        »
      </span>
      {label != null && (
        <>
          {" "}
          <span className="c3">{label}:</span>
        </>
      )}
    </span>
  );
}

/* ------------------------------------------------------------------------------------------------ */

/** Props of {@link PromptField}. Other `<input>` attributes (type, placeholder, inputMode, onBlur ...) pass through. */
export interface PromptFieldProps
  extends Omit<InputHTMLAttributes<HTMLInputElement>, "value" | "onChange" | "className" | "children"> {
  /** The question, without the colon: `display name`. */
  label?: ReactNode;
  /** The place in the prompt. Defaults to `asuka`. */
  user?: ReactNode;
  value: string;
  onChange: (value: string) => void;
  /** A subtle line under the field: the format, the range, what it does. */
  hint?: ReactNode;
  /** An error under the field, in love; also turns the value love. Null or empty for none. */
  error?: ReactNode;
  /** Minimum prompt width in `ch`, so values in one window line up (for example 24). */
  promptWidth?: number;
  /** Something after the value inside the row, for example a swatch. */
  trailing?: ReactNode;
  /** Classes on the row (`label.fld`). */
  className?: string;
  ref?: Ref<HTMLInputElement>;
}

/**
 * A single-line field asked like a shell: `@ asuka » display name: value` with a block caret. The whole
 * row is the `<label>`. Text, number, URL, id, duration and password fields all use it.
 */
export function PromptField({
  label,
  user = "asuka",
  value,
  onChange,
  hint,
  error,
  promptWidth,
  trailing,
  className,
  type = "text",
  id,
  disabled,
  ref,
  ...rest
}: PromptFieldProps) {
  const auto = useId();
  const inputId = id ?? auto;
  const noteId = `${inputId}-note`;
  const bad = error != null && error !== false && error !== "";
  // an empty hint renders no line at all
  const note = bad ? error : hint === "" || hint === false ? null : hint;
  return (
    <>
      <label
        className={cx("fld", bad && "bad", disabled && "off", value === "" && "empty", className)}
        htmlFor={inputId}
      >
        <FieldPrompt user={user} label={label} width={promptWidth} />
        <input
          ref={ref}
          id={inputId}
          type={type}
          className={type === "password" ? "pw" : undefined}
          value={value}
          disabled={disabled}
          aria-invalid={bad || undefined}
          aria-describedby={note != null ? noteId : undefined}
          onChange={(e) => onChange(e.target.value)}
          {...rest}
        />
        {trailing}
      </label>
      {note != null && (
        <div id={noteId} className={cx("fld-note", bad && "err")}>
          {note}
        </div>
      )}
    </>
  );
}

/** The same component as {@link PromptField}, under the name pages may look for. */
export const Input = PromptField;

/* ------------------------------------------------------------------------------------------------ */

/** Props of {@link TextArea}. */
export interface TextAreaProps {
  /** The question above the box, without the colon: `reply text`. */
  label?: ReactNode;
  user?: ReactNode;
  value: string;
  onChange: (value: string) => void;
  /** Visible rows; the box never offers a resize handle. */
  rows?: number;
  placeholder?: string;
  /** A note on the meta line (left), for example `markdown on`. */
  hint?: ReactNode;
  /** An error on the meta line, in love; the border turns love too. */
  error?: ReactNode;
  /** Shows `length / max` on the meta line, love at the limit, and stops typing past it. */
  maxLength?: number;
  /** Shows the line count on the meta line. */
  showLines?: boolean;
  /** Monospace for code and templates. */
  mono?: boolean;
  disabled?: boolean;
  id?: string;
  /** Accessible name when there is no visible label. */
  ariaLabel?: string;
  className?: string;
  onBlur?: () => void;
  onKeyDown?: (e: KeyboardEvent<HTMLTextAreaElement>) => void;
  ref?: Ref<HTMLTextAreaElement>;
}

/**
 * A multi-line field: the prompt label above a hairline box on base, and a subtle meta line under it
 * (hint or line count left, length against the limit right).
 */
export function TextArea({
  label,
  user = "asuka",
  value,
  onChange,
  rows,
  placeholder,
  hint,
  error,
  maxLength,
  showLines,
  mono,
  disabled,
  id,
  ariaLabel,
  className,
  onBlur,
  onKeyDown,
  ref,
}: TextAreaProps) {
  const auto = useId();
  const areaId = id ?? auto;
  const metaId = `${areaId}-meta`;
  const bad = error != null && error !== false && error !== "";
  const lines = value ? value.split("\n").length : 0;
  const left = bad ? <span className="err">{error}</span> : hint != null || showLines ? (
    <span>
      {showLines && `${lines} ${lines === 1 ? "line" : "lines"}`}
      {showLines && hint != null && " · "}
      {hint}
    </span>
  ) : (
    <span />
  );
  const hasMeta = bad || hint != null || showLines || maxLength != null;
  return (
    <div className={className}>
      {label != null && (
        <label className="area-lab block" htmlFor={areaId}>
          <FieldPrompt user={user} label={label} />
        </label>
      )}
      <textarea
        ref={ref}
        id={areaId}
        className={cx("area", bad && "bad", mono && "mono")}
        value={value}
        rows={rows}
        placeholder={placeholder}
        maxLength={maxLength}
        disabled={disabled}
        aria-label={label == null ? ariaLabel : undefined}
        aria-invalid={bad || undefined}
        aria-describedby={hasMeta ? metaId : undefined}
        onChange={(e) => onChange(e.target.value)}
        onBlur={onBlur}
        onKeyDown={onKeyDown}
      />
      {hasMeta && (
        <div className="area-meta" id={metaId}>
          {left}
          {maxLength != null && (
            <span className={value.length >= maxLength ? "err" : undefined}>
              {value.length} / {maxLength}
            </span>
          )}
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------------------------------------ */

/** Props of {@link SettingRow}. */
export interface SettingRowProps {
  /** The setting's name, left. */
  label: ReactNode;
  /** Makes the name a `<label>` for the control with this id. */
  htmlFor?: string;
  /** Id of the name, for controls that use `aria-labelledby`. */
  labelId?: string;
  /** A subtle description under the name. */
  description?: ReactNode;
  /** A setting that does not apply right now drops to 55% rather than disappearing. */
  inactive?: boolean;
  className?: string;
  /** The control, right: a chip, Segmented, Select, spin. */
  children: ReactNode;
}

/** One setting: name left, control right, an optional description under the name, rows split by hairlines. */
export function SettingRow({ label, htmlFor, labelId, description, inactive, className, children }: SettingRowProps) {
  return (
    <div className={cx("set", inactive && "opacity-55", className)}>
      {htmlFor ? (
        <label htmlFor={htmlFor} id={labelId}>
          {label}
        </label>
      ) : (
        <span id={labelId}>{label}</span>
      )}
      <span>{children}</span>
      {description != null && <span className="d">{description}</span>}
    </div>
  );
}

/** Props of {@link Toggle}. */
export interface ToggleProps {
  label: ReactNode;
  checked: boolean;
  onChange: (next: boolean) => void;
  description?: ReactNode;
  disabled?: boolean;
  /** Drops the row to 55% (the setting does not apply right now). */
  inactive?: boolean;
  /** Words for the two states. Default `on` / `off`. */
  onText?: string;
  offText?: string;
  className?: string;
}

/**
 * An on/off setting: a SettingRow whose control is a chip used as a switch (`role="switch"`,
 * `aria-checked`). On is solid with a check, off is dashed and muted, and the state is also a word.
 * The name is a `<label>` for the chip, so clicking either flips it.
 */
export function Toggle({
  label,
  checked,
  onChange,
  description,
  disabled,
  inactive,
  onText = "on",
  offText = "off",
  className,
}: ToggleProps) {
  const id = useId();
  return (
    <SettingRow label={label} htmlFor={id} description={description} inactive={inactive} className={className}>
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        className={cx("chip", checked && "on")}
        onClick={() => onChange(!checked)}
      >
        {checked ? onText : offText}
      </button>
    </SettingRow>
  );
}

/* ------------------------------------------------------------------------------------------------ */

/** One choice of a {@link Segmented} or one tab of {@link Tabs}. */
export interface ChoiceItem<T extends string | number> {
  value: T;
  label: ReactNode;
  disabled?: boolean;
}

/** Moves along enabled items with the arrow keys, Home and End; returns the next index or null. */
function stepIndex(key: string, from: number, items: { disabled?: boolean }[]): number | null {
  const n = items.length;
  if (!n) return null;
  const dir = key === "ArrowRight" || key === "ArrowDown" ? 1 : key === "ArrowLeft" || key === "ArrowUp" ? -1 : 0;
  if (key === "Home" || key === "End") {
    const order = key === "Home" ? [...items.keys()] : [...items.keys()].reverse();
    return order.find((i) => !items[i]!.disabled) ?? null;
  }
  if (!dir) return null;
  for (let k = 1; k <= n; k++) {
    const i = (from + dir * k + n * k) % n;
    if (!items[i]!.disabled) return i;
  }
  return null;
}

/** Props of {@link Segmented}. */
export interface SegmentedProps<T extends string | number> {
  options: ChoiceItem<T>[];
  value: T;
  onChange: (value: T) => void;
  /** Accessible name of the group. */
  ariaLabel: string;
  className?: string;
}

/**
 * A choice of two to four short words, the current one on a pine band (`.seg`). A radio group: arrows
 * move and pick. For five or more choices use Select.
 */
export function Segmented<T extends string | number>({ options, value, onChange, ariaLabel, className }: SegmentedProps<T>) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const current = Math.max(0, options.findIndex((o) => o.value === value));
  return (
    <span className={cx("seg", className)} role="radiogroup" aria-label={ariaLabel}>
      {options.map((o, i) => (
        <button
          key={String(o.value)}
          ref={(el) => {
            refs.current[i] = el;
          }}
          type="button"
          role="radio"
          aria-checked={o.value === value}
          tabIndex={i === current ? 0 : -1}
          disabled={o.disabled}
          className={o.value === value ? "on" : undefined}
          onClick={() => onChange(o.value)}
          onKeyDown={(e) => {
            const next = stepIndex(e.key, i, options);
            if (next == null) return;
            e.preventDefault();
            onChange(options[next]!.value);
            refs.current[next]?.focus();
          }}
        >
          {o.label}
        </button>
      ))}
    </span>
  );
}

/** Props of {@link Tabs}. */
export interface TabsProps<T extends string | number> {
  items: ChoiceItem<T>[];
  value: T;
  onChange: (value: T) => void;
  /** Accessible name of the tab list. */
  ariaLabel: string;
  /** Id prefix: tab `<prefix>-tab-<value>` controls panel `<prefix>-panel-<value>`. */
  idPrefix?: string;
  className?: string;
}

/**
 * A wrapping row of lowercase words for more than four sections (`.tabs`), the current word on a pine
 * band and a hairline under the row. A tablist: Left, Right, Home and End move and select.
 */
export function Tabs<T extends string | number>({ items, value, onChange, ariaLabel, idPrefix, className }: TabsProps<T>) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const current = Math.max(0, items.findIndex((t) => t.value === value));
  return (
    <nav className={cx("tabs", className)} role="tablist" aria-label={ariaLabel}>
      {items.map((t, i) => (
        <button
          key={String(t.value)}
          ref={(el) => {
            refs.current[i] = el;
          }}
          type="button"
          role="tab"
          id={idPrefix ? `${idPrefix}-tab-${t.value}` : undefined}
          aria-controls={idPrefix ? `${idPrefix}-panel-${t.value}` : undefined}
          aria-selected={t.value === value}
          tabIndex={i === current ? 0 : -1}
          disabled={t.disabled}
          onClick={() => onChange(t.value)}
          onKeyDown={(e) => {
            const next = stepIndex(e.key, i, items);
            if (next == null) return;
            e.preventDefault();
            onChange(items[next]!.value);
            refs.current[next]?.focus();
          }}
        >
          {t.label}
        </button>
      ))}
    </nav>
  );
}

/* ------------------------------------------------------------------------------------------------ */

/** The six palette hues offered as colour presets, in the order the mockup shows them. */
export const COLOUR_PRESETS = ["pine", "foam", "gold", "love", "iris", "rose"] as const;

/** One of {@link COLOUR_PRESETS}. */
export type ColourPreset = (typeof COLOUR_PRESETS)[number];

/**
 * The presets for a colour that becomes a bar background with text on it (calendar events): every hue
 * but pine. No palette text colour reaches 4.5:1 on pine, so it is never offered there. Pass it as
 * `<ColourField presets={BAR_COLOUR_PRESETS} />`.
 */
export const BAR_COLOUR_PRESETS: readonly ColourPreset[] = ["foam", "gold", "love", "iris", "rose"];

const HEX = /^#?([0-9a-f]{6})$/i;

/**
 * Normalises a typed colour to lowercase `#rrggbb`.
 *
 * @returns The colour, or null when it is not six hex digits (a leading `#` is optional).
 */
export function normaliseHex(text: string): string | null {
  const m = HEX.exec(text.trim());
  return m ? `#${m[1]!.toLowerCase()}` : null;
}

/** Reads the current `#rrggbb` value of each preset token from the page. */
function readPresetHexes(): Record<ColourPreset, string | null> {
  const cs = getComputedStyle(document.documentElement);
  const out = {} as Record<ColourPreset, string | null>;
  for (const p of COLOUR_PRESETS) out[p] = normaliseHex(cs.getPropertyValue(`--color-${p}`));
  return out;
}

/** Props of {@link ColourField}. */
export interface ColourFieldProps {
  label: ReactNode;
  user?: ReactNode;
  /** The current colour, `#rrggbb` (or empty with `allowEmpty`). */
  value: string;
  /** Called with a valid lowercase `#rrggbb` (or `""` when cleared and `allowEmpty`). */
  onChange: (hex: string) => void;
  /** An empty field is a valid "no colour". */
  allowEmpty?: boolean;
  hint?: ReactNode;
  /**
   * The palette presets under the field: `true` (default) for all six {@link COLOUR_PRESETS}, a list to
   * offer only some (for example {@link BAR_COLOUR_PRESETS}), `false` for none.
   */
  presets?: boolean | readonly ColourPreset[];
  /** Called whenever the typed text turns valid or invalid (an empty field is valid with `allowEmpty`). */
  onValidityChange?: (valid: boolean) => void;
  promptWidth?: number;
  disabled?: boolean;
}

/**
 * A colour typed as `#rrggbb` in a PromptField with a live swatch right after the value, plus one-click
 * presets of the palette hues. Validates on blur; `onChange` only ever receives a valid colour. The
 * native colour picker is not used: it cannot be themed.
 */
export function ColourField({
  label,
  user,
  value,
  onChange,
  allowEmpty,
  hint = "Type any #rrggbb, or pick a palette colour.",
  presets = true,
  onValidityChange,
  promptWidth,
  disabled,
}: ColourFieldProps) {
  const [draft, setDraft] = useState(value);
  const [error, setError] = useState<string | null>(null);
  const [tokens, setTokens] = useState<Record<ColourPreset, string | null> | null>(null);
  useEffect(() => setTokens(readPresetHexes()), []);
  useEffect(() => {
    if ((normaliseHex(draft) ?? draft) !== (normaliseHex(value) ?? value)) setDraft(value);
    // only follow outside changes of the value, not every keystroke
  }, [value]);
  const valid = normaliseHex(draft);
  const ok = valid != null || (!!allowEmpty && !draft.trim());
  useEffect(() => onValidityChange?.(ok), [ok]);
  const shown: readonly ColourPreset[] = presets === true ? COLOUR_PRESETS : presets === false ? [] : presets;
  const pick = (hex: string) => {
    setDraft(hex);
    setError(null);
    onChange(hex);
  };
  return (
    <>
      <PromptField
        label={label}
        user={user}
        value={draft}
        disabled={disabled}
        promptWidth={promptWidth}
        className="colour"
        spellCheck={false}
        autoComplete="off"
        placeholder="#rrggbb"
        hint={hint}
        error={error}
        trailing={<Swatch colour={valid ?? undefined} />}
        onChange={(text) => {
          setDraft(text);
          const hex = normaliseHex(text);
          if (hex) {
            setError(null);
            onChange(hex);
          } else if (allowEmpty && !text.trim()) {
            setError(null);
            onChange("");
          }
        }}
        onBlur={() => {
          if (ok) setError(null);
          else setError("Use # and six hex digits (#rrggbb).");
        }}
      />
      {shown.length > 0 && tokens && (
        <div className="swatches" role="group" aria-label="palette colours">
          {shown.map((p) => {
            const hex = tokens[p];
            if (!hex) return null;
            const on = valid === hex;
            return (
              <button
                key={p}
                type="button"
                className={cx("swatch", on && "on")}
                style={{ "--sw": `var(--color-${p})` } as CSSProperties}
                aria-label={p}
                aria-pressed={on}
                disabled={disabled}
                onClick={() => pick(hex)}
              />
            );
          })}
        </div>
      )}
    </>
  );
}

/* ------------------------------------------------------------------------------------------------ */

/** Props of {@link DateTimeField}. */
export interface DateTimeFieldProps {
  label: ReactNode;
  user?: ReactNode;
  /** The current date, or null for empty. */
  value: Date | null;
  /** Called with the typed date (local time) once it is valid, and with null when the field is emptied. */
  onChange: (date: Date | null) => void;
  /** `YYYY-MM-DD` without a time. */
  dateOnly?: boolean;
  /** An empty field is an error. */
  required?: boolean;
  /** Overrides the format hint (default: the format and the visitor's time zone). */
  hint?: ReactNode;
  /** An error from outside (for example "ends before it starts"); shown instead of the hint. */
  error?: ReactNode;
  /**
   * Called whenever the typed text turns valid or invalid. `onChange` only fires for valid text, so a
   * form uses this to refuse saving while a half-typed date sits in the field. An empty field counts as
   * valid unless `required`.
   */
  onValidityChange?: (valid: boolean) => void;
  promptWidth?: number;
  disabled?: boolean;
}

/**
 * A date or date and time typed in a PromptField as `2026-11-28 20:00`, in the visitor's time zone, with
 * the format in the hint. Checked on blur (a missing day reads `There is no 31 November.`); `onChange`
 * receives a `Date` as soon as the text is a real date.
 */
export function DateTimeField({
  label,
  user,
  value,
  onChange,
  dateOnly,
  required,
  hint,
  error: outerError,
  onValidityChange,
  promptWidth,
  disabled,
}: DateTimeFieldProps) {
  const [draft, setDraft] = useState(() => formatDateTimeInput(value, dateOnly));
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const parsed = parseDateTimeInput(draft, dateOnly);
    const same = parsed.ok && (parsed.date?.getTime() ?? null) === (value?.getTime() ?? null);
    if (!same) setDraft(formatDateTimeInput(value, dateOnly));
    // follow outside changes only
  }, [value?.getTime(), dateOnly]);
  const defaultHint = dateOnly
    ? "year-month-day, like 2026-11-28."
    : `year-month-day hour:minute, your time zone (${timeZoneName()}).`;
  const check = (text: string) => {
    const parsed = parseDateTimeInput(text, dateOnly);
    if (!parsed.ok) return parsed.error;
    if (parsed.date === null && required) return "This one cannot be empty.";
    return null;
  };
  const ok = check(draft) === null;
  useEffect(() => onValidityChange?.(ok), [ok]);
  return (
    <PromptField
      label={label}
      user={user}
      value={draft}
      disabled={disabled}
      promptWidth={promptWidth}
      inputMode="numeric"
      autoComplete="off"
      spellCheck={false}
      placeholder={dateOnly ? "yyyy-mm-dd" : "yyyy-mm-dd hh:mm"}
      hint={hint ?? defaultHint}
      error={error ?? outerError}
      onChange={(text) => {
        setDraft(text);
        const parsed = parseDateTimeInput(text, dateOnly);
        if (parsed.ok) {
          if (error && !check(text)) setError(null);
          onChange(parsed.date);
        }
      }}
      onBlur={() => setError(check(draft))}
    />
  );
}
