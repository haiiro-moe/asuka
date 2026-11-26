/**
 * The relations tab: the strongest pairs of members as a ranked table (replies, mentions or time in
 * voice together) and the member inspect panel. Voice pairs stay hidden until two whole months of voice
 * are logged; the tab then says when they unlock instead of showing an empty table.
 *
 * @module
 */
import { useState } from "react";
import type { RelationKind, RelationPair } from "../../../../plugins/activity/types/admin.ts";
import { UserName } from "../../names.tsx";
import { Heading, InkButton, Loading, Segmented, Window } from "../../ui/index.ts";
import { useActivity } from "../useActivity.ts";
import { formatCount, formatVoiceHours, voiceUnlockLine, type PeriodKey, type VoiceStatus } from "./format.ts";
import { InspectPanel } from "./InspectPanel.tsx";
import { DataTable, Quiet, ViewState } from "./parts.tsx";

const KINDS: { value: RelationKind; label: string }[] = [
  { value: "replies", label: "replies" },
  { value: "mentions", label: "mentions" },
  { value: "voice", label: "voice" },
];

/** What the weight column counts, per kind. */
const WEIGHT_HEAD: Record<RelationKind, string> = { replies: "replies", mentions: "mentions", voice: "together" };

/** How many pairs the table shows. */
const TOP_PAIRS = 25;

/** A member's name as a quiet row action that opens them in the inspect panel. */
function PickName({ id, onPick }: { id: string; onPick: (id: string) => void }) {
  return (
    <InkButton tone="flat" onClick={() => onPick(id)} title="inspect this member">
      <UserName id={id} />
    </InkButton>
  );
}

/** The ranked pair table of one kind; mounted only when the kind may be shown. */
function PairTable({ kind, period, onPick }: { kind: RelationKind; period: PeriodKey; onPick: (id: string) => void }) {
  const state = useActivity<RelationPair[]>(`/api/activity/admin/relations?period=${period}&kind=${kind}`);
  return (
    <ViewState state={state} what="the pairs" empty="No pairs in this period. Nobody talked to anybody.">
      {(rows) => (
        <DataTable
          head={
            <>
              <th className="r">#</th>
              <th>member</th>
              <th>member</th>
              <th className="r">{WEIGHT_HEAD[kind]}</th>
            </>
          }
        >
          {rows.slice(0, TOP_PAIRS).map((p, i) => (
            <tr key={`${p.a}-${p.b}`}>
              <td className="r">{i + 1}</td>
              <td>
                <PickName id={p.a} onPick={onPick} />
              </td>
              <td>
                <PickName id={p.b} onPick={onPick} />
              </td>
              <td className="r">{kind === "voice" ? formatVoiceHours(p.weight) : formatCount(p.weight)}</td>
            </tr>
          ))}
        </DataTable>
      )}
    </ViewState>
  );
}

/** The voice pairs: the unlock date while voice is withheld, the table once it is ready. */
function VoicePairs({ period, onPick }: { period: PeriodKey; onPick: (id: string) => void }) {
  const voice = useActivity<VoiceStatus>("/api/activity/user/voice-status");
  if (voice.loading && !voice.data) return <Loading className="px-2">Checking the voice log</Loading>;
  if (!voice.data) return <Quiet>The voice log could not be checked: {voice.error ?? "no answer"}.</Quiet>;
  if (!voice.data.ready) return <p className="nar px-2">{voiceUnlockLine(voice.data)}</p>;
  return <PairTable kind="voice" period={period} onPick={onPick} />;
}

/**
 * The relations tab.
 *
 * @param props - `period`: the `?period=` value.
 */
export function RelationsTab({ period }: { period: PeriodKey }) {
  const [kind, setKind] = useState<RelationKind>("replies");
  const [inspect, setInspect] = useState<string | null>(null);
  return (
    <>
      <Window label="fish: ~/diagnostics/relations">
        <Heading first>strongest pairs</Heading>
        <Quiet>Both directions count as one pair. Pick a name to inspect that member.</Quiet>
        <div className="px-2 pb-2">
          <Segmented options={KINDS} value={kind} onChange={setKind} ariaLabel="what a tie counts" />
        </div>
        {kind === "voice" ? (
          <VoicePairs period={period} onPick={setInspect} />
        ) : (
          <PairTable key={kind} kind={kind} period={period} onPick={setInspect} />
        )}
      </Window>
      <InspectPanel period={period} userId={inspect} onInspect={setInspect} />
    </>
  );
}
