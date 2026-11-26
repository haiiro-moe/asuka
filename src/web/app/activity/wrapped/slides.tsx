/**
 * The pieces of the Wrapped story pages: the phone-shaped frame ({@link StoryShell}), the player around
 * the slides ({@link StoryFrame}: progress bar, play and pause, tap zones, arrow keys, the dither veil,
 * autoplay, and `save image` / `copy link` on the last slide), and the slides of the personal story
 * ({@link PersonalSlideView}) and the server story ({@link ServerSlideView}).
 *
 * The rules come from `story.ts`; this file only draws. Everything is haiiro markup from the bundle
 * (`window`, `progress_track`, `veil`, `stat-panel`, `fx-cols`, `fx-rank`, `mirror`, `fx-axis`, `nar`);
 * Tailwind is used for layout only.
 *
 * @module
 */
import { useEffect, useRef, useState, type ReactNode } from "react";
import type { ServerWrapped, WrappedLinkResponse } from "../../../../plugins/activity/types/wrapped.ts";
import { ActivityColumns, ActivityRank, type ActivityRankRow } from "../charts.tsx";
import { Blobs, ErrorLine, InkButton, Loading, PromptLine, Saved, Window, cx, useReducedMotion } from "../../ui/index.ts";
import {
  STEP_MS,
  capitalise,
  emojiKeyLabel,
  emojiLabel,
  formatNumber,
  go,
  hourLabel,
  keyAction,
  ordinal,
  readoutSize,
  segmentFill,
  tick,
  veilFrame,
  type StoryState,
} from "./story.ts";

/* ------------------------------------------------------------------------------------------------ */
/* The frame                                                                                         */

/** Props of {@link StoryShell}. */
export interface StoryShellProps {
  /** The window label, like a prompt: `fish: ~/wrapped/2026`. */
  label: string;
  /** Accessible name of the window. */
  ariaLabel?: string;
  /** Extra classes on the window's content box. */
  contentClassName?: string;
  children: ReactNode;
}

/**
 * The page around a story: the `.fx` scope, the blob backdrop and one tall, phone-shaped Window. On a
 * phone (below 721px) the window fills the viewport height; on wider screens it is centred and keeps a
 * 9:19.5 shape, at most 420px wide and never stretched wide.
 */
export function StoryShell({ label, ariaLabel, contentClassName, children }: StoryShellProps) {
  return (
    <div className="fx min-h-screen">
      <Blobs />
      <main className="relative z-[1] flex min-h-[100dvh] items-start justify-center pt-[10px] desk:items-center desk:p-6">
        <Window
          label={label}
          ariaLabel={ariaLabel}
          className="m-0 flex h-[calc(100dvh-10px)] w-full min-w-0 max-w-[420px] shrink-0 flex-col desk:aspect-[9/19.5] desk:h-[min(calc(100dvh-48px),910px)] desk:w-auto"
          contentClassName={cx("flex min-h-0 flex-1 flex-col gap-3 overflow-hidden", contentClassName)}
        >
          {children}
        </Window>
      </main>
    </div>
  );
}

/** Props of {@link StoryFrame}. */
export interface StoryFrameProps<T extends string> {
  /** The window label: `fish: ~/wrapped/2026`. */
  label: string;
  /** The place in the header prompt, `@ <who> » wrapped`. */
  who: string;
  /** The slides, in order (from `personalSlides` or `serverSlides`). */
  slides: T[];
  /** Draws one slide. */
  render: (slide: T) => ReactNode;
  /** The card PNG behind `save image`. */
  cardUrl: string;
  /** The file name `save image` downloads as. */
  cardFile: string;
}

/**
 * The story player. Autoplay moves one step a second, six steps a slide, and can be paused; the progress
 * bar fills in those steps. The left 35% of the slide goes back and the right 65% goes on (real buttons),
 * as do the left and right arrow keys; Space plays or pauses. A slide change runs the dither veil over
 * three 100 ms frames (sparse, dense, sparse) and swaps the slide on the dense one. Under
 * `prefers-reduced-motion` there is no veil and no autoplay (the play control is not shown). On the last
 * slide the hint row becomes `save image` and `copy link`.
 */
