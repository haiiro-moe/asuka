/**
 * The basic haiiro pieces of the dashboard: prompt lines, windows, the page head, ink buttons and links,
 * chips, swatches, image frames, the blob backdrop and the shell for token pages. Each one renders the
 * system's markup (`themes/haiiro-design-system/project/components/<Name>/README.md`) with real elements.
 *
 * @module
 */
import { useEffect, useRef, useState } from "react";
import type {
  AnchorHTMLAttributes,
  ButtonHTMLAttributes,
  CSSProperties,
  ReactNode,
  Ref,
} from "react";
import { startBlobs } from "./blobs.ts";

/** Joins class names, skipping empty ones. */
export function cx(...names: (string | false | null | undefined)[]): string {
  return names.filter(Boolean).join(" ");
}

/* ------------------------------------------------------------------------------------------------ */

/** Props of {@link PromptLine}. */
export interface PromptLineProps {
  /** The place before the arrow (foam). Defaults to `asuka`. */
  user?: ReactNode;
  /** The command (gold), for example `cat` or `cd`. */
  cmd?: ReactNode;
  /** Files or arguments after the command (iris). */
  args?: ReactNode;
  /** Render as a paragraph (default) or inline. */
  as?: "p" | "span";
  className?: string;
}

/**
 * A fake shell prompt, `@ asuka » cmd args`, each part in its own ink: `@` love, the place foam, `»` rose,
 * the command gold, arguments iris.
 */
export function PromptLine({ user = "asuka", cmd, args, as = "p", className }: PromptLineProps) {
  const Tag = as;
  return (
    <Tag className={className}>
      <span className="c2">@</span> <span className="c6">{user}</span>{" "}
      <span className="c4" aria-hidden="true">
        »
      </span>
      {cmd != null && (
        <>
          {" "}
          <span className="c3">{cmd}</span>
        </>
      )}
      {args != null && (
        <>
          {" "}
          <span className="c7">{args}</span>
        </>
      )}
    </Tag>
  );
}

/* ------------------------------------------------------------------------------------------------ */

/** What a window's frame colour says: pine by default, gold needs you, love failed or destructive, foam done, off not there. */
export type WindowTone = "pine" | "gold" | "love" | "foam" | "off";

/** Props of {@link Window}. */
export interface WindowProps {
  /** The label notched into the top edge, written like a prompt: `fish: ~/council`. */
  label?: ReactNode;
  tone?: WindowTone;
  /** A footer line under a hairline: key hints left, where it saves to on the right (`<span className="r">`). */
  foot?: ReactNode;
  /** The element to render. Defaults to `section`. */
  as?: "section" | "div" | "aside" | "nav" | "article";
  /** Accessible name, for a nav or a window whose label is not a good name. */
  ariaLabel?: string;
  id?: string;
  className?: string;
  /** Extra classes on the scrolling `.content` box. */
  contentClassName?: string;
  style?: CSSProperties;
  children?: ReactNode;
}

/**
 * The terminal pane every block of a page sits in: a surface box with a 5px double frame and a label
 * notched into its top edge. Content inside is written in lines.
 */
export function Window({
  label,
  tone = "pine",
  foot,
  as = "section",
  ariaLabel,
  id,
  className,
  contentClassName,
  style,
  children,
}: WindowProps) {
  const Tag = as;
  const toneClass = tone === "pine" ? null : tone === "off" ? "fx-off" : tone;
  return (
    <Tag className={cx("window", toneClass, className)} aria-label={ariaLabel} id={id} style={style}>
      {label != null && <span className="section-header">{label}</span>}
      <div className={cx("content", contentClassName)}>{children}</div>
      {foot != null && <div className="foot">{foot}</div>}
    </Tag>
  );
}

/** Props of {@link Heading}. */
export interface HeadingProps {
  /** The first heading in a window sits closer to the top. */
  first?: boolean;
  /**
   * Heading level. Defaults to `h2`, the level under the page title (`h1`), so a page reads h1 then h2.
   * Use `h3` for a heading nested under another heading in the same window. The look is the same at
   * every level.
   */
  as?: "h2" | "h3" | "h4" | "p";
  className?: string;
  children: ReactNode;
}

/** A heading inside a window (`.hd`): foam, lowercase, at body size. */
export function Heading({ first, as = "h2", className, children }: HeadingProps) {
  const Tag = as;
  return <Tag className={cx("hd", first && "first", className)}>{children}</Tag>;
}

/* ------------------------------------------------------------------------------------------------ */

