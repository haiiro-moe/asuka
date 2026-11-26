/**
 * The president's `connection` page: how connected the members are, in numbers only. It shows no name,
 * no id and no list of people, because the routes it reads send none. A value the server hides arrives
 * as `null` and is drawn as a dashed `off` tile or a plain line, never as `0`.
 *
 * @module
 */
import { useState, type ReactNode } from "react";
import type {
  PresidentClubEventHealth,
  PresidentConnection,
  PresidentEngagement,
  PresidentGroupSizes,
  PresidentWeeklySeries,
} from "../../../../plugins/activity/types/president.ts";
import type { VoiceStatus } from "../../../../plugins/activity/types/user.ts";
import { Badge, Empty, ErrorLine, Heading, Loading, Segmented, Window } from "../../ui/index.ts";
import { ActivityColumns, ActivityRank, ActivityTiles } from "../charts.tsx";
import { useActivity } from "../useActivity.ts";
import { columnsAriaLabel, voiceLockedLine, weekName } from "../format.ts";
import { clubTiles, countTile, engagementView, groupBars, groupsLeftOut, seriesView, type Period } from "./render.ts";

const PERIODS = [
  { value: "week" as const, label: "week" },
  { value: "term" as const, label: "term" },
];

/** The text of a failed read: fixed words, never the server's text. */
function failure(error: string): string {
  return error === "unauthorized" ? "your session ended. sign in again." : "the numbers could not be fetched.";
}

/**
 * The page body: a window with a `week | term` switch, four stat tiles, replies and voice hours per
 * week, and the group sizes as bars. Registered as `activity-president` (minimum role `president`).
 */
export function ConnectionPage() {
  const [period, setPeriod] = useState<Period>("week");
  const base = "/api/activity/president";
  const q = `?period=${period}`;
  const connection = useActivity<PresidentConnection>(`${base}/connection${q}`);
  const weekly = useActivity<PresidentWeeklySeries>(`${base}/weekly${q}`);
  const groups = useActivity<PresidentGroupSizes>(`${base}/groups${q}`);
  const engagement = useActivity<PresidentEngagement>(`${base}/engagement${q}`);
  const clubs = useActivity<PresidentClubEventHealth>(`${base}/clubs${q}`);
  const voice = useActivity<VoiceStatus>("/api/activity/user/voice-status");

  const reads = [connection, weekly, groups];
  const failed = reads.find((r) => r.error !== null);
  const busy = reads.some((r) => r.loading);
  const reloadAll = () => reads.forEach((r) => r.reload());

  return (
    <Window
      label="fish: ~/activity/connection"
      foot={
        <>
          counts under 3 are hidden or merged. periods are fixed (week is the seven days before today, term runs
          from the start of the term), so the numbers stay put for a day. all times are utc.
        </>
      }
    >
      <Heading first>
        connection <Badge>president</Badge>
      </Heading>
      <div className="px-2 pb-3">
        <Segmented options={PERIODS} value={period} onChange={setPeriod} ariaLabel="period" />
      </div>
      {failed ? (
        <ErrorLine onRetry={reloadAll}>{failure(failed.error ?? "")}</ErrorLine>
      ) : busy || !connection.data || !weekly.data || !groups.data ? (
        <Loading>Counting</Loading>
      ) : (
        <Numbers
          period={period}
          connection={connection.data}
          weekly={weekly.data}
          groups={groups.data}
          voice={voice.data}
          voiceFailed={voice.error !== null}
        />
      )}
      <Heading as="h2">engagement</Heading>
      <Section state={engagement}>
        {(data) => (
          <EngagementBody period={period} data={data} voice={voice.data} voiceFailed={voice.error !== null} />
        )}
      </Section>
      <Heading as="h2">clubs and events</Heading>
      <Section state={clubs}>{(data) => <ClubsBody period={period} data={data} />}</Section>
    </Window>
  );
}

/** Props of {@link Section}. */
interface SectionProps<T> {
  state: { data: T | null; loading: boolean; error: string | null; reload: () => void };
  children: (data: T) => ReactNode;
}

/** One section with its own loading and failure lines, so one failed read never blanks the others. */
function Section<T>({ state, children }: SectionProps<T>) {
  return (
    <div className="px-2 pb-3">
      {state.error !== null ? (
        <ErrorLine onRetry={state.reload}>{failure(state.error)}</ErrorLine>
      ) : state.loading || !state.data ? (
        <Loading>Counting</Loading>
      ) : (
        children(state.data)
      )}
    </div>
  );
}

