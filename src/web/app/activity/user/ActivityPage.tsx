/**
 * The user-tier `activity` page: five tabs over the everyone-tier activity routes and a period control.
 * It returns Windows only; the shell draws the page head. All times are UTC.
 *
 * @module
 */
import { useState } from "react";
import { Segmented, Tabs, Window } from "../../ui/index.ts";
import { AwardsTab } from "./AwardsTab.tsx";
import { EmojiTab } from "./EmojiTab.tsx";
import { PlacesTab } from "./PlacesTab.tsx";
import { RhythmTab } from "./RhythmTab.tsx";
import { SharingTab } from "./SharingTab.tsx";
import { PERIODS } from "./helpers.ts";
import type { PagePeriod } from "./helpers.ts";

/** The tabs of the page, in order. */
export const ACTIVITY_TABS = ["rhythm", "emoji", "places", "awards", "sharing"] as const;

/** One of {@link ACTIVITY_TABS}. */
export type ActivityTab = (typeof ACTIVITY_TABS)[number];

const TAB_ITEMS = ACTIVITY_TABS.map((t) => ({ value: t, label: t }));
const PERIOD_OPTIONS = PERIODS.map((p) => ({ value: p, label: p }));

/**
 * The activity page: a control window with the tabs and the `30d | term | year` period, and the
 * selected tab under it. Each tab fetches its own routes with the selected period.
 */
export function ActivityPage() {
  const [tab, setTab] = useState<ActivityTab>("rhythm");
  const [period, setPeriod] = useState<PagePeriod>("30d");
  return (
    <>
      <Window label="fish: ~/activity" foot={<span>all times utc</span>}>
        <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3 px-2">
          <Tabs items={TAB_ITEMS} value={tab} onChange={setTab} ariaLabel="activity sections" idPrefix="activity" />
          <Segmented options={PERIOD_OPTIONS} value={period} onChange={setPeriod} ariaLabel="period" />
        </div>
      </Window>
      <div
        role="tabpanel"
        id={`activity-panel-${tab}`}
        aria-labelledby={`activity-tab-${tab}`}
        className="flex flex-col gap-9 desk:gap-12"
      >
        {tab === "rhythm" && <RhythmTab period={period} />}
        {tab === "emoji" && <EmojiTab period={period} />}
        {tab === "places" && <PlacesTab period={period} />}
        {tab === "awards" && <AwardsTab period={period} />}
        {tab === "sharing" && <SharingTab period={period} />}
      </div>
    </>
  );
}
