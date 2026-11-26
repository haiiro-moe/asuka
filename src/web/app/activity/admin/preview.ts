/**
 * Pure helpers of the private Wrapped preview section: the member list field, the request body, the
 * status words for the section and the status strip, the start and discard gates, the expiry line and
 * the link URLs. A preview sends nothing to members; every message goes to the admin who started it
 * (rulings R-P1 to R-P7). No DOM, so these are unit-tested with `bun test`.
 *
 * @module
 */
import type {
  PreviewDiscardResponse,
  PreviewMember,
  PreviewStartResponse,
  PreviewStatus,
} from "../../../../plugins/activity/types/wrapped.ts";
import { formatCount } from "./format.ts";
import { formatUtcDate } from "../format.ts";
import type { StatusLine } from "./status.ts";
import type { StepGate } from "./steps.ts";

/** Most members an explicit preview list may name (the server refuses more). */
export const PREVIEW_MAX_MEMBERS = 10;
/** How many of the most active members the default sample adds to the admin. */
export const PREVIEW_DEFAULT_SAMPLE = 3;
/** Days a preview and its links last. */
export const PREVIEW_TTL_DAYS = 14;
/** How long after it finished a preview still shows in the status strip, in seconds. */
export const PREVIEW_STRIP_LINGER_SEC = 10 * 60;

/** The member list field, read. */
export interface MemberList {
  /** Distinct numeric ids in the order typed; empty for the default sample. */
  ids: string[];
  /** Why the field is refused, as a sentence; null when it is fine. */
  error: string | null;
}

/**
 * Reads the member list field: ids separated by spaces, commas or new lines. A pasted Discord mention
 * (`<@id>`, `<@!id>`) is reduced to its id, so the body never carries mention syntax. Duplicates are
 * dropped. Empty means the default sample (you plus the 3 most active members).
 *
 * @param text - What the admin typed.
 * @returns The ids, or an error for an item that is not an id or for more than
 *   {@link PREVIEW_MAX_MEMBERS} distinct ids.
 */
export function parseMemberList(text: string): MemberList {
  const ids: string[] = [];
  for (const raw of text.split(/[\s,]+/).filter((x) => x !== "")) {
    const id = raw.replace(/^<@!?(\d+)>$/, "$1");
    if (!/^\d{1,25}$/.test(id)) return { ids: [], error: `"${raw}" is not a member id. Ids are digits only.` };
    if (!ids.includes(id)) ids.push(id);
  }
  if (ids.length > PREVIEW_MAX_MEMBERS) {
    return { ids: [], error: `At most ${PREVIEW_MAX_MEMBERS} members. You named ${ids.length}.` };
  }
  return { ids, error: null };
}

/** The body of `POST /api/activity/wrapped/preview`. */
export interface PreviewStartBody {
  year?: number;
  members?: string[];
  all?: boolean;
}

/**
 * Builds the start request's body. An empty list leaves `members` out (the server samples); `all` is
 * sent only when on.
 *
 * @param year - The year to preview.
 * @param ids - The parsed member list.
 * @param all - The `whole server (dry run counts)` chip.
 */
export function previewStartBody(year: number, ids: string[], all: boolean): PreviewStartBody {
  return { year, ...(ids.length > 0 ? { members: [...ids] } : {}), ...(all ? { all: true } : {}) };
}

/** True while the preview is working: processing, built and about to DM, or DMing the admin. */
export function previewRunning(p: PreviewStatus | null | undefined): boolean {
  return p?.status === "processing" || p?.status === "processed" || p?.status === "sending";
}

/**
 * The preview's status words, for the section and the strip.
 *
 * - idle: `no preview`
 * - processing: `processing 2 of 4`
 * - processed: `built, the preview dms to you are next`
 * - sending: `sending the preview dms to you`
 * - done: `done, sent to you` or, when the admin's DMs are closed, `done, but your dms are closed`
 * - failed: `failed`
 * - interrupted: `interrupted, start a new preview to replace it`
 *
 * @param p - The admin's preview.
 * @returns The line; its subject says `private preview` so it is never read as the real run.
 */
export function previewStatusLine(p: PreviewStatus): StatusLine {
  const subject = p.year != null ? `private preview ${p.year}` : "private preview";
  switch (p.status) {
    case "idle":
      return { subject, text: "no preview", ink: "subtle" };
    case "processing":
      return { subject, text: `processing ${formatCount(p.done)} of ${formatCount(p.total)}`, ink: "rose" };
    case "processed":
      return { subject, text: "built, the preview dms to you are next", ink: "rose" };
    case "sending":
      return { subject, text: "sending the preview dms to you", ink: "rose" };
    case "done":
      return p.dmFailed
        ? { subject, text: "done, but your dms are closed", ink: "love" }
        : { subject, text: "done, sent to you", ink: "foam" };
    case "failed":
      return { subject, text: "failed", ink: "love" };
    case "interrupted":
      return { subject, text: "interrupted, start a new preview to replace it", ink: "gold" };
  }
}

/**
 * Whether the status strip shows the preview: while it runs, and for
 * {@link PREVIEW_STRIP_LINGER_SEC} after it finished (done or failed). Otherwise the strip shows only
 * the real run and the backfill, so the two are never confused.
 *
 * @param p - The admin's preview, or null while unknown.
 * @param now - Unix seconds.
 */
export function previewInStrip(p: PreviewStatus | null | undefined, now: number): boolean {
  if (!p) return false;
  if (previewRunning(p)) return true;
  if ((p.status === "done" || p.status === "failed") && p.finishedAt != null) return now - p.finishedAt <= PREVIEW_STRIP_LINGER_SEC;
  return false;
}

