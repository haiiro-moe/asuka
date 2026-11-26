/**
 * The `emoji` tab: the most used emoji, how the top five move week by week, and the graveyard of
 * custom emoji nobody has used.
 *
 * @module
 */
import type { EmojiRow, EmojiSeries } from "../../../../plugins/activity/types/user.ts";
import { Empty, Heading, Window } from "../../ui/index.ts";
import { ActivityColumns, ActivityRank } from "../charts.tsx";
import { useActivity } from "../useActivity.ts";
import { View } from "./parts.tsx";
import { activityPath, emojiLabel } from "./helpers.ts";
import type { PagePeriod } from "./helpers.ts";

/** How many graveyard rows to list before saying how many more there are. */
const GRAVE_ROWS = 20;

/**
 * The three emoji views of the period. The graveyard is all-time and ignores the period.
 *
 * @param props - `period`, the selected period.
 */
export function EmojiTab({ period }: { period: PagePeriod }) {
  return (
    <>
      <TopEmoji period={period} />
      <EmojiTrend period={period} />
      <Graveyard />
    </>
  );
}

function TopEmoji({ period }: { period: PagePeriod }) {
  const state = useActivity<EmojiRow[]>(activityPath("emoji", period));
  return (
    <Window label="fish: ~/activity/emoji" foot={<span>uses in text plus reactions still standing</span>}>
      <Heading first>most used</Heading>
      <View state={state} isEmpty={(d) => d.length === 0} empty="No emoji in this period yet. The shelf is bare.">
        {(rows) => <ActivityRank rows={rows.map((r) => ({ label: emojiLabel(r.emoji, r.name), value: r.count }))} />}
      </View>
    </Window>
  );
}

function EmojiTrend({ period }: { period: PagePeriod }) {
  const state = useActivity<EmojiSeries[]>(activityPath("emoji-trend", period));
  return (
    <Window label="fish: ~/activity/emoji-trend" foot={<span>uses per 7 days, oldest on the left</span>}>
      <Heading first>week by week</Heading>
      <View state={state} isEmpty={(d) => d.length === 0} empty="No trend yet. It needs a few emoji first.">
        {(series) => (
          <div className="flex flex-col gap-4 px-2">
            {series.map((s, i) => (
              <div key={s.emoji}>
                <p className="pb-1">{emojiLabel(s.emoji, s.name)}</p>
                <ActivityColumns values={s.weekly} tone={i % 2 ? "iris" : "foam"} nowIndex={s.weekly.length - 1} />
              </div>
            ))}
          </div>
        )}
      </View>
    </Window>
  );
}

function Graveyard() {
  const state = useActivity<{ id: string }[]>(activityPath("emoji-graveyard"));
  return (
    <Window label="fish: ~/activity/graveyard" foot={<span>custom emoji never used, all time</span>}>
      <Heading first>graveyard</Heading>
      <View state={state}>
        {(rows) =>
          rows.length === 0 ? (
            <Empty>Every custom emoji has been used at least once. Nothing rests here.</Empty>
          ) : (
            <>
              <ActivityRank
                max={1}
                rows={rows.slice(0, GRAVE_ROWS).map((r) => ({ label: `custom ${r.id}`, value: 0, sub: "never used" }))}
              />
              {rows.length > GRAVE_ROWS && (
                <p className="nar px-2 pt-3">{`${rows.length - GRAVE_ROWS} more rest unlisted.`}</p>
              )}
            </>
          )
        }
      </View>
    </Window>
  );
}