/** Props of {@link EngagementBody}. */
export interface EngagementBodyProps {
  period: Period;
  data: PresidentEngagement;
  voice: VoiceStatus | null;
  voiceFailed: boolean;
}

/** The engagement tiles, and the voice-unlock line while voice hours are withheld. */
export function EngagementBody({ period, data, voice, voiceFailed }: EngagementBodyProps) {
  const view = engagementView(data, period);
  return (
    <div className="flex flex-col gap-2">
      <ActivityTiles tiles={view.tiles} />
      {view.voiceLocked && (
        <Empty>
          {voice && !voice.ready
            ? voiceLockedLine(voice.readyAt)
            : voiceFailed || voice === null
              ? "voice hours are not available yet."
              : "voice hours are hidden for now."}
        </Empty>
      )}
    </div>
  );
}

/** Props of the loaded view. */
interface NumbersProps {
  period: Period;
  connection: PresidentConnection;
  weekly: PresidentWeeklySeries;
  groups: PresidentGroupSizes;
  voice: VoiceStatus | null;
  voiceFailed: boolean;
}

/** The tiles, the two weekly charts and the group sizes, once everything has arrived. */
function Numbers({ period, connection, weekly, groups, voice, voiceFailed }: NumbersProps) {
  const tiles = [
    countTile("in groups", connection.connected, {
      period,
      note: "members in a group of three or more. pairs and loners are never shown. the total is under engagement.",
    }),
    countTile("groups", connection.groups, { period, note: "groups of three or more" }),
    countTile("bridges", connection.bridges, { period, note: "pairs tied across two groups" }),
    countTile("gone quiet", connection.quiet, { period, note: "active before, nothing for 30 days" }),
  ];
  const bars = groupBars(groups.sizes, groups.other);

  return (
    <div className="flex flex-col gap-4">
      <ActivityTiles tiles={tiles} />

      <div>
        <Heading as="h3">replies per week</Heading>
        <Series values={weekly.replies} subject="replies per week, utc" tone="foam" unit="replies" />
      </div>

      <div>
        <Heading as="h3">voice hours per week</Heading>
        {weekly.voiceHours === null ? (
          <Empty className="px-2">
            {voice && !voice.ready
              ? voiceLockedLine(voice.readyAt)
              : voiceFailed || voice === null
                ? "voice hours are not available yet."
                : "voice hours are hidden for now."}
          </Empty>
        ) : (
          <Series values={weekly.voiceHours} subject="voice hours per week, utc" tone="iris" unit="hours" />
        )}
      </div>

      <div>
        <Heading as="h3">group sizes</Heading>
        {bars.length === 0 ? (
          <Empty className="px-2">No groups of three or more yet.</Empty>
        ) : (
          <ActivityRank rows={bars} />
        )}
        {groupsLeftOut(connection.groups, groups.sizes.length) && (
          <p className="text-subtle px-2 pt-2">some groups are left out of this list on purpose.</p>
        )}
        {groups.other === null && (
          <p className="text-subtle px-2 pt-2">the other row is hidden: too few to show, or too close to the other period.</p>
        )}
      </div>
    </div>
  );
}

/** Props of {@link Series}. */
interface SeriesProps {
  values: number[];
  /** What the columns count, lowercase, for the chart's accessible name (`replies per week, utc`). */
  subject: string;
  tone: "foam" | "iris";
  unit: string;
}

/** One per-week column chart with the latest week in gold, or a narrator line when there are no weeks. */
function Series({ values, subject, tone, unit }: SeriesProps) {
  const view = seriesView(values);
  if (view.kind !== "columns") return <Empty className="px-2">No weeks in this period yet.</Empty>;
  return (
    <div className="px-2">
      <ActivityColumns
        values={view.values}
        tone={tone}
        nowIndex={view.values.length - 1}
        axis={["earlier", "latest week"]}
        ariaLabel={columnsAriaLabel(subject, view.values, (i) => weekName(i, view.values.length), true)}
      />
      <p className="text-subtle pt-2">
        latest week {view.latest.toLocaleString("en-GB")} {unit}. weeks run monday to monday, utc; the first and last can be partial.
      </p>
    </div>
  );
}

/**
 * The club and event health tiles of one response, numbers only.
 *
 * @param props - The period on screen and the `clubs` response.
 */
export function ClubsBody({ period, data }: { period: Period; data: PresidentClubEventHealth }) {
  return <ActivityTiles tiles={clubTiles(data, period)} />;
}
