/**
 * Pure rules of the data tab: when each manual Wrapped step may be pressed (and the reason when not),
 * the backfill button's word, and the year field. Nothing here starts anything; the page only enables
 * buttons. No DOM, so these are unit-tested with `bun test`.
 *
 * @module
 */
import type { BackfillStatus } from "../../../../plugins/activity/backfill/types.ts";
import type { WrappedRunStatus } from "../../../../plugins/activity/types/wrapped.ts";
import { formatUtcDay } from "./format.ts";

/** Whether a step's button is enabled, and when it is not, the reason shown in a quiet line under it. */
export interface StepGate {
  enabled: boolean;
  /** Lowercase sentence with a full stop; null when enabled. */
  reason: string | null;
}

const open: StepGate = { enabled: true, reason: null };
const shut = (reason: string): StepGate => ({ enabled: false, reason });

/** Lowest and highest year the server accepts for a run (`api/wrapped.ts`). */
export const MIN_YEAR = 2015;
export const MAX_YEAR = 2100;

/**
 * Reads the year field.
 *
 * @param text - What the admin typed.
 * @returns The year, or null when it is not a whole number from {@link MIN_YEAR} to {@link MAX_YEAR}.
 */
export function parseYearInput(text: string): number | null {
  const t = text.trim();
  if (!/^\d{4}$/.test(t)) return null;
  const y = Number(t);
  return y >= MIN_YEAR && y <= MAX_YEAR ? y : null;
}

/**
 * Step 1, process. Refused while a run is processing or sending, and while the year field is bad. An
 * interrupted run can be processed again, but the line points at resume first.
 *
 * @param s - The run status, or null while it is unknown.
 * @param year - The parsed year field.
 */
export function processGate(s: WrappedRunStatus | null, year: number | null): StepGate {
  if (!s) return shut("waiting for the run status.");
  if (s.status === "processing") return shut("a run is processing already.");
  if (s.status === "sending") return shut("the dms are going out; wait for them to finish.");
  if (year == null) return shut(`the year must be a whole year from ${MIN_YEAR} to ${MAX_YEAR}.`);
  return open;
}

/** True when the latest run finished processing every member, so the send step may run. */
function processingComplete(s: WrappedRunStatus): boolean {
  return s.total > 0 ? s.processed >= s.total : s.status === "processed" || s.status === "done";
}

/**
 * Step 2, send dms. Allowed once the run is `processed` or `done` (a later send reaches members who
 * opted in since and retries failed links), or `failed` after its processing had completed, as the
 * server allows.
 *
 * @param s - The run status, or null while it is unknown.
 */
export function sendGate(s: WrappedRunStatus | null): StepGate {
  if (!s) return shut("waiting for the run status.");
  switch (s.status) {
    case "idle":
      return shut("process a year first.");
    case "processing":
      return shut("wait for processing to finish.");
    case "sending":
      return shut("the dms are going out.");
    case "interrupted":
      return shut("resume the interrupted run first.");
    case "failed":
      return processingComplete(s) ? open : shut("processing failed part way; process the year again.");
    case "processed":
    case "done":
      return open;
  }
}

/**
 * Step 3, post announcement. Allowed once the run is `processed` or `done` and the year has not been
 * announced (it is posted at most once a year).
 *
 * @param s - The run status, or null while it is unknown.
 */
export function announceGate(s: WrappedRunStatus | null): StepGate {
  if (!s) return shut("waiting for the run status.");
  if (s.announcedAt != null) return shut(`posted on ${formatUtcDay(s.announcedAt)}.`);
  switch (s.status) {
    case "processed":
    case "done":
      return open;
    case "sending":
      return shut("wait for the dms to finish.");
    case "interrupted":
      return shut("resume the interrupted run first.");
    case "processing":
      return shut("wait for processing to finish.");
    default:
      return shut("process a year first.");
  }
}

/**
 * Resume. Only an interrupted run can be resumed.
 *
 * @param s - The run status, or null while it is unknown.
 */
export function resumeGate(s: WrappedRunStatus | null): StepGate {
  return s?.status === "interrupted" ? open : shut("only an interrupted run can be resumed.");
}

/** True when the run has built the server Wrapped, so its link can be fetched without building one. */
export function serverLinkReady(s: WrappedRunStatus | null): boolean {
  return s?.status === "processed" || s?.status === "sending" || s?.status === "done" || s?.announcedAt != null;
}

/** The word on the backfill modal's main button. */
export type BackfillAction = "start" | "resume" | "run again";

/**
 * The backfill modal's main button: `start` before any run, `resume` for a stopped one, `run again`
 * after a finished or failed one. Null while a run is live (only `stop` is offered then).
 *
 * @param b - The backfill status, or null while it is unknown.
 */
export function backfillAction(b: BackfillStatus | null): BackfillAction | null {
  if (!b) return "start";
  switch (b.status) {
    case "idle":
      return "start";
    case "stopped":
      return "resume";
    case "running":
      return null;
    case "done":
    case "failed":
      return "run again";
  }
}
