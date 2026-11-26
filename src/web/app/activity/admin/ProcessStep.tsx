/**
 * Step 1 of a Wrapped run, process: builds every member's snapshot and link and the server Wrapped. It
 * writes to nobody but the admin who started it, who gets a DM when it finishes. Processing a year whose
 * links already went out asks first: the stories not sent yet are rebuilt, the sent ones stay as they are.
 *
 * @module
 */
import { useState } from "react";
import type { WrappedRunStartResponse, WrappedRunStatus } from "../../../../plugins/activity/types/wrapped.ts";
import { ErrorLine, InkButton, PromptField, Window, useConfirm } from "../../ui/index.ts";
import { formatCount } from "./format.ts";
import { call } from "./http.ts";
import { ProgressBar, Quiet } from "./parts.tsx";
import { MAX_YEAR, MIN_YEAR, parseYearInput, processConfirm, processGate } from "./steps.ts";
import { buildSummary } from "./status.ts";
import type { OpsStatus } from "./useOpsStatus.ts";

/** The narrator line of step 1 for the run's state. */
function processLine(s: WrappedRunStatus): string | null {
  switch (s.status) {
    case "processing":
      return "Processing. When it finishes, a DM goes to whoever started it.";
    case "processed":
    case "sending":
    case "done":
      return `Processed ${formatCount(s.processed)} members for ${s.year}. A DM has gone to whoever started it.`;
    case "interrupted":
      return s.processed < s.total ? "Processing was interrupted. Resume it from the wrapped window above." : null;
    case "failed":
      return s.processed < s.total ? "Processing failed part way. The mod log has the details. Process the year again." : null;
    default:
      return null;
  }
}

/**
 * The step 1 window: the year field, the process button with its gate, and the progress.
 *
 * @param props - `ops`: the page's polled statuses.
 */
export function ProcessStep({ ops }: { ops: OpsStatus }) {
  const s = ops.wrapped;
  const [yearText, setYearText] = useState(String(new Date().getUTCFullYear()));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const year = parseYearInput(yearText);
  const gate = processGate(s, year);
  const line = s ? processLine(s) : null;
  const built = s && s.status !== "idle" ? buildSummary(s) : null;
  const { confirm, dialog } = useConfirm();

  const run = async () => {
    if (year == null) return;
    const ask = processConfirm(s, year);
    if (ask && !(await confirm({ label: "confirm: ~/wrapped/process", ...ask }))) return;
    setBusy(true);
    setError(null);
    const res = await call<WrappedRunStartResponse>("POST", "/api/activity/wrapped/run", { year });
    setBusy(false);
    if (res.body?.status) ops.setWrapped(res.body.status);
    if (res.body?.result === "already-running") setError("a run is processing already");
    else if (res.status === 401) setError("your session ended");
    else if (res.status === 403) setError("you do not have access");
    else if (!res.ok) setError(res.error ?? "no answer");
    ops.refresh();
  };

  return (
    <Window label="sh: ~/wrapped/1-process" tone={s?.status === "failed" && s.processed < s.total ? "love" : "pine"}>
      {dialog}
      <p className="nar px-2">
        You build every member's year and the server's. Nobody is written to but you, and nothing is posted.
      </p>
      <PromptField
        label="year"
        value={yearText}
        onChange={setYearText}
        inputMode="numeric"
        autoComplete="off"
        hint="A UTC calendar year."
        error={year == null ? `A whole year from ${MIN_YEAR} to ${MAX_YEAR}.` : null}
      />
      {s && s.status === "processing" && <ProgressBar label="members processed" done={s.processed} total={s.total} />}
      {line && <p className={s?.status === "failed" ? "nar love px-2" : "nar px-2"}>{line}</p>}
      {built?.line && <p className="nar px-2">{built.line}</p>}
      {built?.note && <Quiet>{built.note}</Quiet>}
      {error && <ErrorLine className="px-2">That did not start: {error}.</ErrorLine>}
      <div className="btns">
        <InkButton tone="gold" onClick={run} disabled={!gate.enabled} busy={busy} busyLabel="starting">
          process
        </InkButton>
      </div>
      {gate.reason && <Quiet>{gate.reason}</Quiet>}
    </Window>
  );
}
