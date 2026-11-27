/**
 * The member inspect panel of the relations tab: one member's messages, replies and mentions received,
 * ties, busiest UTC hour and closest members, from `GET /api/activity/admin/inspect/:userId`.
 *
 * @module
 */
import { useEffect, useState } from "react";
import type { MemberInspect } from "../../../../plugins/activity/types/admin.ts";
import { UserLink, useNames } from "../../names.tsx";
import { Heading, InkButton, PromptField, Window } from "../../ui/index.ts";
import { ActivityRank, ActivityTiles } from "../charts.tsx";
import { useActivity } from "../useActivity.ts";
import { formatCount, type PeriodKey } from "./format.ts";
import { Quiet, ViewState } from "./parts.tsx";

/** A Discord user id: digits only, as the route requires. */
const USER_ID = /^\d{1,25}$/;

/** The figures of one member; mounted only once there is an id to ask for. */
function InspectResult({ userId, period }: { userId: string; period: PeriodKey }) {
  const state = useActivity<MemberInspect>(`/api/activity/admin/inspect/${userId}?period=${period}`);
  const name = useNames(state.data?.closest.map((c) => c.userId) ?? []);
  return (
    <>
      <Heading>
        <UserLink id={userId} />
      </Heading>
      <ViewState state={state} what="the member" isEmpty={() => false} empty={null}>
        {(d) => (
          <>
            <ActivityTiles
              tiles={[
                { label: "sent", value: formatCount(d.sent), unit: "msgs" },
                { label: "received", value: formatCount(d.received), note: "replies and mentions" },
                { label: "ties", value: formatCount(d.ties), note: "distinct members" },
                {
                  label: "busiest hour",
                  value: d.busiestHour == null ? "none" : `${String(d.busiestHour).padStart(2, "0")}:00`,
                  unit: d.busiestHour == null ? undefined : "utc",
                  off: d.busiestHour == null,
                },
              ]}
            />
            <Heading as="h3">closest</Heading>
            {d.closest.length === 0 ? (
              <Quiet>No ties in this period. They keep to themselves.</Quiet>
            ) : (
              <ActivityRank rows={d.closest.map((c) => ({ label: name(c.userId), value: c.weight }))} />
            )}
          </>
        )}
      </ViewState>
    </>
  );
}

/** Props of {@link InspectPanel}. */
export interface InspectPanelProps {
  /** The `?period=` value. */
  period: PeriodKey;
  /** The member to show, set from outside (a name picked in the pair table); null for none. */
  userId: string | null;
  /** Called with the id typed into the field. */
  onInspect: (userId: string) => void;
}

/**
 * The panel: a member id field with an `inspect` button, then that member's figures. Picking a name
 * in the pair table fills it too.
 *
 * @param props - See {@link InspectPanelProps}.
 */
export function InspectPanel({ period, userId, onInspect }: InspectPanelProps) {
  const [text, setText] = useState(userId ?? "");
  useEffect(() => {
    if (userId) setText(userId);
  }, [userId]);
  const id = text.trim();
  const bad = id !== "" && !USER_ID.test(id);
  const submit = () => {
    if (id && !bad) onInspect(id);
  };
  return (
    <Window label="gdb: ~/diagnostics/inspect">
      <Heading first>inspect a member</Heading>
      <Quiet>Pick a name in the table or the graph, or paste a member id.</Quiet>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <PromptField
          label="member id"
          value={text}
          onChange={setText}
          inputMode="numeric"
          autoComplete="off"
          error={bad ? "A member id is digits only." : null}
        />
        <div className="btns">
          <InkButton tone="gold" type="submit" disabled={!id || bad}>
            inspect
          </InkButton>
        </div>
      </form>
      {userId && <InspectResult key={`${userId}-${period}`} userId={userId} period={period} />}
    </Window>
  );
}
