/**
 * The `sharing` tab: what members post, by kind, and which sites their links point to.
 *
 * @module
 */
import type { SharingRow } from "../../../../plugins/activity/types/user.ts";
import { Heading, Window } from "../../ui/index.ts";
import { ActivityRank, ActivityTiles } from "../charts.tsx";
import { useActivity } from "../useActivity.ts";
import { View } from "./parts.tsx";
import { activityPath, summariseSharing } from "./helpers.ts";
import type { PagePeriod } from "./helpers.ts";

/** How many link domains to list. */
const LINK_ROWS = 10;

/**
 * Totals per kind as tiles and the top link domains as a rank list.
 *
 * @param props - `period`, the selected period.
 */
export function SharingTab({ period }: { period: PagePeriod }) {
  const state = useActivity<SharingRow[]>(activityPath("sharing", period));
  return (
    <View state={state} isEmpty={(d) => d.length === 0} empty="Nothing shared in this period yet.">
      {(rows) => {
        const { totals, links } = summariseSharing(rows);
        return (
          <>
            <Window label="fish: ~/activity/sharing">
              <Heading first>what gets posted</Heading>
              <ActivityTiles
                tiles={totals.map((t) => ({ label: t.kind === "gif" ? "gifs" : `${t.kind}s`, value: t.count.toLocaleString("en-GB"), off: t.count === 0 }))}
              />
            </Window>
            <Window label="fish: ~/activity/links" foot={<span>links per site</span>}>
              <Heading first>where the links go</Heading>
              {links.length === 0 ? (
                <p className="nar px-2">No links in this period.</p>
              ) : (
                <ActivityRank rows={links.slice(0, LINK_ROWS).map((l) => ({ label: l.label, value: l.count }))} />
              )}
            </Window>
          </>
        );
      }}
    </View>
  );
}
