/**
 * The drift tab: members who were active in the previous period and have been quiet for 30 days.
 * While voice is withheld, drift reads messages only, and the page says so.
 *
 * @module
 */
import type { DriftRow } from "../../../../plugins/activity/types/admin.ts";
import { UserLink } from "../../names.tsx";
import { Heading, Window } from "../../ui/index.ts";
import { useActivity } from "../useActivity.ts";
import { formatUtcDay, voiceUnlockLine, type PeriodKey, type VoiceStatus } from "./format.ts";
import { DataTable, Quiet, ViewState } from "./parts.tsx";

/**
 * Drifting members, most recently active first.
 *
 * @param props - `period`: the `?period=` value.
 */
export function DriftTab({ period }: { period: PeriodKey }) {
  const state = useActivity<DriftRow[]>(`/api/activity/admin/drift?period=${period}`);
  const voice = useActivity<VoiceStatus>("/api/activity/user/voice-status");
  return (
    <Window label="fish: ~/diagnostics/drift">
      <Heading first>gone quiet</Heading>
      <Quiet>Active in the stretch before the last 30 days, silent since. Members who left are not listed.</Quiet>
      {voice.data && !voice.data.ready && (
        <Quiet>
          Judged on messages alone for now. {voiceUnlockLine(voice.data)}
        </Quiet>
      )}
      <ViewState state={state} what="the drift list" empty="Nobody has drifted off. Everyone is still around.">
        {(rows) => (
          <DataTable
            head={
              <>
                <th>member</th>
                <th>last active</th>
              </>
            }
          >
            {rows.map((r) => (
              <tr key={r.userId}>
                <td>
                  <UserLink id={r.userId} />
                </td>
                <td>{formatUtcDay(r.lastActiveAt)}</td>
              </tr>
            ))}
          </DataTable>
        )}
      </ViewState>
    </Window>
  );
}
