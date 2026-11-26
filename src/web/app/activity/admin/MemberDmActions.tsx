/**
 * Per-member Wrapped actions for the failed DMs: `resend` (DMs one member their link, opted in or not)
 * and `open link` (fetches their link, making the snapshot first if they have none).
 *
 * @module
 */
import { useState } from "react";
import { ErrorLine, InkButton, InkLink, PromptField, Saved } from "../../ui/index.ts";
import { call } from "./http.ts";
import { Quiet } from "./parts.tsx";

/** A Discord user id: digits only. */
const USER_ID = /^\d{1,25}$/;

/** The narrator words for a resend's answer. */
const RESEND_WORDS: Record<"sent" | "failed" | "no-link", string> = {
  sent: "sent.",
  failed: "failed again. Their DMs are probably closed.",
  "no-link": "they have no link that year.",
};

/** Props of {@link MemberDmActions}. */
export interface MemberDmActionsProps {
  /** The run's year, sent as `?year=`; null leaves it to the server (the latest run's). */
  year: number | null;
}

/**
 * A member id field with `resend` and `open link`. The server does not list which members' DMs failed,
 * so the admin names the member (from the mod log or the member's own word).
 *
 * @param props - See {@link MemberDmActionsProps}.
 */
export function MemberDmActions({ year }: MemberDmActionsProps) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState<"resend" | "link" | null>(null);
  const [result, setResult] = useState<"sent" | "failed" | "no-link" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [link, setLink] = useState<string | null>(null);
  const id = text.trim();
  const bad = id !== "" && !USER_ID.test(id);
  const query = year != null ? `?year=${year}` : "";

  const resend = async () => {
    setBusy("resend");
    setResult(null);
    setError(null);
    const res = await call<{ result: "sent" | "failed" | "no-link" }>("POST", `/api/activity/wrapped/resend/${id}${query}`);
    setBusy(null);
    if (res.body?.result) setResult(res.body.result);
    else setError(res.error ?? "no answer");
  };

  const openLink = async () => {
    // open the tab first, inside the click, so a popup blocker lets it through; fill it once the url is in
    const tab = window.open("about:blank", "_blank");
    setBusy("link");
    setError(null);
    setLink(null);
    const res = await call<{ url: string }>("GET", `/api/activity/wrapped/link/${id}${query}`);
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

  return (
    <>
      <PromptField
        label="member id"
        value={text}
        onChange={(v) => {
          setText(v);
          setResult(null);
          setLink(null);
        }}
        inputMode="numeric"
        autoComplete="off"
        error={bad ? "A member id is digits only." : null}
      />
      <div className="btns items-center">
        <InkButton tone="pine" onClick={resend} disabled={!id || bad} busy={busy === "resend"} busyLabel="sending">
          resend
        </InkButton>
        <InkButton tone="flat" onClick={openLink} disabled={!id || bad} busy={busy === "link"} busyLabel="fetching">
          open link
        </InkButton>
        {result === "sent" && <Saved>{RESEND_WORDS.sent}</Saved>}
        {result && result !== "sent" && <span className="c2" role="status">{RESEND_WORDS[result]}</span>}
      </div>
      {link && (
        <Quiet>
          Their link:{" "}
          <InkLink tone="foam" href={link} target="_blank" rel="noopener noreferrer">
            open
          </InkLink>
        </Quiet>
      )}
      {error && <ErrorLine className="px-2">That did not work: {error}.</ErrorLine>}
    </>
  );
}