/** The narrator line for an admin whose DMs are closed: what happened and how to fix it. */
export const DM_FAILED_LINE =
  "Your DMs are closed, so the bot could not send you the preview. Allow direct messages from server members (the server's privacy settings), then start a new preview. The links below work anyway.";

/**
 * Whether `start preview` may be pressed.
 *
 * @param p - The admin's preview, or null while unknown.
 * @param list - The parsed member list.
 * @param year - The parsed year field; null when bad.
 */
export function previewStartGate(p: PreviewStatus | null, list: MemberList, year: number | null): StepGate {
  if (!p) return { enabled: false, reason: "Waiting for your preview's status." };
  if (previewRunning(p)) return { enabled: false, reason: "Your preview is running. Wait for it to finish." };
  if (list.error) return { enabled: false, reason: "Fix the member list first." };
  if (year == null) return { enabled: false, reason: "The year must be a whole year from 2015 to 2100." };
  return { enabled: true, reason: null };
}

/**
 * Whether `discard preview` may be pressed. The server refuses while the preview is processing or
 * sending, so the button waits too.
 *
 * @param p - The admin's preview, or null while unknown.
 */
export function discardGate(p: PreviewStatus | null): StepGate {
  if (!p || p.status === "idle") return { enabled: false, reason: "There is no preview to discard." };
  if (previewRunning(p)) return { enabled: false, reason: "A running preview cannot be discarded. Wait for it to finish." };
  return { enabled: true, reason: null };
}

/**
 * The expiry line.
 *
 * @param p - The admin's preview.
 * @returns `Expires on 1 Feb 2027 (UTC).`, or null when there is no preview (never a blank date).
 */
export function expiryLine(p: PreviewStatus): string | null {
  return p.expiresAt != null ? `Expires on ${formatUtcDate(p.expiresAt)} (UTC).` : null;
}

/**
 * The would-skip line: how many processed members have not opted in. Withheld (null) until a member
 * has been processed, so it never reads as a made-up zero.
 *
 * @param p - The admin's preview.
 */
export function wouldSkipLine(p: PreviewStatus): string | null {
  if (p.status === "idle" || p.done === 0) return null;
  const n = p.wouldSkip;
  const so = p.status === "processing" ? " so far" : "";
  if (n === 0) return `Every processed member has opted in${so}. The real run would DM them all.`;
  return `${formatCount(n)} of the ${formatCount(p.done)} processed members ${n === 1 ? "has" : "have"} not opted in${so}. The real run would not DM ${n === 1 ? "that member" : "those members"}.`;
}

/**
 * The sampled members the real run would not DM, in DM order.
 *
 * @param p - The admin's preview.
 */
export function skippedMembers(p: PreviewStatus): PreviewMember[] {
  return p.sampled.filter((m) => m.wouldSkip);
}

/**
 * A member's preview link. The story pages are served by the dashboard's own server, so the URL is
 * the dashboard origin plus `/wrapped/<token>`.
 *
 * @param origin - `window.location.origin`.
 * @param token - The link token.
 */
export function previewLinkUrl(origin: string, token: string): string {
  return `${origin.replace(/\/+$/, "")}/wrapped/${token}`;
}

/**
 * The preview's private server story link, `/wrapped/s/<token>`.
 *
 * @param origin - `window.location.origin`.
 * @param token - The server token.
 */
export function previewServerUrl(origin: string, token: string): string {
  return `${origin.replace(/\/+$/, "")}/wrapped/s/${token}`;
}

/** The outcome line of a start request. */
export interface StartOutcome {
  /** The sentence. */
  text: string;
  /** True for a refusal or failure (love); false for a start (rose narrator). */
  bad: boolean;
}

/**
 * Words for a start request's answer.
 *
 * @param body - The parsed body, or null when there was none.
 * @param httpError - The request's failure cause (a 400 for a bad body, a network error); null on 2xx.
 */
export function startOutcome(body: PreviewStartResponse | null, httpError: string | null): StartOutcome {
  switch (body?.result) {
    case "started":
      return { text: "Started. The previews come to you by DM when they are built.", bad: false };
    case "already-running":
      return { text: "Your preview is running already.", bad: true };
    case "invalid":
      return { text: `The server refused the list: ${body.error ?? "it is not valid"}.`, bad: true };
    default:
      return { text: `That did not start: ${httpError ?? "no answer"}.`, bad: true };
  }
}

/**
 * The preview's line in the status strip: {@link previewStatusLine} with `(nothing goes to members)`
 * after it, so it is never read as the real run.
 *
 * @param p - The admin's preview.
 */
export function previewStripLine(p: PreviewStatus): StatusLine {
  const line = previewStatusLine(p);
  return { ...line, text: `${line.text} (nothing goes to members)` };
}

/**
 * Words for a discard request's answer.
 *
 * @param result - The body's `result`, or null when there was no usable answer.
 * @param httpError - The request's failure cause; null on 2xx.
 */
export function discardOutcome(result: PreviewDiscardResponse["result"] | null, httpError: string | null): StartOutcome {
  switch (result) {
    case "discarded":
      return { text: "Discarded. The preview links no longer work.", bad: false };
    case "nothing":
      return { text: "There was no preview to discard.", bad: false };
    case "running":
      return { text: "It is still running. Wait for it to finish, then discard it.", bad: true };
    default:
      return { text: `That did not work: ${httpError ?? "no answer"}.`, bad: true };
  }
}

/** The confirm before `discard preview` (love: it deletes the links). */
export const DISCARD_CONFIRM = {
  label: "confirm: ~/wrapped/preview/discard",
  message: "Discard your preview? Its links stop working at once, for you and for anyone you shared them with.",
  confirmLabel: "discard",
  tone: "love",
} as const;
