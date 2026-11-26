/**
 * The `awards` tab: the named titles and the most reacted messages. These are the only views that name
 * members, so names go through `UserName`.
 *
 * @module
 */
import type { Award, NamedReactedRow } from "../../../../plugins/activity/types/user.ts";
import { Heading, Window } from "../../ui/index.ts";
import { UserName } from "../../names.tsx";
import { useActivity } from "../useActivity.ts";
import { View } from "./parts.tsx";
import { activityPath, awardText, reactedChannel } from "./helpers.ts";
import type { PagePeriod } from "./helpers.ts";

/**
 * Awards as narrator lines and the most reacted messages as a table.
 *
 * @param props - `period`, the selected period.
 */
export function AwardsTab({ period }: { period: PagePeriod }) {
  return (
    <>
      <AwardLines period={period} />
      <MostReacted period={period} />
    </>
  );
}

function AwardLines({ period }: { period: PagePeriod }) {
  const state = useActivity<Award[]>(activityPath("awards", period));
  return (
    <Window label="fish: ~/activity/awards" foot={<span>an award nobody earned is left out</span>}>
      <Heading first>titles</Heading>
      <View state={state} isEmpty={(d) => d.length === 0} empty="No titles awarded in this period yet.">
        {(awards) => (
          <div className="flex flex-col gap-2 px-2">
            {awards.map((a) => {
              const { title, tail } = awardText(a);
              return (
                <p key={a.key} className="nar">
                  <span className="text-gold">{title}</span> » <span className="text-text"><UserName id={a.userId} /></span> {tail}
                </p>
              );
            })}
          </div>
        )}
      </View>
    </Window>
  );
}

/** The channel of a most-reacted row: `#name`, a thread with its parent on a muted line. */
function ChannelCell({ row }: { row: NamedReactedRow }) {
  const { label, sub } = reactedChannel(row);
  return (
    <>
      {label}
      {sub && <span className="block text-subtle">{sub}</span>}
    </>
  );
}

function MostReacted({ period }: { period: PagePeriod }) {
  const state = useActivity<NamedReactedRow[]>(activityPath("reacted", period));
  return (
    <Window label="fish: ~/activity/reacted" foot={<span>reactions added minus removed</span>}>
      <Heading first>most reacted messages</Heading>
      <View state={state} isEmpty={(d) => d.length === 0} empty="No reactions in this period yet.">
        {(rows) => (
          <div className="fx-scroll">
            <table className="fx-table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>author</th>
                  <th>channel</th>
                  <th className="r">reactions</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={`${r.channelId}-${r.messageId}`}>
                    <td>{i + 1}</td>
                    <td>{r.authorId ? <UserName id={r.authorId} /> : "unknown"}</td>
                    <td>
                      <ChannelCell row={r} />
                    </td>
                    <td className="r">{r.net.toLocaleString("en-GB")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </View>
    </Window>
  );
}
