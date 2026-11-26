/**
 * The per-member Wrapped actions shared by the failed-DM rows and the member id field: `resend` (DMs one
 * member their link, opted in or not) and `open link` (fetches their link, making the snapshot first if
 * they have none, and opens it in a new tab).
 *
 * @module
 */
import { useState } from "react";
import { call } from "./http.ts";

/** What `POST /api/activity/wrapped/resend/:userId` answers. */
export type ResendResult = "sent" | "failed" | "no-link";

/** The narrator words for a resend's answer. */
export const RESEND_WORDS: Record<ResendResult, string> = {
  sent: "Sent.",
  failed: "Failed again. Their DMs are probably closed.",
  "no-link": "They have no link that year.",
};

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
  /** Resends the member's DM. */
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
 * @param onResent - Called after every resend that got an answer, so the list can be fetched again.
 */
export function useMemberDm(year: number | null, onResent?: () => void): MemberDm {
  const [busy, setBusy] = useState<"resend" | "link" | null>(null);
  const [result, setResult] = useState<ResendResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [link, setLink] = useState<string | null>(null);
  const query = year != null ? `?year=${year}` : "";

  const resend = async (userId: string) => {
    setBusy("resend");
    setResult(null);
    setError(null);
    const res = await call<{ result: ResendResult }>("POST", `/api/activity/wrapped/resend/${userId}${query}`);
    setBusy(null);
    if (res.body?.result) {
      setResult(res.body.result);
      onResent?.();
    } else setError(res.error ?? "no answer");
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
      setError(res.status === 404 ? "they had no activity that year" : (res.error ?? "no answer"));
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