export function StoryFrame<T extends string>({ label, who, slides, render, cardUrl, cardFile }: StoryFrameProps<T>) {
  const count = slides.length;
  const reduced = useReducedMotion();
  const [state, setState] = useState<StoryState>({ slide: 0, step: 0, paused: false });
  const [shown, setShown] = useState(0);
  const shownRef = useRef(0);
  const [frame, setFrame] = useState<0 | 1 | 2 | 3>(0);

  // Autoplay: one step a second, never under reduced motion.
  useEffect(() => {
    if (reduced || state.paused) return;
    const t = setInterval(() => setState((s) => tick(s, count)), STEP_MS);
    return () => clearInterval(t);
  }, [reduced, state.paused, count]);

  // The veil: three stepped frames over 300 ms; the slide swaps on frame 2. Reduced motion cuts at once.
  useEffect(() => {
    const target = state.slide;
    const swap = () => {
      shownRef.current = target;
      setShown(target);
    };
    if (target === shownRef.current) {
      setFrame(0);
      return;
    }
    if (reduced) {
      swap();
      setFrame(0);
      return;
    }
    const start = performance.now();
    let raf = 0;
    const loop = () => {
      const f = veilFrame(performance.now() - start);
      if (f === 2 || f === 3 || f === 0) swap();
      setFrame(f);
      if (f !== 0) raf = requestAnimationFrame(loop);
    };
    loop();
    return () => cancelAnimationFrame(raf);
  }, [state.slide, reduced]);

  // Arrow keys move, Space plays or pauses. Space on a focused button keeps its own meaning.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const action = keyAction(e.key);
      if (!action) return;
      const target = e.target instanceof Element ? e.target : null;
      if (target?.closest("input, textarea, select, [contenteditable='true']")) return;
      if (action === "toggle") {
        if (reduced || target?.closest("button, a")) return;
        e.preventDefault();
        setState((s) => ({ ...s, paused: !s.paused }));
        return;
      }
      e.preventDefault();
      setState((s) => go(s, s.slide + (action === "next" ? 1 : -1), count));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [count, reduced]);

  const prev = () => setState((s) => go(s, s.slide - 1, count));
  const next = () => setState((s) => go(s, s.slide + 1, count));
  const togglePause = () => setState((s) => ({ ...s, paused: !s.paused }));
  const last = state.slide === count - 1;
  const current = slides[shown] ?? slides[0];

  return (
    <StoryShell label={label} ariaLabel="wrapped story">
      <div className="flex min-h-[32px] items-center gap-3">
        <PromptLine user={who} cmd="wrapped" as="span" className="min-w-0 flex-1 truncate" />
        {!reduced && (
          <InkButton tone="flat" onClick={togglePause} aria-label={state.paused ? "play the story" : "pause the story"}>
            {state.paused ? "play" : "pause"}
          </InkButton>
        )}
      </div>

      <div className="flex gap-1" aria-hidden="true">
        {slides.map((s, i) => (
          <div key={s} className="progress_track min-w-0 flex-1">
            <div className="progress_fill" style={{ width: `${segmentFill(state, i, count)}%` }} />
          </div>
        ))}
      </div>
      <p className="sr-only" aria-live="polite">
        slide {state.slide + 1} of {count}
      </p>

      <div className="relative min-h-0 flex-1 overflow-hidden">
        <div className="pointer-events-none h-full">{current !== undefined && render(current)}</div>
        {frame !== 0 && <div className={cx("veil pointer-events-none", frame === 2 && "heavy")} aria-hidden="true" />}
        <button
          type="button"
          aria-label="previous slide"
          className="absolute inset-y-0 left-0 w-[35%] cursor-pointer border-0 bg-transparent p-0 -outline-offset-2"
          onClick={prev}
        />
        <button
          type="button"
          aria-label="next slide"
          className="absolute inset-y-0 right-0 w-[65%] cursor-pointer border-0 bg-transparent p-0 -outline-offset-2"
          onClick={next}
        />
      </div>

      {last ? (
        <CardActions cardUrl={cardUrl} cardFile={cardFile} />
      ) : (
        <p className="text-label text-subtle">
          tap left to go back, right to go on <span className="kbd">←</span> <span className="kbd">→</span>
          {!reduced && (
            <>
              {" "}
              <span className="kbd">space</span>
            </>
          )}
        </p>
      )}
    </StoryShell>
  );
}

