/**
 * The per-member Wrapped actions of the send window: `resend` (DMs one failed member their link again;
 * the server refuses a member who is not opted in, a link already sent, and any resend while a send is
 * running) and `open link` (fetches their link, making the snapshot first if they have none, and opens
 * it in a new tab).
 *
 * @module
 */
import { useRef, useState } from "react";
import { resendOutcome, type ResendResult } from "./failed.ts";
import { call } from "./http.ts";

export { RESEND_WORDS, type ResendResult } from "./failed.ts";

/** What {@link useMemberDm} returns. */
export interface MemberDm {
  /** Which action is in flight; null for none. */
  busy: "resend" | "link" | null;
  /** The last resend's answer; null before one, or after {@link MemberDm.reset}. */
  result: ResendResult | null;
  /** Why the last action failed; null when it worked. */
  error: string | null;
  /** The last fetched link, kept on the page in case the new tab was blocked. */
  link: string | null;
  /** Resends the member's DM. A second call while one is in flight does nothing. */
  resend: (userId: string) => Promise<void>;
  /** Fetches the member's link and opens it in a new tab. */
  openLink: (userId: string) => Promise<void>;
  /** Clears the result, error and link (when the id changes). */
  reset: () => void;
}

/**
 * The actions for one member at a time.
 *
 * @param year - The run's year, sent as `?year=`; null leaves it to the server (the latest run's).
 * @param onResent - Called with the answer after every resend that got one, so the list can be fetched again.
 */
export function useMemberDm(year: number | null, onResent?: (result: ResendResult) => void): MemberDm {
  const [busy, setBusy] = useState<"resend" | "link" | null>(null);
  const [result, setResult] = useState<ResendResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [link, setLink] = useState<string | null>(null);
  // a ref, not state: two clicks in one frame both see the state from before the first
  const resending = useRef(false);
  const query = year != null ? `?year=${year}` : "";

  const resend = async (userId: string) => {
    if (resending.current) return;
    resending.current = true;
    setBusy("resend");
    setResult(null);
    setError(null);
    try {
      const res = await call<{ result: ResendResult }>("POST", `/api/activity/wrapped/resend/${userId}${query}`);
      const out = resendOutcome(res.status, res.body, res.error);
      if (out.result) {
        setResult(out.result);
        onResent?.(out.result);
      } else setError(out.error);
    } finally {
      resending.current = false;
      setBusy(null);
    }
  };

  const openLink = async (userId: string) => {
    // open the tab first, inside the click, so a popup blocker lets it through; fill it once the url is in
    const tab = window.open("about:blank", "_blank");
    setBusy("link");
    setError(null);
    setLink(null);
    const res = await call<{ url: string }>("GET", `/api/activity/wrapped/link/${userId}${query}`);
    setBusy(null);
    if (!res.ok || !res.body?.url) {
      tab?.close();
      setError(
        res.status === 404
          ? "they had no activity that year"
          : res.status === 401
            ? "your session ended"
            : res.status === 403
              ? "you do not have access"
              : (res.error ?? "no answer"),
      );
      return;
    }
    setLink(res.body.url);
    if (tab) {
      tab.opener = null;
      tab.location.href = res.body.url;
    }
  };

  const reset = () => {
    setResult(null);
    setError(null);
    setLink(null);
  };

  return { busy, result, error, link, resend, openLink, reset };
}
