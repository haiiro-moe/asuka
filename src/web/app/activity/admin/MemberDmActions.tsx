/**
 * Per-member Wrapped DM controls of the send window: the outcome line shared by both, the failed-DM
 * list (one row per member with `resend` and `open link`; `resend` is hidden while a send runs) and a
 * member id field with `open link` only, for someone who is not on the list. A member who lost their
 * link uses `/wrapped me`; the admin can still open it for them.
 *
 * @module
 */
import { useEffect, useRef, useState } from "react";
import type { WrappedFailedList, WrappedRunStatus } from "../../../../plugins/activity/types/wrapped.ts";
import { UserName } from "../../names.tsx";
import { InkButton, InkLink, PromptField, Saved } from "../../ui/index.ts";
import { useActivity } from "../useActivity.ts";
import { failedListView, showResend } from "./failed.ts";
import { DataTable, Quiet, ViewState } from "./parts.tsx";
import { RESEND_WORDS, useMemberDm, type MemberDm } from "./useMemberDm.ts";

/** A Discord user id: digits only. */
const USER_ID = /^\d{1,25}$/;

/** The answer of the last action: sent (foam), refused or failed again (love), the link, or the failure. */
function Outcome({ dm }: { dm: MemberDm }) {
  return (
    <>
      {dm.result === "sent" && <Saved>{RESEND_WORDS.sent}</Saved>}
      {dm.result && dm.result !== "sent" && (
        <span className="c2" role="status">
          {RESEND_WORDS[dm.result]}
        </span>
      )}
      {dm.link && (
        <InkLink tone="foam" href={dm.link} target="_blank" rel="noopener noreferrer">
          their link
        </InkLink>
      )}
      {dm.error && (
        <span className="c2" role="alert">
          That did not work: {dm.error}.
        </span>
      )}
    </>
  );
}

/** Props of the failed-list row. */
interface FailedRowProps {
  userId: string;
  year: number | null;
  /** The run status, to hide `resend` while a send runs. */
  status: WrappedRunStatus | null;
  /** The list answer the row was drawn from; a new one unlocks `resend` again. */
  list: WrappedFailedList;
  onResent: () => void;
}

/** One failed member: name, `resend`, `open link` and the outcome. */
function FailedRow({ userId, year, status, list, onResent }: FailedRowProps) {
  const [sentFor, setSentFor] = useState<WrappedFailedList | null>(null);
  const dm = useMemberDm(year, (result) => {
    // lock against the list this click saw; the refetch below brings a new one and unlocks it
    if (result === "sent") setSentFor(list);
    onResent();
  });
  const gate = showResend(status, sentFor === list);
  return (
    <tr>
      <td>
        <UserName id={userId} />
      </td>
      <td>
        <span className="flex flex-wrap items-center gap-2">
          {gate.show && (
            <InkButton
              tone="pine"
              onClick={() => dm.resend(userId)}
              disabled={gate.disabled}
              busy={dm.busy === "resend"}
              busyLabel="sending"
            >
              resend
            </InkButton>
          )}
          <InkButton tone="flat" onClick={() => dm.openLink(userId)} busy={dm.busy === "link"} busyLabel="fetching">
            open link
          </InkButton>
          <Outcome dm={dm} />
        </span>
      </td>
    </tr>
  );
}

/** Props of {@link FailedDmList}. */
export interface FailedDmListProps {
  /** The run's year, sent as `?year=`. */
  year: number;
  /** Changes whenever the list should be fetched again ({@link failedListKey}). */
  refetchKey: string;
  /** The run status; `resend` is hidden while it is `sending`. */
  status: WrappedRunStatus | null;
}

/**
 * The failed DMs of a year (members still opted in, by user id, at most 200) from
 * `GET /api/activity/wrapped/failed?year=`. Fetched again when `refetchKey` changes and after each
 * resend.
 *
 * @param props - See {@link FailedDmListProps}.
 */
export function FailedDmList({ year, refetchKey, status }: FailedDmListProps) {
  const state = useActivity<WrappedFailedList>(`/api/activity/wrapped/failed?year=${year}`);
  const { reload } = state;
  const seen = useRef(refetchKey);
  useEffect(() => {
    // the hook fetches on mount; only a later key change needs a reload
    if (seen.current === refetchKey) return;
    seen.current = refetchKey;
    reload();
  }, [refetchKey, reload]);
  return (
    <ViewState state={state} what="the failed DMs" isEmpty={() => false} empty={null}>
      {(list) => {
        const view = failedListView(list);
        if (view.empty) return <p className="nar px-2">{view.empty}</p>;
        return (
          <>
            <DataTable
              head={
                <>
                  <th>member</th>
                  <th>dm</th>
                </>
              }
            >
              {view.rows.map((id) => (
                <FailedRow key={id} userId={id} year={year} status={status} list={list} onResent={reload} />
              ))}
            </DataTable>
            {view.more && <Quiet>{view.more}</Quiet>}
          </>
        );
      }}
    </ViewState>
  );
}

/**
 * A member id field with `open link`, for a member who is not on the failed list. It never DMs anyone:
 * a member who lost their link can use `/wrapped me`.
 *
 * @param props - `year`: the run's year.
 */
export function MemberDmActions({ year }: { year: number | null }) {
  const [text, setText] = useState("");
  const dm = useMemberDm(year);
  const id = text.trim();
  const bad = id !== "" && !USER_ID.test(id);
  return (
    <>
      <PromptField
        label="member id"
        value={text}
        onChange={(v) => {
          setText(v);
          dm.reset();
        }}
        inputMode="numeric"
        autoComplete="off"
        error={bad ? "A member id is digits only." : null}
      />
      <div className="btns items-center">
        <InkButton tone="flat" onClick={() => dm.openLink(id)} disabled={!id || bad} busy={dm.busy === "link"} busyLabel="fetching">
          open link
        </InkButton>
        <Outcome dm={dm} />
      </div>
      {dm.error == null && dm.link == null && (
        <Quiet>Opens their link for you. Nothing is sent. A member who lost their link can use /wrapped me.</Quiet>
      )}
    </>
  );
}
