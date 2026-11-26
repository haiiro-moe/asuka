/**
 * Step 2 of a Wrapped run, send dms: DMs the links of opted-in members, one a second. Optionally
 * posts the server Wrapped announcement when the DMs finish (the chip, on by default). Also lists the
 * failed DMs with a per-member resend and open link.
 *
 * @module
 */
import { useState } from "react";
import type { WrappedRunStatus, WrappedSendResponse } from "../../../../plugins/activity/types/wrapped.ts";
import { Chip, ErrorLine, Heading, InkButton, Window } from "../../ui/index.ts";
import { formatCount } from "./format.ts";
import { call } from "./http.ts";
import { MemberDmActions } from "./MemberDmActions.tsx";
import { ProgressBar, Quiet, Sheet } from "./parts.tsx";
import { sendProgress } from "./status.ts";
import { sendGate } from "./steps.ts";
import type { OpsStatus } from "./useOpsStatus.ts";

/** The words for a 409 answer of the send route. */
const REFUSED: Record<Exclude<WrappedSendResponse["result"], "started">, string> = {
  "already-running": "the dms are going out already",
  "not-processed": "the run is not processed yet",
};

/** The sent, failed and not-opted-in counts, once a send has run. */
function Counts({ s }: { s: WrappedRunStatus }) {
  return (
    <Sheet
      rows={[
        ["sent", <span className="c6">{formatCount(s.sent)}</span>],
        ["failed", <span className={s.failed > 0 ? "c2" : undefined}>{formatCount(s.failed)}</span>],
        ["not opted in", formatCount(s.skipped)],
      ]}
    />
  );
}

/**
 * The step 2 window.
 *
 * @param props - `ops`: the page's polled statuses.
 */
export function SendStep({ ops }: { ops: OpsStatus }) {
  const s = ops.wrapped;
  const [announce, setAnnounce] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const gate = sendGate(s);
  const sending = s?.status === "sending";

  const send = async () => {
    setBusy(true);
    setError(null);
    const res = await call<WrappedSendResponse>("POST", "/api/activity/wrapped/send", { announce });
    setBusy(false);
    if (res.body?.status) ops.setWrapped(res.body.status);
    if (res.body && res.body.result !== "started") setError(REFUSED[res.body.result]);
    else if (!res.ok) setError(res.error ?? "no answer");
    ops.refresh();
  };

  return (
    <Window label="sh: ~/wrapped/2-send-dms" tone={s && s.failed > 0 && s.status === "done" ? "gold" : "pine"}>
      <p className="nar px-2">
        You DM each opted-in member their link, one a second. Links already sent are never sent twice, and a
        later send retries the failed ones.
      </p>
      {s && s.status !== "idle" && (
        <Quiet>
          Dms go to opted-in members only: {formatCount(s.optedIn)} of {formatCount(s.total)}.
        </Quiet>
      )}
      <div className="flex flex-wrap gap-2 px-2 py-1">
        <Chip on={announce} onToggle={setAnnounce} disabled={sending || busy}>
          announce when the dms finish
        </Chip>
      </div>
      {sending && s && s.announce && <Quiet>This send posts the announcement when it ends.</Quiet>}
      {s && (sending || s.status === "done" || (s.status === "interrupted" && s.processed >= s.total)) && (
        <ProgressBar label="links settled" done={sendProgress(s)[0]} total={sendProgress(s)[1]} />
      )}
      {s && (s.status === "done" || sending) && <Counts s={s} />}
      {error && <ErrorLine className="px-2">That did not start: {error}.</ErrorLine>}
      <div className="btns">
        <InkButton tone="gold" onClick={send} disabled={!gate.enabled} busy={busy} busyLabel="starting">
          send dms
        </InkButton>
      </div>
      {gate.reason && <Quiet>{gate.reason}</Quiet>}
      {s && s.failed > 0 && (
        <>
          <Heading as="h3">failed dms</Heading>
          <p className="nar love px-2">
            {formatCount(s.failed)} {s.failed === 1 ? "DM" : "DMs"} did not arrive. Closed DMs, most likely.
          </p>
          <Quiet>The server does not list who yet. Name a member to resend or to open their link.</Quiet>
          <MemberDmActions year={s.year} />
        </>
      )}
    </Window>
  );
}
