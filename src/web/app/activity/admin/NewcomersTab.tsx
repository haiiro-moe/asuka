/**
 * The newcomers tab: members who joined in the period and how their first week went.
 *
 * @module
 */
import type { NewcomerRow } from "../../../../plugins/activity/types/admin.ts";
import { UserLink } from "../../names.tsx";
import { Heading, Window } from "../../ui/index.ts";
import { ActivityTiles } from "../charts.tsx";
import { useActivity } from "../useActivity.ts";
import { formatCount, formatUtcDay, type PeriodKey } from "./format.ts";
import { DataTable, Quiet, ViewState } from "./parts.tsx";

/**
 * Newcomers in the chosen period, latest join first.
 *
 * @param props - `period`: the `?period=` value.
 */
export function NewcomersTab({ period }: { period: PeriodKey }) {
  const state = useActivity<NewcomerRow[]>(`/api/activity/admin/newcomers?period=${period}`);
  return (
    <Window label="fish: ~/diagnostics/newcomers">
      <Heading first>first weeks</Heading>
      <Quiet>A first week is the seven days from the join. A reply counts when someone else answered inside it.</Quiet>
      <ViewState state={state} what="the newcomers" empty="Nobody joined in this period.">
        {(rows) => {
          const answered = rows.filter((r) => r.gotReplyInWeek).length;
          const silent = rows.filter((r) => r.messagesInWeek === 0).length;
          return (
            <>
              <ActivityTiles
                tiles={[
                  { label: "joined", value: formatCount(rows.length) },
                  {
                    label: "got a reply",
                    value: formatCount(answered),
                    note: `${Math.round((answered / rows.length) * 100)}% of them`,
                  },
                  { label: "said nothing", value: formatCount(silent), note: "in their first week" },
                ]}
              />
              <DataTable
                head={
                  <>
                    <th>member</th>
                    <th>joined</th>
                    <th className="r">messages</th>
                    <th>got a reply</th>
                  </>
                }
              >
                {rows.map((r) => (
                  <tr key={`${r.userId}-${r.joinedAt}`}>
                    <td>
                      <UserLink id={r.userId} />
                    </td>
                    <td>{formatUtcDay(r.joinedAt)}</td>
                    <td className="r">{formatCount(r.messagesInWeek)}</td>
                    <td>{r.gotReplyInWeek ? <span className="c6">✓ yes</span> : <span className="c2">× no</span>}</td>
                  </tr>
                ))}
              </DataTable>
            </>
          );
        }}
      </ViewState>
    </Window>
  );
}