/** `save image` (downloads the card PNG) and `copy link` (copies the page address), with their result. */
function CardActions({ cardUrl, cardFile }: { cardUrl: string; cardFile: string }) {
  const [saving, setSaving] = useState(false);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);

  const save = async () => {
    setSaving(true);
    setNote(null);
    try {
      const res = await fetch(cardUrl, { credentials: "omit" });
      const type = res.headers.get("content-type") ?? "";
      // When the card cannot be drawn the route answers with JSON instead of a PNG.
      if (!res.ok || !type.startsWith("image/")) throw new Error("no image");
      const url = URL.createObjectURL(await res.blob());
      const a = document.createElement("a");
      a.href = url;
      a.download = cardFile;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setNote({ ok: true, text: "image saved." });
    } catch {
      setNote({ ok: false, text: "The card would not draw. You try again later." });
    } finally {
      setSaving(false);
    }
  };

  const copy = async () => {
    setNote(null);
    try {
      await navigator.clipboard.writeText(location.href);
      setNote({ ok: true, text: "link copied." });
    } catch {
      setNote({ ok: false, text: "Copying is blocked here. You copy the address bar instead." });
    }
  };

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <InkButton tone="gold" busy={saving} busyLabel="saving" onClick={save}>
          save image
        </InkButton>
        <InkButton tone="pine" onClick={copy}>
          copy link
        </InkButton>
        {note?.ok && <Saved>{note.text}</Saved>}
      </div>
      {note && !note.ok && (
        <p className="nar love" role="alert">
          {note.text}
        </p>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------------------------------------ */
/* Loading                                                                                           */

/** Where a public story fetch is. `missing` is the uniform 404 of an unknown or truncated token. */
export type PublicLoad<T> =
  | { state: "loading" }
  | { state: "missing" }
  | { state: "error" }
  | { state: "ready"; value: T };

/**
 * Fetches a public story route without the cookie session (`credentials: "omit"`; the token in the URL
 * is the authorisation). A 404 is `missing`; any other failure, or a body that fails `valid`, is
 * `error`, which `retry` fetches again.
 *
 * @param url - The same-origin API path.
 * @param valid - Checks the parsed body's shape.
 */
export function usePublicJson<T>(url: string, valid: (v: unknown) => v is T): { load: PublicLoad<T>; retry: () => void } {
  const [load, setLoad] = useState<PublicLoad<T>>({ state: "loading" });
  const [attempt, setAttempt] = useState(0);
  const validRef = useRef(valid);
  validRef.current = valid;
  useEffect(() => {
    let live = true;
    setLoad({ state: "loading" });
    fetch(url, { credentials: "omit" })
      .then(async (res) => {
        if (res.status === 404) return { state: "missing" } as const;
        if (!res.ok) return { state: "error" } as const;
        const body: unknown = await res.json();
        return validRef.current(body) ? ({ state: "ready", value: body } as const) : ({ state: "error" } as const);
      })
      .catch(() => ({ state: "error" }) as const)
      .then((next) => {
        if (live) setLoad(next);
      });
    return () => {
      live = false;
    };
  }, [url, attempt]);
  return { load, retry: () => setAttempt((n) => n + 1) };
}

/**
 * The story frame with one narrator line in it, for a story that is loading, does not exist or failed
 * to load. Never a blank page.
 */
export function StoryNotice({ label, load, retry }: { label: string; load: PublicLoad<unknown>; retry: () => void }) {
  return (
    <StoryShell label={label} ariaLabel="wrapped story" contentClassName="justify-center px-2">
      {load.state === "loading" ? (
        <Loading>You open the envelope</Loading>
      ) : load.state === "missing" ? (
        <ErrorLine>This link opens nothing. You check that you copied all of it.</ErrorLine>
      ) : (
        <ErrorLine onRetry={retry}>The story would not load. You try again in a moment.</ErrorLine>
      )}
    </StoryShell>
  );
}

/* ------------------------------------------------------------------------------------------------ */
/* Slide parts                                                                                       */

/** One slide: a `» label` prompt, then its parts, pushed to the middle of the slide area. */
function Slide({ label, fill, children }: { label: string; fill?: boolean; children: ReactNode }) {
  return (
    <div className="flex h-full flex-col px-1">
      <div className={cx("flex flex-col gap-4", fill ? "min-h-0 flex-1 py-2" : "my-auto")}>
        <p className="cmd">{label}</p>
        {children}
      </div>
    </div>
  );
}

/** A big readout in Jacquard 24 (86px, or 64px for long ones), with an optional IBM unit after it. */
function Readout({ value, unit, tone = "c3" }: { value: string; unit?: string; tone?: "c3" | "c6" | "c7" | null }) {
  return (
    <p className={cx("disp break-all", tone, readoutSize(value) === 86 ? "text-[86px]" : "text-[64px]")}>
      {value}
      {unit && <span className="ml-2 font-mono text-nav text-subtle">{unit}</span>}
    </p>
  );
}

/** A name or other long text in IBM at 32px, white. */
function Big({ children }: { children: ReactNode }) {
  return <p className="text-nav break-words">{children}</p>;
}

/** A narrator line: sentence case, rose. */
function Nar({ children }: { children: ReactNode }) {
  return <p className="nar">{children}</p>;
}

/** One cell of {@link Stats}. */
interface Stat {
  label: string;
  value: string;
  note?: string;
}

/** The hairline stat panel, two cells a row; an odd last cell spans the row. */
function Stats({ items }: { items: (Stat | false | null | undefined)[] }) {
  const cells = items.filter((s): s is Stat => !!s);
  if (cells.length === 0) return null;
  return (
    <div className="stat-panel grid-cols-2">
      {cells.map((s) => (
        <div key={s.label} className="kv odd:last:col-span-2">
          <span className="kv_label">{s.label}</span>
          <span className="kv_value break-words">{s.value}</span>
          {s.note && <span className="text-label text-subtle">{s.note}</span>}
        </div>
      ))}
    </div>
  );
}

/** The 24 UTC hours as columns with only the busiest one drawn (gold), on the `fx-axis` line. */
function HourColumns({ hour }: { hour: number }) {
  const values = Array.from({ length: 24 }, (_, i) => (i === hour ? 1 : 0));
  return <ActivityColumns values={values} nowIndex={hour} axis={["00", "06", "12", "18", "23"]} />;
}

/**
 * A ranked list with its bars kept on the phone column (the bundle hides them below 721px) and the
 * second line (`thread in #parent`) on its own line.
 */
function Rank({ rows }: { rows: ActivityRankRow[] }) {
  return (
    <div className="[&_.bar]:block [&_.note]:block [&_.note]:truncate [&_.note]:text-label [&_.note]:text-subtle [&_.row]:grid-cols-[3ch_0px_minmax(0,1fr)_minmax(0,0.8fr)_8ch] [&_.row]:gap-x-2">
      <ActivityRank rows={rows} />
    </div>
  );
}

/**
 * The mirror bars: the server's messages per day over the year (foam, up) against the same during a
 * presidency (iris, down), from `serverActivityPercent`.
 */
function MirrorPair({ percent, them }: { percent: number; them: string }) {
  const year = 100;
  const office = Math.max(0, 100 + percent);
  const max = Math.max(year, office, 1);
  return (
    <div className="flex items-stretch gap-3">
      <div className="mirror [&_i]:w-10" aria-hidden="true">
        <div className="dn">
          <i style={{ height: `${(year / max) * 100}%` }} />
        </div>
        <div className="base" />
        <div className="up">
          <i style={{ height: `${(office / max) * 100}%` }} />
        </div>
      </div>
      <div className="flex flex-col justify-between py-1 text-label">
        <span className="c6">the year, per day</span>
        <span className="c7">{them}, per day</span>
      </div>
    </div>
  );
}

/** How the server's pace changed during a presidency, as a narrator sentence. */
function activityLine(percent: number, who: "you" | "they"): string {
  const held = who === "you" ? "while you held the chair" : "while they held the chair";
  if (percent > 0) return `The server was ${percent}% busier per day ${held}.`;
  if (percent < 0) return `The server was ${-percent}% quieter per day ${held}.`;
  return `The server kept its usual pace ${held}.`;
}

/** What the busiest hour says about someone, as a narrator sentence. */
function hourLine(hour: number): string {
  if (hour < 5) return "You were up late: most of your messages landed after midnight.";
  if (hour < 12) return "You were a morning writer.";
  if (hour < 18) return "Afternoons were your time.";
  return "Evenings were your time.";
}

/** Hours with at most one decimal: `40.5`. */
function hours(h: number): string {
  return h.toLocaleString("en-GB", { maximumFractionDigits: 1 });
}

/** `n thing` or `n things`. */
function plural(n: number, one: string, many: string): string {
  return `${formatNumber(n)} ${n === 1 ? one : many}`;
}

/** A channel as the slides write it: `#name`, or for a thread its own name with `thread in #parent`. */
function channelParts(name: string | null, parentName: string | null): { label: string; sub?: string } {
  if (parentName !== null) return { label: name ?? "a thread", sub: `thread in #${parentName}` };
  return { label: name !== null ? `#${name}` : "a channel" };
}

/** The card image of the outro in a hairline frame; a dither placeholder when it will not load. */
function StoryCard({ src, alt }: { src: string; alt: string }) {
  const [failed, setFailed] = useState(false);
  return (
    <div className="flex min-h-0 flex-1 items-center justify-center">
      {failed ? (
        <span className="dith block aspect-[4/5] h-full max-h-[320px] border border-ink-muted" role="img" aria-label={alt} />
      ) : (
        <img
          src={src}
          alt={alt}
          decoding="async"
          className="block h-auto max-h-full w-auto max-w-full border border-ink-muted object-contain"
          onError={() => setFailed(true)}
        />
      )}
    </div>
  );
}

/* ------------------------------------------------------------------------------------------------ */
/* The personal story                                                                                */

/** Props of {@link PersonalSlideView}. */
export interface PersonalSlideViewProps {
  /** The slide to draw (from `personalSlides`). */
  slide: string;
  /** The public link response: the snapshot plus resolved names. */
  res: WrappedLinkResponse;
  /** The card PNG URL for the outro. */
  cardUrl: string;
}

/**
 * One slide of a member's story. The voice slide never appears while `voiceHours` is null, and the
 * soulmate slide then leaves out the shared-call part.
 */
export function PersonalSlideView({ slide, res, cardUrl }: PersonalSlideViewProps) {
  const d = res.data;
  switch (slide) {
    case "intro":
      return (
        <Slide label={`wrapped ${d.year}`}>
          <Readout value={String(d.year)} />
          <Big>{res.displayName}</Big>
          <Nar>This is your year on the server, as the bot saw it. Tap the right side to go on.</Nar>
        </Slide>
      );
    case "messages": {
      const ch = d.topChannelId !== null ? channelParts(res.topChannelName, res.topChannelParentName) : null;
      return (
        <Slide label="messages">
          <Readout value={formatNumber(d.messages)} />
          <Nar>
            You wrote {plural(d.messages, "message", "messages")} this year
            {d.busiestDay ? `, most of them on ${capitalise(d.busiestDay)}s` : ""}.
          </Nar>
          <Stats
            items={[
              { label: "level", value: String(d.xpLevel) },
              d.busiestDay !== null && { label: "busiest day", value: d.busiestDay },
              ch && { label: "top channel", value: ch.label, note: ch.sub },
            ]}
          />
        </Slide>
      );
    }
    case "hour": {
      const h = d.busiestHour ?? 0;
      return (
        <Slide label="busiest hour, utc">
          <Readout value={hourLabel(h)} />
          <HourColumns hour={h} />
          <Nar>{hourLine(h)} All times are UTC.</Nar>
        </Slide>
      );
    }
    case "emoji": {
      const top = d.topEmoji[0];
      if (!top) return null;
      return (
        <Slide label="top emoji">
          <Readout value={emojiLabel(top)} tone={null} />
          <Nar>You reached for it {plural(top.count, "time", "times")}.</Nar>
          {d.topEmoji.length > 1 && <Rank rows={d.topEmoji.map((e) => ({ label: emojiLabel(e), value: e.count }))} />}
        </Slide>
      );
    }
    case "voice": {
      const h = d.voiceHours ?? 0;
      const days = Math.floor(h / 24);
      return (
        <Slide label="voice">
          <Readout value={hours(h)} unit="h" tone="c6" />
          <Nar>
            You spent {hours(h)} {h === 1 ? "hour" : "hours"} in voice this year.
            {days >= 1 ? ` That is ${plural(days, "whole day", "whole days")} of talking.` : ""}
          </Nar>
        </Slide>
      );
    }
    case "soulmate": {
      const voice = d.voiceHours !== null;
      const other = d.mostRepliedToId !== null && d.mostRepliedToId !== d.soulmateId;
      const repliedName = res.mostRepliedToName ?? "a member who left";
      if (d.soulmateId === null) {
        return (
          <Slide label="most replied to">
            <Big>{repliedName}</Big>
            <Nar>You replied to them more than anyone.</Nar>
          </Slide>
        );
      }
      return (
        <Slide label="soulmate">
          <Big>{res.soulmateName ?? "a member who left"}</Big>
          <Nar>
            {voice
              ? "You replied to, mentioned and shared calls with them more than anyone."
              : "You replied to and mentioned them more than anyone."}
          </Nar>
          {other && <Stats items={[{ label: "most replied to", value: repliedName }]} />}
        </Slide>
      );
    }
    case "club": {
      const c = d.club;
      if (!c) return null;
      const of = `of ${plural(c.clubs, "club", "clubs")}`;
      return (
        <Slide label="your club">
          <Big>{c.name}</Big>
          <Nar>
            You run {c.name}. It finished {ordinal(c.messagesRank)} {of} by messages.
          </Nar>
          <Stats
            items={[
              { label: "members", value: formatNumber(c.members), note: `${ordinal(c.membersRank)} ${of}` },
              { label: "messages", value: formatNumber(c.messages), note: `${ordinal(c.messagesRank)} ${of}` },
              c.voiceRank !== null && { label: "voice", value: ordinal(c.voiceRank), note: of },
            ]}
          />
        </Slide>
      );
    }
    case "president": {
      const p = d.presidency;
      if (!p) return null;
      return (
        <Slide label="presidency">
          <Readout value={formatNumber(p.daysInOffice)} unit={p.daysInOffice === 1 ? "day" : "days"} />
          <Nar>
            You held the chair for {plural(p.daysInOffice, "day", "days")}
            {p.terms > 1 ? ` over ${formatNumber(p.terms)} terms` : ""}.
          </Nar>
          <Stats
            items={[
              p.votes !== null && {
                label: "votes",
                value: formatNumber(p.votes),
                note: p.votePercent !== null ? `${p.votePercent}% of the vote` : undefined,
              },
              { label: "messages in office", value: formatNumber(p.messagesInOffice), note: `${hours(p.perDay)} a day` },
              p.topEmojiInOffice !== null && { label: "emoji in office", value: emojiKeyLabel(p.topEmojiInOffice, d.topEmoji) },
            ]}
          />
          <MirrorPair percent={p.serverActivityPercent} them="your terms" />
          <Nar>{activityLine(p.serverActivityPercent, "you")}</Nar>
        </Slide>
      );
    }
    case "titles":
      return (
        <Slide label="titles">
          <Readout value={String(d.titles.length)} unit={d.titles.length === 1 ? "title" : "titles"} />
          <ul className="flex flex-col gap-2">
            {d.titles.map((t) => (
              <li key={t.key} className="flex flex-col">
                <span className="c3">★ {t.label}</span>
                <span className="text-label text-subtle">{t.detail}</span>
              </li>
            ))}
          </ul>
          <Nar>You took {d.titles.length === 1 ? "a title" : `${d.titles.length} titles`} this year.</Nar>
        </Slide>
      );
    case "outro":
      return (
        <Slide label={`that was ${d.year}`} fill>
          <StoryCard src={cardUrl} alt={`wrapped card, ${d.year}`} />
          <Nar>That was your year. Save the card, or send the link to someone.</Nar>
        </Slide>
      );
    default:
      return null;
  }
}

/* ------------------------------------------------------------------------------------------------ */
/* The server story                                                                                  */

/** Props of {@link ServerSlideView}. */
export interface ServerSlideViewProps {
  /** The slide to draw (from `serverSlides`). */
  slide: string;
  /** The server snapshot. */
  data: ServerWrapped;
  /** The server card PNG URL for the outro. */
  cardUrl: string;
}

/**
 * One slide of the server story. Only the best pair (both opted in), the best club's founder and the
 * president are named; voice figures are left out while they are null.
 */
export function ServerSlideView({ slide, data: d, cardUrl }: ServerSlideViewProps) {
  switch (slide) {
    case "intro":
      return (
        <Slide label={`wrapped ${d.year}`}>
          <Readout value={String(d.year)} />
          <Big>the server</Big>
          <Nar>This is the server's year, all of it, as the bot saw it. Tap the right side to go on.</Nar>
        </Slide>
      );
    case "totals":
      return (
        <Slide label="totals">
          <Readout value={formatNumber(d.messages)} />
          <Nar>
            {plural(d.speakers, "of you", "of you")} wrote {plural(d.messages, "message", "messages")}
            {d.voiceHours !== null ? ` and spent ${hours(d.voiceHours)} hours in voice` : ""}.
          </Nar>
          <Stats
            items={[
              { label: "messages", value: formatNumber(d.messages) },
              { label: "speakers", value: formatNumber(d.speakers) },
              d.voiceHours !== null && { label: "voice hours", value: hours(d.voiceHours) },
            ]}
          />
        </Slide>
      );
    case "emoji": {
      const top = d.topEmoji[0];
      const unused =
        d.unusedCustomEmoji === 0
          ? "Every custom emoji got used at least once."
          : `${d.unusedCustomEmoji === 1 ? "One custom emoji" : `${formatNumber(d.unusedCustomEmoji)} custom emoji`} went unused all year.`;
      return (
        <Slide label="emoji">
          {top ? <Readout value={emojiLabel(top)} tone={null} /> : <Big>no emoji</Big>}
          {d.topEmoji.length > 0 && <Rank rows={d.topEmoji.map((e) => ({ label: emojiLabel(e), value: e.count }))} />}
          <Nar>
            {top ? "" : "Nobody reached for an emoji this year. "}
            {unused}
          </Nar>
        </Slide>
      );
    }
    case "channels": {
      const rows = d.topChannels.map((c) => {
        const parts = channelParts(c.name, c.parentName);
        return { label: parts.label, sub: parts.sub, value: c.count };
      });
      return (
        <Slide label="channels">
          {rows.length > 0 ? <Rank rows={rows} /> : null}
          <Nar>{rows[0] ? `The loudest room was ${rows[0].label}.` : "Nobody wrote in a channel this year."}</Nar>
        </Slide>
      );
    }
    case "rhythm":
      return (
        <Slide label="rhythm, utc">
          {d.busiestHour !== null && (
            <>
              <Readout value={hourLabel(d.busiestHour)} />
              <HourColumns hour={d.busiestHour} />
            </>
          )}
          <Nar>
            {d.busiestHour !== null ? `The server peaked at ${hourLabel(d.busiestHour)} UTC` : "The server had no busiest hour"}
            {d.busiestWeekday ? `, and ${capitalise(d.busiestWeekday)}s were the busiest.` : "."}
          </Nar>
        </Slide>
      );
    case "pair": {
      const p = d.bestPair;
      if (!p) return null;
      const a = p.aName ?? "someone";
      const b = p.bName ?? "someone";
      return (
        <Slide label="the best pair">
          <Big>
            {a} <span className="c4">&amp;</span> {b}
          </Big>
          <Nar>
            {a} and {b} replied to each other {plural(p.replies, "time", "times")}
            {p.voiceHours !== null ? ` and spent ${hours(p.voiceHours)} hours in calls together` : ""}. Both opted in to be
            named here.
          </Nar>
          <Stats
            items={[
              { label: "replies", value: formatNumber(p.replies) },
              p.voiceHours !== null && { label: "voice hours", value: hours(p.voiceHours) },
            ]}
          />
        </Slide>
      );
    }
    case "club": {
      const c = d.bestClub;
      if (!c) return null;
      return (
        <Slide label="the best club">
          <Big>{c.name}</Big>
          <Nar>
            {c.name} was the loudest club{c.founderName ? `, founded by ${c.founderName}` : ""}.
          </Nar>
          <Stats
            items={[
              { label: "messages", value: formatNumber(c.messages) },
              { label: "members", value: formatNumber(c.members) },
              c.founderName !== null && { label: "founder", value: c.founderName },
            ]}
          />
        </Slide>
      );
    }
    case "president": {
      const p = d.president;
      if (!p) return null;
      return (
        <Slide label="the president">
          <Big>{p.name ?? "someone"}</Big>
          <Nar>
            They held the chair for {plural(p.daysInOffice, "day", "days")}
            {p.terms > 1 ? ` over ${formatNumber(p.terms)} terms` : ""}, the longest this year.
          </Nar>
          <Stats
            items={[
              { label: "elections", value: formatNumber(p.elections) },
              { label: "candidates", value: formatNumber(p.candidates) },
            ]}
          />
          <MirrorPair percent={p.serverActivityPercent} them="their terms" />
          <Nar>{activityLine(p.serverActivityPercent, "they")}</Nar>
        </Slide>
      );
    }
    case "outro":
      return (
        <Slide label={`that was ${d.year}`} fill>
          <StoryCard src={cardUrl} alt={`server wrapped card, ${d.year}`} />
          <Nar>
            Your own envelope is in your DMs, if you opted in. If it is not there, type{" "}
            <span className="c3">/wrapped me</span> on the server.
          </Nar>
        </Slide>
      );
    default:
      return null;
  }
}
