/**
 * The clubs and events tab: approved clubs by messages (dead ones marked) and the events that ran in the
 * period by sign-ups.
 *
 * @module
 */
import type { ClubsAndEvents } from "../../../../plugins/activity/types/admin.ts";
import { Chip, Heading, Window } from "../../ui/index.ts";
import { useActivity } from "../useActivity.ts";
import { formatCount, type PeriodKey } from "./format.ts";
import { DataTable, Quiet, ViewState } from "./parts.tsx";

/**
 * Clubs and events over the chosen period.
 *
 * @param props - `period`: the `?period=` value.
 */
export function ClubsEventsTab({ period }: { period: PeriodKey }) {
  const state = useActivity<ClubsAndEvents>(`/api/activity/admin/clubs-events?period=${period}`);
  return (
    <ViewState state={state} what="the clubs and events" isEmpty={() => false} empty={null}>
      {(d) => (
        <>
          <Window label="fish: ~/diagnostics/clubs">
            <Heading first>clubs</Heading>
            <Quiet>A club is dead when it is older than 30 days and nobody wrote in it for 30 days.</Quiet>
            {d.clubs.length === 0 ? (
              <Quiet>No approved clubs yet.</Quiet>
            ) : (
              <DataTable
                head={
                  <>
                    <th>club</th>
                    <th className="r">messages</th>
                    <th>state</th>
                  </>
                }
              >
                {d.clubs.map((c) => (
                  <tr key={c.id}>
                    <td>{c.name}</td>
                    <td className="r">{formatCount(c.messages)}</td>
                    <td>{c.dead ? <Chip>dead</Chip> : <Chip on>alive</Chip>}</td>
                  </tr>
                ))}
              </DataTable>
            )}
          </Window>
          <Window label="fish: ~/diagnostics/events">
            <Heading first>events</Heading>
            {d.events.length === 0 ? (
              <Quiet>No event ran in this period.</Quiet>
            ) : (
              <DataTable
                head={
                  <>
                    <th>event</th>
                    <th className="r">signed up</th>
                  </>
                }
              >
                {d.events.map((e) => (
                  <tr key={e.id}>
                    <td>{e.title}</td>
                    <td className="r">{formatCount(e.attendees)}</td>
                  </tr>
                ))}
              </DataTable>
            )}
          </Window>
        </>
      )}
    </ViewState>
  );
}