/** Props of {@link PageHead}. */
export interface PageHeadProps {
  /** The display title: one lowercase word or two (Jacquard 24). */
  title: string;
  /** Narration in rose, second person, one or two sentences. The system's CSS draws the gold drop cap. */
  lede?: ReactNode;
  /** The prompt's command. Defaults to `cat`. Pass `null` to leave the prompt line out. */
  cmd?: ReactNode | null;
  /** The prompt's argument. Defaults to the title as a file, `<title>.md`. */
  args?: ReactNode;
  /** The prompt's place. Defaults to `asuka`. */
  user?: ReactNode;
  /** A quiet second line under the lede. */
  note?: ReactNode;
  /** Whatever switches the page (a Segmented, filters, a row of links). */
  children?: ReactNode;
}

/**
 * A page title with each word in its own unbreakable span, so a line can end between words but never
 * inside one (not even at the hyphen of `auto-replies`). The CSS sizes the title so the longest word
 * fits the column at every width.
 */
function TitleWords({ title }: { title: string }) {
  const words = title.trim().split(/\s+/);
  return (
    <>
      {words.map((w, i) => (
        <span key={i}>
          {i > 0 && " "}
          <span className="w">{w}</span>
        </span>
      ))}
    </>
  );
}

/**
 * The top of a page, straight on the blobs: a prompt line, the display title with the hard title shadow,
 * and a narrator lede whose first letter the system turns into a gold Jacquard drop cap. The title is
 * the page's only `h1`; window headings ({@link Heading}) are `h2`.
 */
export function PageHead({ title, lede, cmd = "cat", args, user, note, children }: PageHeadProps) {
  return (
    <section className="fx-head">
      {cmd !== null && <PromptLine user={user} cmd={cmd} args={args ?? `${title.replace(/\s+/g, "-")}.md`} />}
      <h1 className="title">
        <TitleWords title={title} />
      </h1>
      {lede != null && <p className="lede">{lede}</p>}
      {note != null && <p className="text-subtle">{note}</p>}
      {children}
    </section>
  );
}

/* ------------------------------------------------------------------------------------------------ */

/**
 * An ink colour and its job. gold: the one action of a window (save, apply, buy, start); love: refuses or
 * deletes; muted: dismisses or cancels; pine: a lasting choice; flat: quiet row actions and toolbar
 * glyphs; foam, rose, iris, text: rarely needed.
 */
export type InkTone = "gold" | "love" | "muted" | "pine" | "foam" | "rose" | "iris" | "text" | "flat";

const INK_CLASS: Record<InkTone, string | null> = {
  muted: "c1",
  love: "c2",
  gold: "c3",
  rose: "c4",
  pine: "c5",
  foam: "c6",
  iris: "c7",
  text: null,
  flat: "flat",
};

/** Props of {@link InkButton}. */
export interface InkButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** The colour and job. Defaults to `muted`. */
  tone?: InkTone;
  /** A pressed toolbar state, for `flat` buttons. */
  on?: boolean;
  /** While true the button is disabled and shows `busyLabel` instead of its children. */
  busy?: boolean;
  /** The label while busy, for example `saving`. */
  busyLabel?: ReactNode;
  ref?: Ref<HTMLButtonElement>;
}

/**
 * A real `<button>` in the InkLink look: a block of colour with surface text, no border, no radius,
 * a 2px foam focus ring. Labels are lowercase words. One gold button per window is the guideline.
 */
export function InkButton({
  tone = "muted",
  on,
  busy,
  busyLabel,
  className,
  type = "button",
  disabled,
  children,
  ...rest
}: InkButtonProps) {
  return (
    <button
      type={type}
      className={cx("ink", INK_CLASS[tone], on && "on", className)}
      disabled={disabled || busy}
      aria-busy={busy || undefined}
      {...rest}
    >
      {busy && busyLabel != null ? busyLabel : children}
    </button>
  );
}

/** Props of {@link InkLink}. */
export interface InkLinkProps extends AnchorHTMLAttributes<HTMLAnchorElement> {
  /** The ink. Defaults to `foam`. */
  tone?: InkTone;
}

/**
 * A link in the InkButton look (`a.ink.c3` and friends): a block of colour with surface text. For links
 * that read as an action, such as `login with discord` or `logout`.
 */
export function InkLink({ tone = "foam", className, children, ...rest }: InkLinkProps) {
  return (
    <a className={cx("ink", INK_CLASS[tone], className)} {...rest}>
      {children}
    </a>
  );
}

/* ------------------------------------------------------------------------------------------------ */

/** Props of {@link Chip}. */
export interface ChipProps {
  /** Solid with a check mark when on; dashed and muted when off. */
  on?: boolean;
  /** Makes the chip a switch (`button.chip` with `role="switch"`), called with the next state. */
  onToggle?: (next: boolean) => void;
  disabled?: boolean;
  /** Accessible name when the text alone is not enough. */
  ariaLabel?: string;
  title?: string;
  className?: string;
  children: ReactNode;
}

