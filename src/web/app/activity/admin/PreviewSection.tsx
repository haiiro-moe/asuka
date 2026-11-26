/**
 * The private Wrapped preview window of the data tab, below the real steps: start a preview (the
 * default sample or up to 10 named members, optionally the whole server for the dry-run counts), its
 * status, its private links and `discard preview`. A preview sends nothing to members and posts nothing
 * to any channel; every message goes to the admin who started it. Nothing here calls the real run's
 * routes (run, send, announce, resend).
 *
 * @module
 */
import { useEffect, useRef, useState } from "react";
import type { PreviewMember, PreviewStartResponse, PreviewStatus, PreviewDiscardResponse } from "../../../../plugins/activity/types/wrapped.ts";
import { UserName } from "../../names.tsx";
import { Badge, Chip, ErrorLine, Heading, InkButton, Loading, PromptField, Window, useConfirm } from "../../ui/index.ts";
import { call } from "./http.ts";
import { LinkActions } from "./LinkActions.tsx";
import { DataTable, ProgressBar, Quiet, STATUS_GLYPH, STATUS_INK } from "./parts.tsx";
import {
  DISCARD_CONFIRM,
  DM_FAILED_LINE,
  PREVIEW_DEFAULT_SAMPLE,
  PREVIEW_MAX_MEMBERS,
  PREVIEW_TTL_DAYS,
  discardGate,
  discardOutcome,
  expiryLine,
  parseMemberList,
  previewLinkUrl,
  previewServerUrl,
  previewStartBody,
  previewStartGate,
  previewStatusLine,
  skippedMembers,
  startOutcome,
  wouldSkipLine,
  type StartOutcome,
} from "./preview.ts";
import { MAX_YEAR, MIN_YEAR, parseYearInput } from "./steps.ts";
import type { OpsStatus } from "./useOpsStatus.ts";

/** The start form: year, member list, the dry-run chip and `start preview`. */
function StartForm({ ops }: { ops: OpsStatus }) {
  const p = ops.preview;
  const realYear = ops.wrapped?.year ?? null;
  const [yearText, setYearText] = useState(String(realYear ?? new Date().getUTCFullYear()));
  const touched = useRef(false);
  const [membersText, setMembersText] = useState("");
  const [all, setAll] = useState(false);
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<StartOutcome | null>(null);

  // follow the real run's year until the admin edits the field
  useEffect(() => {
    if (!touched.current && realYear != null) setYearText(String(realYear));
  }, [realYear]);

  const year = parseYearInput(yearText);
  const list = parseMemberList(membersText);
  const gate = previewStartGate(p, list, year);

  const start = async () => {
    if (year == null || list.error) return;
    setBusy(true);
    setOutcome(null);
    const res = await call<PreviewStartResponse>("POST", "/api/activity/wrapped/preview", previewStartBody(year, list.ids, all));
    setBusy(false);
    if (res.body?.status) ops.setPreview(res.body.status);
    setOutcome(startOutcome(res.body?.result ? res.body : null, res.error));
    ops.refresh();
  };

  return (
    <>
      <PromptField
        label="year"
        value={yearText}
        onChange={(v) => {
          touched.current = true;
          setYearText(v);
        }}
        inputMode="numeric"
        autoComplete="off"
        hint="A UTC calendar year. Defaults to the real run's year."
        error={year == null ? `A whole year from ${MIN_YEAR} to ${MAX_YEAR}.` : null}
      />
      <PromptField
        label="members"
        value={membersText}
        onChange={setMembersText}
        autoComplete="off"
        hint={
          list.ids.length === 0
            ? `Empty: you plus the ${PREVIEW_DEFAULT_SAMPLE} most active members. Or name up to ${PREVIEW_MAX_MEMBERS} member ids.`
            : `${list.ids.length} of ${PREVIEW_MAX_MEMBERS} members. A list replaces the sample, so add your own id to see yours.`
        }
        error={list.error}
      />
      <div className="flex flex-wrap gap-2 px-2 py-1">
        <Chip on={all} onToggle={setAll} disabled={busy}>
          whole server (dry run counts)
        </Chip>
      </div>
      <Quiet>With it, every member's year is built for the counts. You are still DM'd the sample only.</Quiet>
      <Quiet>Starting DMs you, and only you, when the preview is built. It replaces your previous preview.</Quiet>
      {outcome && (outcome.bad ? <ErrorLine className="px-2">{outcome.text}</ErrorLine> : <p className="nar px-2">{outcome.text}</p>)}
      <div className="btns">
        <InkButton tone="gold" onClick={start} disabled={!gate.enabled} busy={busy} busyLabel="starting">
          start preview
        </InkButton>
      </div>
      {gate.reason && <Quiet>{gate.reason}</Quiet>}
    </>
  );
}

