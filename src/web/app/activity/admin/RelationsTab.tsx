/**
 * The relations tab: the strongest pairs of members (replies, mentions or time in voice together) as
 * a node-link graph or a ranked table, and the member inspect panel. A `graph | table` switch picks
 * the view; it opens on the graph from three pairs up and remembers nothing. Voice pairs stay hidden
 * until two whole months of voice are logged; the tab then says when they unlock instead of showing
 * an empty table or graph.
 *
 * @module
 */
import { useState } from "react";
import type { RelationKind, RelationPair } from "../../../../plugins/activity/types/admin.ts";
import { UserName } from "../../names.tsx";
import { Heading, InkButton, Loading, Segmented, Window } from "../../ui/index.ts";
import { useActivity } from "../useActivity.ts";
import { formatCount, formatVoiceHours, voiceUnlockLine, type PeriodKey, type VoiceStatus } from "./format.ts";
import { drawableCount } from "./graph/layout.ts";
import { RelationsGraph } from "./graph/RelationsGraph.tsx";
import { defaultView, type RelationsView } from "./graph/view.ts";
import { InspectPanel } from "./InspectPanel.tsx";
import { DataTable, Quiet, ViewState } from "./parts.tsx";

const KINDS: { value: RelationKind; label: string }[] = [
  { value: "replies", label: "replies" },
  { value: "mentions", label: "mentions" },
  { value: "voice", label: "voice" },
];

const VIEWS: { value: RelationsView; label: string }[] = [
  { value: "graph", label: "graph" },
  { value: "table", label: "table" },
];

/** What the weight column counts, per kind. */
const WEIGHT_HEAD: Record<RelationKind, string> = { replies: "replies", mentions: "mentions", voice: "together" };

/** What a tie counts, in the graph's words, per kind. */
const TIE_WORD: Record<RelationKind, string> = { replies: "replies", mentions: "mentions", voice: "voice time" };

/** How many pairs the table shows. */
const TOP_PAIRS = 25;

/**
 * Writes a pair weight for people: a count, or hours for voice (the weight is seconds).
 *
 * @param kind - The relation kind.
 * @param weight - The raw weight.
 */
export function formatPairWeight(kind: RelationKind, weight: number): string {
  return kind === "voice" ? formatVoiceHours(weight) : formatCount(weight);
}

/** A member's name as a quiet row action that opens them in the inspect panel. */
function PickName({ id, onPick }: { id: string; onPick: (id: string) => void }) {
  return (
    <InkButton tone="flat" onClick={() => onPick(id)} title="inspect this member">
      <UserName id={id} />
    </InkButton>
  );
}

/** The ranked pair table: the text alternative of the graph. */
function PairTable({ kind, rows, onPick }: { kind: RelationKind; rows: RelationPair[]; onPick: (id: string) => void }) {
  return (
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
          <td className="r">{formatPairWeight(kind, p.weight)}</td>
        </tr>
      ))}
    </DataTable>
  );
}

/** Props of {@link RelationsBody}. */
export interface RelationsBodyProps {
  /** The relation shown. */
  kind: RelationKind;
  /** The pairs of that kind and period (non-empty). */
  rows: RelationPair[];
  /** The view the admin picked, or null for {@link defaultView}. */
  view: RelationsView | null;
  /** The admin picks a view. */
  onView: (view: RelationsView) => void;
  /** The selected member in the graph. */
  selected: string | null;
  /** Graph selection changes. */
  onSelect: (id: string | null) => void;
  /** Opens a member in the inspect panel. */
  onPick: (id: string) => void;
  /** The voice log's state; while it is not ready, a voice kind renders only the unlock line. */
  voice?: VoiceStatus | null;
}

/**
 * The pairs once they are read: the `graph | table` switch and the chosen view. A locked voice kind
 * renders the unlock line and nothing else (no graph, no table, never zeros).
 *
 * @param props - See {@link RelationsBodyProps}.
 */
export function RelationsBody({ kind, rows, view, onView, selected, onSelect, onPick, voice }: RelationsBodyProps) {
  if (kind === "voice" && (!voice || !voice.ready)) {
    return voice ? <p className="nar px-2">{voiceUnlockLine(voice)}</p> : null;
  }
  const drawable = drawableCount(rows);
  // nothing drawable (zero weights, self-pairs): the table only, never an empty stage
  const shown: RelationsView = drawable === 0 ? "table" : (view ?? defaultView(drawable));
  const table = <PairTable kind={kind} rows={rows} onPick={onPick} />;
  return (
    <>
      <div className="px-2 pb-2">
        <Segmented
          options={VIEWS.map((o) => ({ ...o, disabled: o.value === "graph" && drawable === 0 }))}
          value={shown}
          onChange={onView}
          ariaLabel="how to show the pairs"
        />
      </div>
      {shown === "graph" ? (
        <RelationsGraph
          pairs={rows}
          word={TIE_WORD[kind]}
          formatWeight={(w) => formatPairWeight(kind, w)}
          selected={selected}
          onSelect={onSelect}
          onInspect={onPick}
          narrow={table}
        />
      ) : (
        table
      )}
    </>
  );
}

/** The pairs of one kind, fetched; mounted only when the kind may be shown. */
function Pairs(props: Omit<RelationsBodyProps, "rows"> & { period: PeriodKey }) {
  const { kind, period } = props;
  const state = useActivity<RelationPair[]>(`/api/activity/admin/relations?period=${period}&kind=${kind}`);
  return (
    <ViewState state={state} what="the pairs" empty="No pairs in this period. Nobody talked to anybody.">
      {(rows) => <RelationsBody {...props} rows={rows} />}
    </ViewState>
  );
}

/** The voice pairs: the unlock date while voice is withheld, the pairs once it is ready. */
function VoicePairs(props: Omit<RelationsBodyProps, "rows" | "kind" | "voice"> & { period: PeriodKey }) {
  const voice = useActivity<VoiceStatus>("/api/activity/user/voice-status");
  if (voice.loading && !voice.data) return <Loading className="px-2">Checking the voice log</Loading>;
  if (!voice.data) return <Quiet>The voice log could not be checked: {voice.error ?? "no answer"}.</Quiet>;
  if (!voice.data.ready) return <p className="nar px-2">{voiceUnlockLine(voice.data)}</p>;
  return <Pairs {...props} kind="voice" voice={voice.data} />;
}

/**
 * The relations tab.
 *
 * @param props - `period`: the `?period=` value.
 */
export function RelationsTab({ period }: { period: PeriodKey }) {
  const [kind, setKind] = useState<RelationKind>("replies");
  const [inspect, setInspect] = useState<string | null>(null);
  const [view, setView] = useState<RelationsView | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const shared = { view, onView: setView, selected, onSelect: setSelected, onPick: setInspect, period };
  return (
    <>
      <Window label="fish: ~/diagnostics/relations">
        <Heading first>strongest pairs</Heading>
        <Quiet>Both directions count as one pair. Pick a member to see their ties, or inspect them below.</Quiet>
        <div className="px-2 pb-2">
          <Segmented options={KINDS} value={kind} onChange={setKind} ariaLabel="what a tie counts" />
        </div>
        {kind === "voice" ? <VoicePairs {...shared} /> : <Pairs key={kind} kind={kind} {...shared} />}
      </Window>
      <InspectPanel period={period} userId={inspect} onInspect={setInspect} />
    </>
  );
}