/**
 * A small square tag. Static, it is a status or count (`.chip`, `.chip.on`). With `onToggle` it becomes
 * an on/off switch, for grids of many toggles (one chip per item, the item as its text).
 */
export function Chip({ on, onToggle, disabled, ariaLabel, title, className, children }: ChipProps) {
  const cls = cx("chip", on && "on", className);
  if (!onToggle) {
    return (
      <span className={cls} title={title}>
        {children}
      </span>
    );
  }
  return (
    <button
      type="button"
      role="switch"
      aria-checked={!!on}
      aria-label={ariaLabel}
      title={title}
      disabled={disabled}
      className={cls}
      onClick={() => onToggle(!on)}
    >
      {children}
    </button>
  );
}

/** A solid uppercase tag after a heading (`.badge`), such as `new` or `sold out`. */
export function Badge({ className, children }: { className?: string; children: ReactNode }) {
  return <span className={cx("badge", className)}>{children}</span>;
}

/* ------------------------------------------------------------------------------------------------ */

/** Props of {@link Swatch}. */
export interface SwatchProps {
  /** Any CSS colour: a data colour (`#rrggbb`) or a token (`var(--color-foam)`). Empty shows the base colour. */
  colour?: string | null;
  /** Accessible name. Without it the swatch is decoration (hidden from assistive tech). */
  label?: string;
  className?: string;
}

/**
 * A 16px square of colour with a text hairline: the only way a colour that comes from data (role colours,
 * event accents) is shown. Text is never coloured by data.
 */
export function Swatch({ colour, label, className }: SwatchProps) {
  const style = colour ? ({ "--sw": colour } as CSSProperties) : undefined;
  return label ? (
    <span className={cx("swatch", className)} style={style} role="img" aria-label={label} />
  ) : (
    <span className={cx("swatch", className)} style={style} aria-hidden="true" />
  );
}

/* ------------------------------------------------------------------------------------------------ */

/** Props of {@link ImageFrame}. */
export interface ImageFrameProps {
  /** The image URL. Without one (or when it fails to load) the frame shows `children`, or a dither. */
  src?: string | null;
  /** Alternative text; empty string for decorative images. */
  alt: string;
  /** Edge length in CSS pixels. Defaults to 32 (lists); 96 on a profile. */
  size?: number;
  /** Fallback content, for example a store icon given as text. */
  children?: ReactNode;
  className?: string;
}

/**
 * A content image (avatar, AniList art, event image, store icon) in full colour, cropped square inside a
 * 1px ink-muted hairline, no radius and no shadow (the system's imagery exception).
 */
export function ImageFrame({ src, alt, size = 32, children, className }: ImageFrameProps) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [src]);
  const style: CSSProperties = { width: size, height: size };
  if (src && !failed) {
    return (
      <span className={cx("frame", className)} style={style}>
        <img src={src} alt={alt} loading="lazy" decoding="async" onError={() => setFailed(true)} />
      </span>
    );
  }
  if (children != null) {
    return (
      <span className={cx("frame glyph", className)} style={style} role={alt ? "img" : undefined} aria-label={alt || undefined}>
        {children}
      </span>
    );
  }
  return (
    <span className={cx("frame", className)} style={style} role={alt ? "img" : undefined} aria-label={alt || undefined}>
      <span className="dith block h-full w-full" aria-hidden="true" />
    </span>
  );
}

/* ------------------------------------------------------------------------------------------------ */

/**
 * The live blob background (haiiro's default backdrop), fixed behind the page. Decoration only: hidden
 * from assistive tech, no pointer events, one still frame under reduced motion, paused while the tab is
 * hidden. Render it once, as the first child of the `.fx` shell root. Algorithm from fishnet's
 * `startBlobs`, see {@link startBlobs}.
 */
export function Blobs() {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => (ref.current ? startBlobs(ref.current) : undefined), []);
  return (
    <div className="fx-blobs blobs-host" aria-hidden="true">
      <canvas ref={ref} width={240} height={150} />
    </div>
  );
}

/** Props of {@link StandaloneShell}. */
export interface StandaloneShellProps {
  /** The prompt line in the bar, for example `<PromptLine cmd="vim" args="~/panel" as="span" />`. */
  where?: ReactNode;
  children: ReactNode;
}

/**
 * The frame for pages outside the dashboard (the `/panel/:token` and `/club-announce/:token` links): the
 * `.fx` scope, the blob backdrop, a bar with the brand, and one main column.
 */
export function StandaloneShell({ where, children }: StandaloneShellProps) {
  return (
    <div className="fx min-h-screen">
      <Blobs />
      <header className="fx-bar">
        <span className="fx-brand">asuka</span>
        {where != null && <span className="fx-where">{where}</span>}
      </header>
      <div className="fx-body">
        <main className="fx-main">{children}</main>
      </div>
    </div>
  );
}
