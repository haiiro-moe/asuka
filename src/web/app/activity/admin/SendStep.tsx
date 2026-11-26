/**
 * Step 2 of a Wrapped run, send dms: DMs the links of opted-in members, one a second, after a confirm.
 * Optionally posts the server Wrapped announcement when the DMs finish (the chip, on by default). Below
 * it, the failed DMs, one row per member with `resend` and `open link`, and a member id field for
 * someone who is not on that list.
 *
 * @module
 */
import { useState } from "react";
import type { WrappedRunStatus, WrappedSendResponse } from "../../../../plugins/activity/types/wrapped.ts";
import { Chip, ErrorLine, Heading, InkButton, Window, useConfirm } from "../../ui/index.ts";
import { failedListKey, showFailedList } from "./failed.ts";
import { formatCount } from "./format.ts";
import { call } from "./http.ts";
import { FailedDmList, MemberDmActions } from "./MemberDmActions.tsx";
import { ProgressBar, Quiet, Sheet } from "./parts.tsx";
import { sendProgress } from "./status.ts";
import { sendConfirm, sendGate } from "./steps.ts";
import type { OpsStatus } from "./useOpsStatus.ts";

/** The words for a 409 answer of the send route. */
const REFUSED: Record<Exclude<WrappedSendResponse["result"], "started">, string> = {
  "already-running": "the DMs are going out already",
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
  const { confirm, dialog } = useConfirm();
  const gate = sendGate(s);
  const sending = s?.status === "sending";

  const send = async () => {
    const ask = sendConfirm(s, announce);
    if (!ask || !(await confirm({ label: "confirm: ~/wrapped/send", ...ask }))) return;
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
      {dialog}
      <p className="nar px-2">
        You DM each opted-in member their link, one a second. Links already sent are never sent twice, and a
        later send retries the failed ones.
      </p>
      {s && s.status !== "idle" && (
        <Quiet>
          DMs go to opted-in members only: {formatCount(s.optedIn)} of {formatCount(s.total)}.
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
      {s && s.year != null && showFailedList(s) && (
        <>
          <Heading as="h3">failed dms</Heading>
          <Quiet>Members whose DM did not arrive and who are still opted in. Closed DMs, most likely.</Quiet>
          <FailedDmList year={s.year} refetchKey={failedListKey(s)} />
          <Heading as="h3">someone not on the list</Heading>
          <MemberDmActions year={s.year} onResent={ops.refresh} />
        </>
      )}
    </Window>
  );
}
