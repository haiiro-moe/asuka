/**
 * The channels tab: health of every channel and thread with messages in the period. A thread is a row
 * of its own, shown by its own name with a quiet `thread in #parent`.
 *
 * @module
 */
import type { NamedChannelHealthRow } from "../../../../plugins/activity/types/admin.ts";
import { Heading, Window } from "../../ui/index.ts";
import { useActivity } from "../useActivity.ts";
import { channelLabel, formatCount, formatReplyTime, type PeriodKey } from "./format.ts";
import { DataTable, Quiet, ViewState } from "./parts.tsx";

/** The channel cell: the name (or id) and, for a thread, its parent underneath. */
function ChannelCell({ row }: { row: NamedChannelHealthRow }) {
  const label = channelLabel(row);
  return (
    <>
      {label.name}
      {label.note && <span className="text-subtle"> {label.note}</span>}
    </>
  );
}

/**
 * Channel health, busiest first.
 *
 * @param props - `period`: the `?period=` value.
 */
export function ChannelsTab({ period }: { period: PeriodKey }) {
  const state = useActivity<NamedChannelHealthRow[]>(`/api/activity/admin/channels?period=${period}`);
  return (
    <Window label="fish: ~/diagnostics/channels">
      <Heading first>channel health</Heading>
      <Quiet>Unanswered is the share of messages nobody else replied to. Reply time is the median wait for a first reply.</Quiet>
      <ViewState state={state} what="the channels" empty="No channel saw a message in this period.">
        {(rows) => (
          <DataTable
            head={
              <>
                <th>channel</th>
                <th className="r">messages</th>
                <th className="r">unanswered</th>
                <th className="r">reply time</th>
              </>
            }
          >
            {rows.map((r) => (
              <tr key={r.channelId}>
                <td>
                  <ChannelCell row={r} />
                </td>
                <td className="r">{formatCount(r.messages)}</td>
                <td className="r">{r.unansweredPct.toLocaleString("en-GB")}%</td>
                <td className="r">{formatReplyTime(r.medianReplySec)}</td>
              </tr>
            ))}
          </DataTable>
        )}
      </ViewState>
    </Window>
  );
}
