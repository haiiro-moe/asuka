/**
 * The `places` tab: the favourite text channels and, once voice is unlocked, voice channels. A thread
 * ranks as a channel of its own and shows its parent on a muted line.
 *
 * @module
 */
import type { NamedChannelRow } from "../../../../plugins/activity/types/user.ts";
import { Heading, Window } from "../../ui/index.ts";
import { ActivityRank } from "../charts.tsx";
import { useActivity } from "../useActivity.ts";
import { VoiceGate, View } from "./parts.tsx";
import { activityPath, channelLabel, formatDuration, toHours } from "./helpers.ts";
import type { PagePeriod } from "./helpers.ts";

/**
 * Channels by messages, and voice channels by connected hours behind the voice gate.
 *
 * @param props - `period`, the selected period.
 */
export function PlacesTab({ period }: { period: PagePeriod }) {
  return (
    <>
      <TextChannels period={period} />
      <Window label="fish: ~/activity/voice-places" tone="pine">
        <Heading first>voice channels</Heading>
        <div className="px-2">
          <VoiceGate>
            <VoiceChannels period={period} />
          </VoiceGate>
        </div>
      </Window>
    </>
  );
}

function TextChannels({ period }: { period: PagePeriod }) {
  const state = useActivity<NamedChannelRow[]>(activityPath("channels", period));
  return (
    <Window label="fish: ~/activity/places" foot={<span>messages per channel, threads count as channels</span>}>
      <Heading first>where people talk</Heading>
      <View state={state} isEmpty={(d) => d.length === 0} empty="No messages in this period yet. The halls are quiet.">
        {(rows) => (
          <ActivityRank
            rows={rows.map((r) => {
              const { label, sub } = channelLabel(r);
              return { label, sub, value: r.count };
            })}
          />
        )}
      </View>
    </Window>
  );
}

function VoiceChannels({ period }: { period: PagePeriod }) {
  const state = useActivity<NamedChannelRow[]>(activityPath("voice", period));
  return (
    <View state={state} isEmpty={(d) => d.length === 0} empty="Nobody has been in voice in this period.">
      {(rows) => (
        <>
          <p className="pb-2 text-subtle">connected hours per channel.</p>
          <ActivityRank
            rows={rows.map((r) => {
              const { label, sub } = channelLabel(r);
              const time = formatDuration(r.count);
              return { label, sub: sub ? `${time} · ${sub}` : time, value: toHours(r.count) };
            })}
          />
        </>
      )}
    </View>
  );
}
