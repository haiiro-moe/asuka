/**
 * The backfill modal of the data tab: reads the server's message history into the activity log. It
 * shows the state, a stepped bar of channels done, messages read, elapsed time and the channel being
 * read, with an `include reactions` chip, `start` (or `resume`, or `run again`), `stop` while running and
 * `close`. While it is open the page polls every 2 seconds; after a run it keeps showing the last result.
 *
 * @module
 */
import { useEffect, useState, type ReactNode } from "react";
import type { BackfillStatus } from "../../../../plugins/activity/backfill/types.ts";
import { Modal } from "../../Modal.tsx";
import { Chip, ErrorLine, InkButton, Loading } from "../../ui/index.ts";
import { formatCount, formatDuration } from "./format.ts";
import { call } from "./http.ts";
import { ProgressBar, Quiet, STATUS_GLYPH, STATUS_INK, Sheet } from "./parts.tsx";
import { backfillStatusLine } from "./status.ts";
import { backfillAction } from "./steps.ts";
import type { OpsStatus } from "./useOpsStatus.ts";

/** What `POST /api/activity/backfill` answers. */
interface StartAnswer {
  status: "started" | "already-running";
  progress: BackfillStatus;
}

/** The figures of a run, live or last. */
function Figures({ b }: { b: BackfillStatus }) {
  const line = backfillStatusLine(b);
  const live = b.status === "running";
  const elapsed = b.startedAt == null && b.status !== "idle" && b.elapsedSec === 0 ? "not known since the bot restarted" : formatDuration(b.elapsedSec);
  return (
    <>
      <p className="px-2">
        <span className={STATUS_INK[line.ink]}>
          <span aria-hidden="true">{STATUS_GLYPH[line.ink]}</span> {line.text}
        </span>
      </p>
      {!live && b.status !== "idle" && <Quiet>The last run, as it ended.</Quiet>}
      <ProgressBar label="channels done" done={b.channelsDone} total={b.channelsTotal} />
      <Sheet
        rows={[
          ["messages", formatCount(b.scanned)],
          ["elapsed", elapsed],
          ["reading", live ? (b.current ?? "between channels") : "nothing right now"],
          ["reactions", b.reactions ? "included" : "left out"],
          ...(b.errors > 0 ? ([["errors", <span className="c2">{formatCount(b.errors)} channels failed</span>]] as [string, ReactNode][]) : []),
        ]}
      />
    </>
  );
}

/**
 * The modal. It reads the status from the page's {@link OpsStatus} (the page polls every 2 seconds
 * while this is open) and puts an action's answer in place at once.
 *
 * @param props - `ops`: the page's polled statuses; `onClose`: closes the modal.
 */
export function BackfillModal({ ops, onClose }: { ops: OpsStatus; onClose: () => void }) {
  const b = ops.backfill;
  const [reactions, setReactions] = useState(b?.reactions ?? false);
  const [busy, setBusy] = useState<"start" | "stop" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const live = b?.status === "running";
  const action = backfillAction(b);

  // the chip follows a live run's setting, so it never claims something the run is not doing
  useEffect(() => {
    if (live && b) setReactions(b.reactions);
  }, [live, b?.reactions]);

  const start = async () => {
    setBusy("start");
    setError(null);
    setNote(null);
    const res = await call<StartAnswer>("POST", "/api/activity/backfill", { reactions });
    setBusy(null);
    if (!res.ok || !res.body) {
      setError(res.error ?? "no answer");
      return;
    }
    ops.setBackfill(res.body.progress);
    if (res.body.status === "already-running") setNote("A run is going already. You are watching it.");
    ops.refresh();
  };

  const stop = async () => {
    setBusy("stop");
    setError(null);
    setNote(null);
    const res = await call<{ status: "stopping" | "not-running" }>("POST", "/api/activity/backfill/stop");
    setBusy(null);
    if (!res.ok) {
      setError(res.error ?? "no answer");
      return;
    }
    setNote(res.body?.status === "stopping" ? "Stopping after the current page of messages." : "Nothing was running.");
    ops.refresh();
  };

  return (
    <Modal
      title="backfill"
      label="sh: ~/activity/backfill"
      tone={b?.status === "failed" ? "love" : "pine"}
      onClose={onClose}
      foot={
        <span>
          <span className="kbd">esc</span> close
        </span>
      }
    >
      <p className="nar px-2">
        You read the server's history into the log, one channel at a time. It is safe to stop and resume.
      </p>
      {b ? <Figures b={b} /> : ops.backfillError ? <ErrorLine className="px-2">The backfill status did not load: {ops.backfillError}.</ErrorLine> : <Loading className="px-2">Reading the backfill status</Loading>}
      <div className="flex flex-wrap items-center gap-2 px-2 pt-2">
        <Chip on={reactions} onToggle={setReactions} disabled={live || busy != null}>
          include reactions
        </Chip>
      </div>
      <Quiet className="pt-1">Reactions add a second pass per channel. It takes longer.</Quiet>
      {note && <p className="nar px-2">{note}</p>}
      {error && <ErrorLine className="px-2">That did not work: {error}.</ErrorLine>}
      <div className="btns">
        {action && (
          <InkButton tone="gold" onClick={start} disabled={!b} busy={busy === "start"} busyLabel="starting">
            {action}
          </InkButton>
        )}
        {live && (
          <InkButton tone="love" onClick={stop} busy={busy === "stop"} busyLabel="stopping">
            stop
          </InkButton>
        )}
        <InkButton tone="muted" onClick={onClose}>
          close
        </InkButton>
      </div>
    </Modal>
  );
}
