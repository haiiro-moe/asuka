/**
 * The moderation tab: actions per UTC week, the actions by kind, and members with repeat offences.
 *
 * @module
 */
import type { ModerationSeries, OffenderRow } from "../../../../plugins/activity/types/admin.ts";
import { UserLink } from "../../names.tsx";
import { Heading, Window } from "../../ui/index.ts";
import { ActivityColumns, ActivityTiles } from "../charts.tsx";
import { useActivity } from "../useActivity.ts";
import { axisLabels, formatCount, weekLabels, type PeriodKey } from "./format.ts";
import { columnsAriaLabel, formatUtcDate } from "../format.ts";
import { DataTable, Quiet, ViewState } from "./parts.tsx";

/**
 * Moderation over the chosen period.
 *
 * @param props - `period`: the `?period=` value.
 */
export function ModerationTab({ period }: { period: PeriodKey }) {
  const series = useActivity<ModerationSeries>(`/api/activity/admin/moderation?period=${period}`);
  const offenders = useActivity<OffenderRow[]>(`/api/activity/admin/offenders?period=${period}`);
  return (
    <>
      <Window label="fish: ~/diagnostics/moderation">
        <ViewState
          state={series}
          what="the moderation log"
          isEmpty={(d) => d.weekly.length === 0}
          empty="No weeks in this period yet."
        >
          {(d) => {
            const total = d.byAction.reduce((n, a) => n + a.count, 0);
            const labels = weekLabels(d.start, d.weekly.length);
            return (
              <>
                <Heading first>actions per week</Heading>
                <Quiet>Weeks start on {formatUtcDate(d.start)}, counted in UTC.</Quiet>
                <ActivityTiles
                  tiles={[
                    { label: "actions", value: formatCount(total), note: "in the period" },
                    { label: "weeks", value: formatCount(d.weekly.length) },
                  ]}
                />
                {total === 0 ? (
                  <Quiet>Nobody was warned, timed out, kicked or banned. A quiet stretch.</Quiet>
                ) : (
                  <>
                    <ActivityColumns
                      values={d.weekly}
                      axis={axisLabels(labels)}
                      ariaLabel={columnsAriaLabel("moderation actions per week, utc", d.weekly, (i) => `week of ${labels[i] ?? ""}`, true)}
                    />
                    <Heading as="h3">by kind</Heading>
                    <DataTable
                      head={
                        <>
                          <th>action</th>
                          <th className="r">times</th>
                        </>
                      }
                    >
                      {d.byAction.map((a) => (
                        <tr key={a.action}>
                          <td>{a.action}</td>
                          <td className="r">{formatCount(a.count)}</td>
                        </tr>
                      ))}
                    </DataTable>
                  </>
                )}
              </>
            );
          }}
        </ViewState>
      </Window>
      <Window label="fish: ~/diagnostics/offenders">
        <Heading first>repeat offenders</Heading>
        <Quiet>Two or more warnings, timeouts, kicks or bans in the period.</Quiet>
        <ViewState state={offenders} what="the offenders" empty="Nobody offended twice. The house behaves.">
          {(rows) => (
            <DataTable
              head={
                <>
                  <th>member</th>
                  <th className="r">offences</th>
                </>
              }
            >
              {rows.map((r) => (
                <tr key={r.userId}>
                  <td>
                    <UserLink id={r.userId} />
                  </td>
                  <td className="r">{formatCount(r.count)}</td>
                </tr>
              ))}
            </DataTable>
          )}
        </ViewState>
      </Window>
    </>
  );
}
