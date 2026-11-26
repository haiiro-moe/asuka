/**
 * Per-member Wrapped DM controls of the send window: the outcome line shared by both, the failed-DM
 * list (one row per member with `resend` and `open link`) and a member id field for someone who is not
 * on the list (a member who never opted in and asked for their link, say).
 *
 * @module
 */
import { useEffect, useRef, useState } from "react";
import type { WrappedFailedList } from "../../../../plugins/activity/types/wrapped.ts";
import { UserName } from "../../names.tsx";
import { InkButton, InkLink, PromptField, Saved } from "../../ui/index.ts";
import { useActivity } from "../useActivity.ts";
import { failedListView } from "./failed.ts";
import { DataTable, Quiet, ViewState } from "./parts.tsx";
import { RESEND_WORDS, useMemberDm, type MemberDm } from "./useMemberDm.ts";

/** A Discord user id: digits only. */
const USER_ID = /^\d{1,25}$/;

/** The answer of the last action: sent (foam), failed again (love), the link, or the failure. */
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

/** One failed member: name, `resend`, `open link` and the outcome. */
function FailedRow({ userId, year, onResent }: { userId: string; year: number | null; onResent: () => void }) {
  const dm = useMemberDm(year, onResent);
  return (
    <tr>
      <td>
        <UserName id={userId} />
      </td>
      <td>
        <span className="flex flex-wrap items-center gap-2">
          <InkButton tone="pine" onClick={() => dm.resend(userId)} busy={dm.busy === "resend"} busyLabel="sending">
            resend
          </InkButton>
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
}

/**
 * The failed DMs of a year (members still opted in, by user id, at most 200) from
 * `GET /api/activity/wrapped/failed?year=`. Fetched again when `refetchKey` changes and after each
 * resend.
 *
 * @param props - See {@link FailedDmListProps}.
 */
export function FailedDmList({ year, refetchKey }: FailedDmListProps) {
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
                <FailedRow key={id} userId={id} year={year} onResent={reload} />
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
 * A member id field with `resend` and `open link`, for a member who is not on the failed list. A resend
 * reaches them whether or not they opted in, because an admin asked for that member.
 *
 * @param props - `year`: the run's year; `onResent`: called after a resend got an answer.
 */
export function MemberDmActions({ year, onResent }: { year: number | null; onResent?: () => void }) {
  const [text, setText] = useState("");
  const dm = useMemberDm(year, onResent);
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
        <InkButton tone="pine" onClick={() => dm.resend(id)} disabled={!id || bad} busy={dm.busy === "resend"} busyLabel="sending">
          resend
        </InkButton>
        <InkButton tone="flat" onClick={() => dm.openLink(id)} disabled={!id || bad} busy={dm.busy === "link"} busyLabel="fetching">
          open link
        </InkButton>
        <Outcome dm={dm} />
      </div>
      {dm.error == null && dm.result == null && dm.link == null && <Quiet>Sends even to a member who did not opt in.</Quiet>}
    </>
  );
}
