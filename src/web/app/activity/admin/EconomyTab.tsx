/**
 * The economy tab: Social Credits earned and spent per UTC week, store sales and the top earners.
 *
 * @module
 */
import type { Economy } from "../../../../plugins/activity/types/admin.ts";
import { UserLink } from "../../names.tsx";
import { Heading, Window } from "../../ui/index.ts";
import { ActivityColumns, ActivityTiles } from "../charts.tsx";
import { useActivity } from "../useActivity.ts";
import { axisLabels, formatCount, weekLabels, type PeriodKey } from "./format.ts";
import { formatUtcDate } from "../format.ts";
import { DataTable, Quiet, ViewState } from "./parts.tsx";

/**
 * The economy over the chosen period.
 *
 * @param props - `period`: the `?period=` value.
 */
export function EconomyTab({ period }: { period: PeriodKey }) {
  const state = useActivity<Economy>(`/api/activity/admin/economy?period=${period}`);
  return (
    <ViewState
      state={state}
      what="the credits ledger"
      isEmpty={(d) => d.weekly.length === 0}
      empty="No weeks in this period yet."
    >
      {(d) => {
        const axis = axisLabels(weekLabels(d.start, d.weekly.length));
        const moved = d.creditsIn + d.creditsOut > 0;
        return (
          <>
            <Window label="fish: ~/diagnostics/economy">
              <Heading first>social credits</Heading>
              <ActivityTiles
                tiles={[
                  { label: "earned", value: formatCount(d.creditsIn), unit: "sc" },
                  { label: "spent", value: formatCount(d.creditsOut), unit: "sc" },
                  { label: "store sales", value: formatCount(d.storeSales) },
                ]}
              />
              <Quiet>Weeks start on {formatUtcDate(d.start)}, counted in UTC.</Quiet>
              {moved ? (
                <>
                  <Heading>earned per week</Heading>
                  <ActivityColumns values={d.weekly.map((w) => w.in)} axis={axis} />
                  <Heading>spent per week</Heading>
                  <ActivityColumns values={d.weekly.map((w) => w.out)} axis={axis} tone="iris" />
                </>
              ) : (
                <Quiet>No credits changed hands in this period.</Quiet>
              )}
            </Window>
            <Window label="fish: ~/diagnostics/earners">
              <Heading first>top earners</Heading>
              <Quiet>Earned minus spent in the period, the ten highest.</Quiet>
              {d.topEarners.length === 0 ? (
                <Quiet>Nobody came out ahead.</Quiet>
              ) : (
                <DataTable
                  head={
                    <>
                      <th className="r">#</th>
                      <th>member</th>
                      <th className="r">net</th>
                    </>
                  }
                >
                  {d.topEarners.map((r, i) => (
                    <tr key={r.userId}>
                      <td className="r">{i + 1}</td>
                      <td>
                        <UserLink id={r.userId} />
                      </td>
                      <td className="r">{formatCount(r.net)}</td>
                    </tr>
                  ))}
                </DataTable>
              )}
            </Window>
          </>
        );
      }}
    </ViewState>
  );
}
