/**
 * How a view says it is empty, loading, failed or saved (StateLines), and how a job shows its steps
 * (StageList). One narrator line each, never a spinner graphic or a grey box. Copy: second person,
 * present tense, lowercase short notes, no exclamation marks, no emoji.
 *
 * @module
 */
import type { ReactNode } from "react";
import { InkButton, cx } from "./basics.tsx";
import { useReducedMotion, useStepped } from "./motion.ts";

/** Props shared by the state lines. */
export interface StateLineProps {
  className?: string;
  children?: ReactNode;
}

/** An empty view: one rose narrator line, for example "Nothing here yet. The shelf is bare." */
export function Empty({ className, children }: StateLineProps) {
  return (
    <p className={cx("nar", className)} role="status">
      {children ?? "Nothing here yet."}
    </p>
  );
}

const LOADING_FRAMES = ["▀▄", "▄▀"];

/**
 * A loading line: narration with a bracket marker that steps between two frames (`[ ▀▄ ]`), held still
 * under reduced motion. Announced politely to screen readers.
 */
export function Loading({ className, children }: StateLineProps) {
  const f = useStepped(LOADING_FRAMES.length, 400);
  return (
    <p className={cx("nar", className)} role="status" aria-live="polite">
      {children ?? "Fetching"} <span className="c1" aria-hidden="true">[ {LOADING_FRAMES[f]} ]</span>
    </p>
  );
}

/** Props of {@link ErrorLine}. */
export interface ErrorLineProps extends StateLineProps {
  /** Shows a gold `retry` button. */
  onRetry?: () => void;
  /** Shows a muted `dismiss` button. */
  onDismiss?: () => void;
  retryLabel?: string;
}

/**
 * A failure: a love narrator line that states the cause in plain words, optionally followed by retry
 * (gold) and dismiss (muted) buttons.
 */
export function ErrorLine({ className, children, onRetry, onDismiss, retryLabel = "retry" }: ErrorLineProps) {
  return (
    <>
      <p className={cx("nar love", className)} role="alert">
        {children ?? "Something went wrong."}
      </p>
      {(onRetry || onDismiss) && (
        <div className="btns">
          {onRetry && (
            <InkButton tone="gold" onClick={onRetry}>
              {retryLabel}
            </InkButton>
          )}
          {onDismiss && (
            <InkButton tone="muted" onClick={onDismiss}>
              dismiss
            </InkButton>
          )}
        </div>
      )}
    </>
  );
}

/** An inline confirmation next to a button, in foam: `saved.` */
export function Saved({ className, children }: StateLineProps) {
  return (
    <span className={cx("c6", className)} role="status">
      {children ?? "saved."}
    </span>
  );
}

/* ------------------------------------------------------------------------------------------------ */

/** The state of one stage. */
export type StageState = "done" | "failed" | "running" | "waiting";

/** One row of a {@link StageList}. */
export interface Stage {
  label: ReactNode;
  state: StageState;
  /** For a failed stage: the cause, shown as a love line under it. */
  error?: ReactNode;
}

/** Props of {@link StageList}. */
export interface StageListProps {
  stages: Stage[];
  /** Shown under a failed stage as a gold retry button. */
  onRetry?: () => void;
  /** Shown under a failed stage as a muted dismiss button. */
  onDismiss?: () => void;
  className?: string;
}

const SPINNER = ["|", "/", "-", "\\"];

/**
 * Steps of a job that runs in order: `✓` done (foam), `×` failed (love), a stepped `| / - \` spinner
 * while running (rose, a fixed `>` under reduced motion), `·` waiting (muted). The glyph is the state;
 * colour only backs it up.
 */
export function StageList({ stages, onRetry, onDismiss, className }: StageListProps) {
  const running = stages.some((s) => s.state === "running");
  const reduced = useReducedMotion();
  const f = useStepped(SPINNER.length, 150, running);
  return (
    <div className={className}>
      {stages.map((s, i) => {
        const glyph =
          s.state === "done" ? "✓" : s.state === "failed" ? "×" : s.state === "running" ? (reduced ? ">" : SPINNER[f]) : "·";
        const ink = s.state === "done" ? "c6" : s.state === "failed" ? "c2" : s.state === "running" ? "c4" : "c1";
        return (
          <div key={i}>
            <div className="stg">
              <span className={cx("g", ink)} aria-hidden="true">
                {glyph}
              </span>
              <span className={s.state === "failed" ? "c2" : s.state === "waiting" ? "text-subtle" : undefined}>
                {s.label}
                <span className="sr-only"> ({s.state})</span>
              </span>
            </div>
            {s.state === "failed" && (s.error != null || onRetry || onDismiss) && (
              <ErrorLine className="px-2" onRetry={onRetry} onDismiss={onDismiss}>
                {s.error}
              </ErrorLine>
            )}
          </div>
        );
      })}
    </div>
  );
}
