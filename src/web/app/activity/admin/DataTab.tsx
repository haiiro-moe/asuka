/**
 * The data tab: the history backfill (a window with a `backfill` button that opens the modal), the
 * Wrapped overview, its three manual steps, the sign-ups and, last and apart, the private preview.
 *
 * @module
 */
import { InkButton, Window } from "../../ui/index.ts";
import { AnnounceStep } from "./AnnounceStep.tsx";
import { STATUS_GLYPH, STATUS_INK } from "./parts.tsx";
import { PreviewSection } from "./PreviewSection.tsx";
import { ProcessStep } from "./ProcessStep.tsx";
import { SendStep } from "./SendStep.tsx";
import { SignupsWindow } from "./SignupsWindow.tsx";
import { backfillStatusLine } from "./status.ts";
import type { OpsStatus } from "./useOpsStatus.ts";
import { WrappedOverview } from "./WrappedOverview.tsx";

/** Props of {@link DataTab}. */
export interface DataTabProps {
  /** The page's polled statuses (shared with the status strip). */
  ops: OpsStatus;
  /** Opens the backfill modal (the page owns it, so the strip polls fast while it is open). */
  onOpenBackfill: () => void;
}

/** The backfill window: one line of state and the button that opens the modal. */
function BackfillWindow({ ops, onOpenBackfill }: DataTabProps) {
  const line = ops.backfill ? backfillStatusLine(ops.backfill) : null;
  return (
    <Window label="fish: ~/activity/backfill">
      <p className="nar px-2">You read old messages into the log, so the charts reach back before the bot started counting.</p>
      {line && (
        <p className="px-2">
          <span className={STATUS_INK[line.ink]}>
            <span aria-hidden="true">{STATUS_GLYPH[line.ink]}</span> {line.text}
          </span>
        </p>
      )}
      <div className="btns">
        <InkButton tone="gold" onClick={onOpenBackfill}>
          backfill
        </InkButton>
      </div>
    </Window>
  );
}

/**
 * The data tab.
 *
 * @param props - See {@link DataTabProps}.
 */
export function DataTab({ ops, onOpenBackfill }: DataTabProps) {
  return (
    <>
      <BackfillWindow ops={ops} onOpenBackfill={onOpenBackfill} />
      <WrappedOverview ops={ops} />
      <ProcessStep ops={ops} />
      <SendStep ops={ops} />
      <AnnounceStep ops={ops} />
      <SignupsWindow />
      <PreviewSection ops={ops} />
    </>
  );
}
