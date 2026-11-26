/**
 * The Wrapped overview window of the data tab: the run's year and state, the opt-in count, the finished
 * summary (with the not-opted-in count), `resume` for an interrupted run and the server-wide link with
 * `copy link` and `open`. The three steps sit in their own windows below it.
 *
 * @module
 */
import { useState } from "react";
import type { WrappedResumeResponse } from "../../../../plugins/activity/types/wrapped.ts";
import { ErrorLine, Heading, InkButton, InkLink, Loading, Saved, Window } from "../../ui/index.ts";
import { useActivity } from "../useActivity.ts";
import { formatCount, formatUtcDay } from "./format.ts";
import { call } from "./http.ts";
import { Quiet, STATUS_GLYPH, STATUS_INK, Sheet } from "./parts.tsx";
import { wrappedStatusLine } from "./status.ts";
import { resumeGate, serverLinkReady } from "./steps.ts";
import type { OpsStatus } from "./useOpsStatus.ts";

/** The server Wrapped link of a year, fetched only once a run has built it (fetching builds one otherwise). */
function ServerLink({ year }: { year: number }) {
  const state = useActivity<{ url: string }>(`/api/activity/wrapped/server-link?year=${year}`);
  const [copied, setCopied] = useState<"yes" | "no" | null>(null);
  if (state.loading && !state.data) return <Loading className="px-2">Fetching the server link</Loading>;
  if (!state.data) {
    return (
      <ErrorLine className="px-2" onRetry={state.reload}>
        The server link did not load: {state.error ?? "no answer"}.
      </ErrorLine>
    );
  }
  const url = state.data.url;
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied("yes");
    } catch {
      setCopied("no");
    }
  };
  return (
    <>
      <p className="px-2 break-all text-subtle">{url}</p>
      <div className="btns items-center">
        <InkButton tone="pine" onClick={copy}>
          copy link
        </InkButton>
        <InkLink tone="foam" href={url} target="_blank" rel="noopener noreferrer">
          open
        </InkLink>
        {copied === "yes" && <Saved>copied.</Saved>}
        {copied === "no" && (
          <span className="c2" role="status">
            The clipboard said no. Copy it from the line above.
          </span>
        )}
      </div>
    </>
  );
}

/**
 * The overview window.
 *
 * @param props - `ops`: the page's polled statuses.
 */
export function WrappedOverview({ ops }: { ops: OpsStatus }) {
  const s = ops.wrapped;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!s) {
    return (
      <Window label="fish: ~/wrapped">
        {ops.wrappedError ? (
          <ErrorLine className="px-2" onRetry={ops.refresh}>
            The run status did not load: {ops.wrappedError}.
          </ErrorLine>
        ) : (
          <Loading className="px-2">Reading the run status</Loading>
        )}
      </Window>
    );
  }
  const line = wrappedStatusLine(s);
  const resume = resumeGate(s);

  const doResume = async () => {
    setBusy(true);
    setError(null);
    const res = await call<WrappedResumeResponse>("POST", "/api/activity/wrapped/run/resume");
    setBusy(false);
    if (res.body?.status) ops.setWrapped(res.body.status);
    if (res.body?.result === "nothing-to-resume") setError("there was nothing to resume");
    else if (!res.ok) setError(res.error ?? "no answer");
    ops.refresh();
  };

  return (
    <Window label="fish: ~/wrapped" tone={s.status === "interrupted" ? "gold" : s.status === "failed" ? "love" : "pine"}>
      <p className="nar px-2">
        You run the year's Wrapped by hand, in three steps. Nothing here starts on its own.
      </p>
      <Heading>{s.year != null ? `wrapped ${s.year}` : "wrapped"}</Heading>
      <p className="px-2">
        <span className={STATUS_INK[line.ink]}>
          <span aria-hidden="true">{STATUS_GLYPH[line.ink]}</span> {line.text}
        </span>
      </p>
      <Sheet
        rows={[
          ["opted in", `${formatCount(s.optedIn)} members right now`],
          ...(s.startedAt != null ? ([["started", formatUtcDay(s.startedAt)]] as [string, string][]) : []),
          ...(s.finishedAt != null ? ([["finished", formatUtcDay(s.finishedAt)]] as [string, string][]) : []),
          ...(s.status === "done"
            ? ([
                ["sent", formatCount(s.sent)],
                ["failed", formatCount(s.failed)],
                ["not opted in", formatCount(s.skipped)],
                ["announced", s.announcedAt != null ? formatUtcDay(s.announcedAt) : "not yet"],
              ] as [string, string][])
            : []),
        ]}
      />
      {s.status === "interrupted" && (
        <>
          <p className="nar px-2">The run stopped answering, likely a restart. Resume picks it up where it was.</p>
          {error && <ErrorLine className="px-2">That did not resume: {error}.</ErrorLine>}
          <div className="btns">
            <InkButton tone="gold" onClick={doResume} disabled={!resume.enabled} busy={busy} busyLabel="resuming">
              resume
            </InkButton>
          </div>
        </>
      )}
      <Heading as="h3">server wrapped</Heading>
      {serverLinkReady(s) && s.year != null ? (
        <ServerLink year={s.year} />
      ) : (
        <Quiet>The server-wide link appears once a run has been processed.</Quiet>
      )}
    </Window>
  );
}
