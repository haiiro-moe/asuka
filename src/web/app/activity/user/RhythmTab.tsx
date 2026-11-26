/**
 * The `rhythm` tab: when members talk (and, once unlocked, when they are in voice), as UTC heatmaps.
 *
 * @module
 */
import type { Rhythm } from "../../../../plugins/activity/types/user.ts";
import { Empty, Heading, Window } from "../../ui/index.ts";
import { ActivityColumns, ActivityHeatmap, ActivityTiles } from "../charts.tsx";
import { useActivity } from "../useActivity.ts";
import { VoiceGate, View } from "./parts.tsx";
import {
  WEEKDAYS,
  activityPath,
  dayTotals,
  heatmapIsEmpty,
  hourTotals,
  peakIndex,
  roundHeatmap,
} from "./helpers.ts";
import type { PagePeriod } from "./helpers.ts";

const UTC_FOOT = <span>all times utc: rows mon to sun, columns 00 to 23</span>;
const HOUR_AXIS = ["00", "06", "12", "18", "23"];

/**
 * Messages by weekday and hour, the busiest hour and day, and the voice heatmap when voice is unlocked.
 *
 * @param props - `period`, the selected period.
 */
export function RhythmTab({ period }: { period: PagePeriod }) {
  const state = useActivity<Rhythm>(activityPath("rhythm", period));
  return (
    <View state={state}>{(r) => <RhythmView rhythm={r} />}</View>
  );
}

function RhythmView({ rhythm }: { rhythm: Rhythm }) {
  const { cells, max } = rhythm.messages;
  const hours = hourTotals(cells);
  const days = dayTotals(cells);
  const hour = peakIndex(hours);
  const day = peakIndex(days);
  const voice = rhythm.voice ? roundHeatmap(rhythm.voice) : null;
  return (
    <>
      <Window label="fish: ~/activity/rhythm" foot={UTC_FOOT}>
        <Heading first>messages</Heading>
        {heatmapIsEmpty(cells) ? (
          <Empty>Nobody has spoken in this period yet. The heatmap is blank.</Empty>
        ) : (
          <>
            <ActivityTiles
              tiles={[
                { label: "busiest hour", value: hour === null ? "none" : `${String(hour).padStart(2, "0")}:00`, unit: "utc", off: hour === null },
                { label: "busiest day", value: day === null ? "none" : (WEEKDAYS[day] ?? "none"), off: day === null },
              ]}
            />
            <div className="px-2 pt-4">
              <ActivityHeatmap rowLabels={WEEKDAYS} cells={cells} max={max} />
            </div>
            <Heading>by hour of day</Heading>
            <div className="px-2">
              <ActivityColumns values={hours} axis={HOUR_AXIS} nowIndex={hour ?? undefined} />
            </div>
          </>
        )}
      </Window>
      <Window label="fish: ~/activity/voice" tone={voice ? "pine" : "off"} foot={voice ? UTC_FOOT : undefined}>
        <Heading first>voice</Heading>
        {voice ? (
          heatmapIsEmpty(voice.cells) ? (
            <p className="nar px-2">Nobody has been in voice in this period.</p>
          ) : (
            <div className="px-2">
              <p className="pb-3 text-subtle">connected hours per cell.</p>
              <ActivityHeatmap rowLabels={WEEKDAYS} cells={voice.cells} max={voice.max} />
            </div>
          )
        ) : (
          <div className="px-2">
            <VoiceGate />
          </div>
        )}
      </Window>
    </>
  );
}
