/**
 * The admin diagnostics page (`activity-admin`): a status strip of the Wrapped run and the backfill on
 * every tab, a period picker, and the tabs moderation, newcomers, drift, channels, economy, clubs and
 * events, bot, relations and data. The shell renders the page head; this returns windows.
 *
 * @module
 */
import { useState, type ReactNode } from "react";
import { Select, Tabs, Window } from "../../ui/index.ts";
import { BackfillModal } from "./BackfillModal.tsx";
import { BotTab } from "./BotTab.tsx";
import { ChannelsTab } from "./ChannelsTab.tsx";
import { ClubsEventsTab } from "./ClubsEventsTab.tsx";
import { DataTab } from "./DataTab.tsx";
import { DriftTab } from "./DriftTab.tsx";
import { EconomyTab } from "./EconomyTab.tsx";
import { PERIODS, type PeriodKey } from "./format.ts";
import { ModerationTab } from "./ModerationTab.tsx";
import { NewcomersTab } from "./NewcomersTab.tsx";
import { RelationsTab } from "./RelationsTab.tsx";
import { StatusStrip } from "./StatusStrip.tsx";
import { useOpsStatus } from "./useOpsStatus.ts";

/** A tab of the diagnostics page. */
export type DiagnosticsTab =
  | "moderation"
  | "newcomers"
  | "drift"
  | "channels"
  | "economy"
  | "clubs"
  | "bot"
  | "relations"
  | "data";

/** The tabs in order, with their lowercase labels. */
export const DIAGNOSTICS_TABS: { value: DiagnosticsTab; label: string }[] = [
  { value: "moderation", label: "moderation" },
  { value: "newcomers", label: "newcomers" },
  { value: "drift", label: "drift" },
  { value: "channels", label: "channels" },
  { value: "economy", label: "economy" },
  { value: "clubs", label: "clubs and events" },
  { value: "bot", label: "bot" },
  { value: "relations", label: "relations" },
  { value: "data", label: "data" },
];

/** Renders one tab's windows. */
function TabBody({ tab, period, data }: { tab: DiagnosticsTab; period: PeriodKey; data: ReactNode }): ReactNode {
  switch (tab) {
    case "moderation":
      return <ModerationTab period={period} />;
    case "newcomers":
      return <NewcomersTab period={period} />;
    case "drift":
      return <DriftTab period={period} />;
    case "channels":
      return <ChannelsTab period={period} />;
    case "economy":
      return <EconomyTab period={period} />;
    case "clubs":
      return <ClubsEventsTab period={period} />;
    case "bot":
      return <BotTab period={period} />;
    case "relations":
      return <RelationsTab period={period} />;
    case "data":
      return data;
  }
}

/**
 * The page. It owns the status polling (shared by the strip and the data tab, so the two never poll
 * twice) and the backfill modal (so the poll runs every 2 seconds while the modal is open).
 */
export function DiagnosticsPage() {
  const [tab, setTab] = useState<DiagnosticsTab>("moderation");
  const [period, setPeriod] = useState<PeriodKey>("30d");
  const [backfillOpen, setBackfillOpen] = useState(false);
  const ops = useOpsStatus(backfillOpen);

  return (
    <div className="flex flex-col gap-6">
      <StatusStrip ops={ops} />
      {/* The tab words hang 1ch left of the row (`margin: 0 -1ch`), so the row pads 1ch to line up with the windows. */}
      <Tabs items={DIAGNOSTICS_TABS} value={tab} onChange={setTab} ariaLabel="diagnostics sections" idPrefix="diag" className="pl-[1ch]" />
      {tab !== "data" && (
        <Window label="fish: ~/diagnostics/period">
          <div className="flex flex-wrap items-center gap-3 px-2 py-1">
            <span className="text-subtle">counted over</span>
            <Select options={PERIODS} value={period} onChange={setPeriod} ariaLabel="period" />
          </div>
        </Window>
      )}
      <div role="tabpanel" id={`diag-panel-${tab}`} aria-labelledby={`diag-tab-${tab}`} className="flex flex-col gap-9 desk:gap-12">
        <TabBody tab={tab} period={period} data={<DataTab ops={ops} onOpenBackfill={() => setBackfillOpen(true)} />} />
      </div>
      {backfillOpen && <BackfillModal ops={ops} onClose={() => setBackfillOpen(false)} />}
    </div>
  );
}