/** The preview's state: progress, the DM failure, would-skip, expiry. */
function StatusBlock({ p }: { p: PreviewStatus }) {
  const line = previewStatusLine(p);
  const skipped = skippedMembers(p);
  const skip = wouldSkipLine(p);
  const expiry = expiryLine(p);
  return (
    <>
      <p className="px-2">
        <span className={STATUS_INK[line.ink]}>
          <span aria-hidden="true">{STATUS_GLYPH[line.ink]}</span> {line.text}
        </span>
        {p.all && <span className="text-subtle"> (whole server, dry run counts)</span>}
      </p>
      {p.status === "processing" && <ProgressBar label="members built" done={p.done} total={p.total} />}
      {p.dmFailed && <p className="nar love px-2">{DM_FAILED_LINE}</p>}
      {p.error && !p.dmFailed && <ErrorLine className="px-2">The preview stopped: {p.error}</ErrorLine>}
      {p.status === "interrupted" && <Quiet>It stopped answering, likely a restart. Start a new preview to replace it.</Quiet>}
      {skip && <Quiet>{skip}</Quiet>}
      {skipped.length > 0 && (
        <Quiet>
          Would not be sent:{" "}
          {skipped.map((m, i) => (
            <span key={m.userId}>
              {i > 0 && ", "}
              <UserName id={m.userId} />
            </span>
          ))}
          .
        </Quiet>
      )}
      {expiry && <Quiet>{expiry}</Quiet>}
      <Quiet>A preview and its links expire after {PREVIEW_TTL_DAYS} days.</Quiet>
    </>
  );
}

/** One sampled member's row: name, would-skip mark and the link controls. */
function MemberRow({ m, token }: { m: PreviewMember; token: string | null }) {
  return (
    <tr>
      <td>
        <UserName id={m.userId} />
        {m.wouldSkip && (
          <>
            {" "}
            <Chip>would not be sent</Chip>
          </>
        )}
      </td>
      <td>
        {token ? (
          <LinkActions url={previewLinkUrl(window.location.origin, token)} openLabel="open link" />
        ) : (
          <span className="text-subtle">{m.hasLink ? "link not built yet" : "no activity that year, no link"}</span>
        )}
      </td>
    </tr>
  );
}

/** The preview's links: the private server story and one row per sampled member. */
function LinksBlock({ p }: { p: PreviewStatus }) {
  const tokens = new Map(p.links.map((l) => [l.userId, l.token]));
  return (
    <>
      <Heading as="h3">preview links</Heading>
      <Quiet>Links are reusable until the preview expires or you discard it. Each page carries a preview ribbon.</Quiet>
      {p.serverToken ? (
        <div className="px-2 py-1">
          <span className="c6">server</span> <LinkActions url={previewServerUrl(window.location.origin, p.serverToken)} openLabel="open link" />
        </div>
      ) : (
        <Quiet>The private server story appears once it is built.</Quiet>
      )}
      {p.sampled.length === 0 ? (
        <Quiet>No members in the sample yet.</Quiet>
      ) : (
        <DataTable
          head={
            <>
              <th>member</th>
              <th>link</th>
            </>
          }
        >
          {p.sampled.map((m) => (
            <MemberRow key={m.userId} m={m} token={tokens.get(m.userId) ?? null} />
          ))}
        </DataTable>
      )}
    </>
  );
}

/** `discard preview`, behind a confirm, with its gate and outcome. */
function DiscardRow({ ops, p }: { ops: OpsStatus; p: PreviewStatus }) {
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<StartOutcome | null>(null);
  const { confirm, dialog } = useConfirm();
  const gate = discardGate(p);
  const discard = async () => {
    if (!gate.enabled || !(await confirm({ ...DISCARD_CONFIRM }))) return;
    setBusy(true);
    setOutcome(null);
    const res = await call<PreviewDiscardResponse>("POST", "/api/activity/wrapped/preview/discard");
    setBusy(false);
    setOutcome(discardOutcome(res.body?.result ?? null, res.error));
    ops.refresh();
  };
  return (
    <>
      {dialog}
      {outcome && (outcome.bad ? <ErrorLine className="px-2">{outcome.text}</ErrorLine> : <p className="nar px-2">{outcome.text}</p>)}
      <div className="btns">
        <InkButton tone="love" onClick={discard} disabled={!gate.enabled} busy={busy} busyLabel="discarding">
          discard preview
        </InkButton>
      </div>
      {gate.reason && p.status !== "idle" && <Quiet>{gate.reason}</Quiet>}
    </>
  );
}

/**
 * The preview window.
 *
 * @param props - `ops`: the page's polled statuses (the preview is polled in the same loop as the strip).
 */
export function PreviewSection({ ops }: { ops: OpsStatus }) {
  const p = ops.preview;
  return (
    <Window label="preview: ~/wrapped/private">
      <Heading first>
        private preview <Badge>not the real run</Badge>
      </Heading>
      <Quiet>A preview sends nothing to members. Every message comes to you.</Quiet>
      <p className="nar px-2">
        You build the year for a few members and get, by DM, exactly what they and the announcements channel
        would get. Members and channels hear nothing.
      </p>
      <StartForm ops={ops} />
      <Heading as="h3">your preview</Heading>
      {!p ? (
        ops.previewError ? (
          <ErrorLine className="px-2" onRetry={ops.refresh}>
            Your preview's status did not load: {ops.previewError}.
          </ErrorLine>
        ) : (
          <Loading className="px-2">Reading your preview</Loading>
        )
      ) : p.status === "idle" ? (
        <p className="nar px-2">You have no preview. Start one above.</p>
      ) : (
        <>
          <StatusBlock p={p} />
          <LinksBlock p={p} />
          <DiscardRow ops={ops} p={p} />
        </>
      )}
    </Window>
  );
}
