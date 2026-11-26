/**
 * The status strip under the diagnostics heading: one line for the Wrapped run and one for the history
 * backfill, on every tab, so an admin always sees what is running.
 *
 * @module
 */
import { Window } from "../../ui/index.ts";
import { STATUS_GLYPH, STATUS_INK } from "./parts.tsx";
import { backfillStatusLine, wrappedStatusLine, type StatusLine } from "./status.ts";
import type { OpsStatus } from "./useOpsStatus.ts";

/** One line: the subject, a glyph and the state in its ink, or the failure to read it. */
function Line({ line, error, subject }: { line: StatusLine | null; error: string | null; subject: string }) {
  if (!line) {
    return (
      <p className="px-2">
        <span className="c6">{subject}</span> <span className={error ? "c2" : "text-subtle"}>{error ? `× could not read it: ${error}` : "· checking"}</span>
      </p>
    );
  }
  return (
    <p className="px-2">
      <span className="c6">{line.subject}</span>{" "}
      <span className={STATUS_INK[line.ink]}>
        <span aria-hidden="true">{STATUS_GLYPH[line.ink]}</span> {line.text}
      </span>
      {error && <span className="c2"> (last check failed: {error})</span>}
    </p>
  );
}

/**
 * The strip. It reads the statuses from the page's {@link OpsStatus}, which polls every 2 seconds while
 * either job runs and every 30 seconds otherwise; the foot says which.
 *
 * @param props - `ops`: the page's polled statuses.
 */
export function StatusStrip({ ops }: { ops: OpsStatus }) {
  const every = ops.intervalMs >= 1000 ? `${Math.round(ops.intervalMs / 1000)}s` : `${ops.intervalMs}ms`;
  return (
    <Window label="ps: ~/jobs" foot={<span className="r">checks every {every}</span>}>
      {/* not a live region: the counters change every 2 seconds and would talk over everything */}
      <Line subject="wrapped" line={ops.wrapped ? wrappedStatusLine(ops.wrapped) : null} error={ops.wrappedError} />
      <Line subject="backfill" line={ops.backfill ? backfillStatusLine(ops.backfill) : null} error={ops.backfillError} />
    </Window>
  );
}
