/**
 * The polling hook behind the status strip and the data tab: the Wrapped run and the history backfill,
 * fetched together every 2 seconds while either is running (or while `fast` is asked for) and every 30
 * seconds otherwise.
 *
 * @module
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { BackfillStatus } from "../../../../plugins/activity/backfill/types.ts";
import type { WrappedRunStatus } from "../../../../plugins/activity/types/wrapped.ts";
import { call } from "./http.ts";
import { pollInterval } from "./status.ts";

/** What {@link useOpsStatus} returns. */
export interface OpsStatus {
  /** The latest Wrapped run, or null until the first answer. */
  wrapped: WrappedRunStatus | null;
  /** The backfill, or null until the first answer. */
  backfill: BackfillStatus | null;
  /** Why the last Wrapped poll failed; null when it worked. */
  wrappedError: string | null;
  /** Why the last backfill poll failed; null when it worked. */
  backfillError: string | null;
  /** The interval the next poll waits, in milliseconds. */
  intervalMs: number;
  /** Polls now (after starting or stopping something) and restarts the timer. */
  refresh: () => void;
  /** Puts a status that an action's answer carried in place, without waiting for the next poll. */
  setWrapped: (s: WrappedRunStatus) => void;
  /** The same for the backfill. */
  setBackfill: (b: BackfillStatus) => void;
}

/**
 * Polls `GET /api/activity/wrapped/run` and `GET /api/activity/backfill`. A failed poll keeps the last
 * good status and records the cause, and the loop keeps going.
 *
 * @param fast - Poll every 2 seconds whatever the state (the backfill modal sets it while open).
 * @returns The statuses, their errors and a `refresh`.
 */
export function useOpsStatus(fast = false): OpsStatus {
  const [wrapped, setWrapped] = useState<WrappedRunStatus | null>(null);
  const [backfill, setBackfill] = useState<BackfillStatus | null>(null);
  const [wrappedError, setWrappedError] = useState<string | null>(null);
  const [backfillError, setBackfillError] = useState<string | null>(null);
  const [intervalMs, setIntervalMs] = useState(() => pollInterval(null, null, fast));
  const [tick, setTick] = useState(0);
  const last = useRef<{ w: WrappedRunStatus | null; b: BackfillStatus | null }>({ w: null, b: null });

  useEffect(() => {
    let live = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const poll = async () => {
      const [w, b] = await Promise.all([
        call<WrappedRunStatus>("GET", "/api/activity/wrapped/run"),
        call<BackfillStatus>("GET", "/api/activity/backfill"),
      ]);
      if (!live) return;
      if (w.ok && w.body) {
        last.current.w = w.body;
        setWrapped(w.body);
        setWrappedError(null);
      } else setWrappedError(w.error ?? "no answer");
      if (b.ok && b.body) {
        last.current.b = b.body;
        setBackfill(b.body);
        setBackfillError(null);
      } else setBackfillError(b.error ?? "no answer");
      const next = pollInterval(last.current.w, last.current.b, fast);
      setIntervalMs(next);
      timer = setTimeout(poll, next);
    };
    void poll();
    return () => {
      live = false;
      if (timer) clearTimeout(timer);
    };
  }, [fast, tick]);

  const refresh = useCallback(() => setTick((n) => n + 1), []);
  const putWrapped = useCallback((s: WrappedRunStatus) => {
    last.current.w = s;
    setWrapped(s);
  }, []);
  const putBackfill = useCallback((b: BackfillStatus) => {
    last.current.b = b;
    setBackfill(b);
  }, []);
  return {
    wrapped,
    backfill,
    wrappedError,
    backfillError,
    intervalMs,
    refresh,
    setWrapped: putWrapped,
    setBackfill: putBackfill,
  };
}
