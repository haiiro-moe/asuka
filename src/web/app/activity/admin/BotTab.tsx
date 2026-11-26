/**
 * The bot tab: slash-command use and failures in the period.
 *
 * @module
 */
import type { CommandUsageRow } from "../../../../plugins/activity/types/admin.ts";
import { Heading, Window } from "../../ui/index.ts";
import { ActivityTiles } from "../charts.tsx";
import { useActivity } from "../useActivity.ts";
import { formatCount, type PeriodKey } from "./format.ts";
import { DataTable, ViewState } from "./parts.tsx";

/**
 * Command usage, most used first.
 *
 * @param props - `period`: the `?period=` value.
 */
export function BotTab({ period }: { period: PeriodKey }) {
  const state = useActivity<CommandUsageRow[]>(`/api/activity/admin/bot?period=${period}`);
  return (
    <Window label="fish: ~/diagnostics/bot">
      <Heading first>commands</Heading>
      <ViewState state={state} what="the command log" empty="Nobody ran a command in this period.">
        {(rows) => {
          const uses = rows.reduce((n, r) => n + r.uses, 0);
          const failures = rows.reduce((n, r) => n + r.failures, 0);
          return (
            <>
              <ActivityTiles
                tiles={[
                  { label: "runs", value: formatCount(uses) },
                  { label: "failed", value: formatCount(failures), note: uses ? `${((failures / uses) * 100).toFixed(1)}% of runs` : undefined },
                  { label: "commands", value: formatCount(rows.length), note: "used at least once" },
                ]}
              />
              <DataTable
                head={
                  <>
                    <th>command</th>
                    <th className="r">runs</th>
                    <th className="r">failed</th>
                  </>
                }
              >
                {rows.map((r) => (
                  <tr key={r.name}>
                    <td>/{r.name}</td>
                    <td className="r">{formatCount(r.uses)}</td>
                    <td className={r.failures > 0 ? "r c2" : "r"}>{formatCount(r.failures)}</td>
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
