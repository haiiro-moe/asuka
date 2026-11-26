/**
 * Step 3 of a Wrapped run, post announcement: posts the server Wrapped link to the announcement channel,
 * at most once a year. A failed post (a 502) says so and can be tried again.
 *
 * @module
 */
import { useState } from "react";
import type { WrappedAnnounceResponse } from "../../../../plugins/activity/types/wrapped.ts";
import { ErrorLine, InkButton, Window } from "../../ui/index.ts";
import { formatUtcDay } from "./format.ts";
import { call } from "./http.ts";
import { Quiet } from "./parts.tsx";
import { announceGate } from "./steps.ts";
import type { OpsStatus } from "./useOpsStatus.ts";

/** The words for each answer that is not `posted`. */
const NOT_POSTED: Record<Exclude<WrappedAnnounceResponse["result"], "posted">, string> = {
  "already-announced": "It was posted already. The announcement goes out once a year.",
  "not-processed": "The run is not processed yet, so there is nothing to announce.",
  "no-channel": "No announcement channel is set. Pick one in config, then try again.",
  failed: "The post failed: the channel could not be reached or Discord refused it. Try again.",
};

/**
 * The step 3 window.
 *
 * @param props - `ops`: the page's polled statuses.
 */
export function AnnounceStep({ ops }: { ops: OpsStatus }) {
  const s = ops.wrapped;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const gate = announceGate(s);

  const post = async () => {
    setBusy(true);
    setError(null);
    const res = await call<WrappedAnnounceResponse>("POST", "/api/activity/wrapped/announce");
    setBusy(false);
    const result = res.body?.result;
    if (result && result !== "posted") setError(NOT_POSTED[result]);
    else if (!res.ok) setError(res.status === 502 ? NOT_POSTED.failed : `That did not work: ${res.error ?? "no answer"}.`);
    ops.refresh();
  };

  return (
    <Window label="sh: ~/wrapped/3-announce" tone={error ? "love" : "pine"}>
      <p className="nar px-2">You post the server's Wrapped to the announcement channel. Once a year, and only when you say.</p>
      {s?.announcedAt != null ? (
        <p className="px-2 c6">
          <span aria-hidden="true">✓</span> Posted on {formatUtcDay(s.announcedAt)}.
        </p>
      ) : (
        <p className="px-2 text-subtle">
          <span aria-hidden="true">·</span> Not posted yet{s?.year != null ? ` for ${s.year}` : ""}.
        </p>
      )}
      {error && <ErrorLine className="px-2">{error}</ErrorLine>}
      <div className="btns">
        <InkButton tone="gold" onClick={post} disabled={!gate.enabled} busy={busy} busyLabel="posting">
          post announcement
        </InkButton>
      </div>
      {gate.reason && s?.announcedAt == null && <Quiet>{gate.reason}</Quiet>}
    </Window>
  );
}
