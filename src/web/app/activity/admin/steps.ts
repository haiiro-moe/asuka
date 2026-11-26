/**
 * Pure rules of the data tab: when each manual Wrapped step may be pressed (and the reason when not),
 * the confirm before each outward step, the backfill button's word, and the year field. Nothing here
 * starts anything; the page only enables buttons and asks.
 * No DOM, so these are unit-tested with `bun test`.
 *
 * @module
 */
import type { BackfillStatus } from "../../../../plugins/activity/backfill/types.ts";
import type { WrappedRunStatus } from "../../../../plugins/activity/types/wrapped.ts";
import { formatUtcDay } from "./format.ts";

/** Whether a step's button is enabled, and when it is not, the reason shown in a quiet line under it. */
export interface StepGate {
  enabled: boolean;
  /**
   * The reason, as rendered: a narrator sentence in sentence case with a full stop, in the page's voice
   * (`Resume the interrupted run first.`). Null when enabled.
   */
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
 * Step 1, process. Refused while a run is processing or sending, while the latest run is interrupted
 * (processing again would abandon it, so the line points at resume), and while the year field is bad.
 *
 * @param s - The run status, or null while it is unknown.
 * @param year - The parsed year field.
 */
export function processGate(s: WrappedRunStatus | null, year: number | null): StepGate {
  if (!s) return shut("Waiting for the run status.");
  if (s.status === "processing") return shut("A run is processing already.");
  if (s.status === "sending") return shut("The DMs are going out. Wait for them to finish.");
  if (s.status === "interrupted") return shut("Resume the interrupted run first. Processing again would abandon it.");
  if (year == null) return shut(`The year must be a whole year from ${MIN_YEAR} to ${MAX_YEAR}.`);
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
  if (!s) return shut("Waiting for the run status.");
  switch (s.status) {
    case "idle":
      return shut("Process a year first.");
    case "processing":
      return shut("Wait for processing to finish.");
    case "sending":
      return shut("The DMs are going out.");
    case "interrupted":
      return shut("Resume the interrupted run first.");
    case "failed":
      return processingComplete(s) ? open : shut("Processing failed part way. Process the year again.");
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
  if (!s) return shut("Waiting for the run status.");
  if (s.announcedAt != null) return shut(`Posted on ${formatUtcDay(s.announcedAt)}.`);
  switch (s.status) {
    case "processed":
    case "done":
      return open;
    case "sending":
      return shut("Wait for the DMs to finish.");
    case "interrupted":
      return shut("Resume the interrupted run first.");
    case "processing":
      return shut("Wait for processing to finish.");
    case "failed":
      return processingComplete(s)
        ? shut("The run failed. Send again, or process the year again.")
        : shut("Processing failed part way. Process the year again.");
    case "idle":
      return shut("Process a year first.");
  }
}

/** What a confirm dialog before an outward step says: the same fields as `useConfirm`'s options. */
export interface StepConfirm {
  /** The narrator sentence: what happens if you go on. */
  message: string;
  /** The action word, lowercase. */
  confirmLabel: string;
  /** Gold: these start something; nothing is deleted. */
  tone: "gold";
}

/**
 * The confirm before `send dms`: it writes to every opted-in member whose link is not sent yet, and a
 * sent DM cannot be taken back. Null when the gate is shut (the button is disabled, so there is nothing
 * to confirm).
 *
 * @param s - The run status.
 * @param announce - The `announce when the dms finish` chip.
 */
export function sendConfirm(s: WrappedRunStatus | null, announce: boolean): StepConfirm | null {
  if (!s || !sendGate(s).enabled) return null;
  const who = `${s.optedIn.toLocaleString("en-GB")} ${s.optedIn === 1 ? "member who" : "members who"} opted in`;
  const tail = announce
    ? " When they finish, the announcement is posted in the announcements channel."
    : " No announcement is posted.";
  return {
    message: `Send the DMs now to the ${who}? Links already sent are not sent again, and a DM cannot be taken back.${tail}`,
    confirmLabel: "send dms",
    tone: "gold",
  };
}

/**
 * The confirm before `post announcement`: a public post, once a year. Null when the gate is shut.
 *
 * @param s - The run status.
 */
export function announceConfirm(s: WrappedRunStatus | null): StepConfirm | null {
  if (!s || !announceGate(s).enabled) return null;
  const year = s.year != null ? ` of ${s.year}` : "";
  return {
    message: `Post the server Wrapped${year} in the announcements channel now? Everyone sees it, and it goes out once a year.`,
    confirmLabel: "post",
    tone: "gold",
  };
}

/**
 * Resume. Only an interrupted run can be resumed.
 *
 * @param s - The run status, or null while it is unknown.
 */
export function resumeGate(s: WrappedRunStatus | null): StepGate {
  return s?.status === "interrupted" ? open : shut("Only an interrupted run can be resumed.");
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
