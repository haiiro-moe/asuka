/**
 * Small shared parts of the user-tier activity page: the loading, failed and empty narrator lines
 * around a fetch, and the line that stands in for voice while it is withheld.
 *
 * @module
 */
import type { ReactNode } from "react";
import { Empty, ErrorLine, Loading } from "../../ui/index.ts";
import type { VoiceStatus } from "../../../../plugins/activity/types/user.ts";
import { useActivity } from "../useActivity.ts";
import type { ActivityState } from "../useActivity.ts";
import { voiceLockedLine } from "../format.ts";
import { activityPath } from "./helpers.ts";

/** Props of {@link View}. */
export interface ViewProps<T> {
  /** The result of {@link useActivity}. */
  state: ActivityState<T>;
  /** Says whether an answer holds nothing to show; the empty line replaces the children then. */
  isEmpty?: (data: T) => boolean;
  /** The narrator line for an empty answer. */
  empty?: string;
  /** Renders the answer. */
  children: (data: T) => ReactNode;
}

/**
 * Turns a fetch state into one narrator line (loading, failed with retry, empty) or the rendered answer.
 * Never a spinner graphic.
 *
 * @typeParam T - The shape of the response body.
 * @param props - See {@link ViewProps}.
 */
export function View<T>({ state, isEmpty, empty = "Nothing counted in this period yet.", children }: ViewProps<T>) {
  const { data, error, loading, reload } = state;
  if (error !== null) {
    const text = error === "unauthorized" ? "Your session ended. Sign in again." : `That did not load: ${error}.`;
    return <ErrorLine onRetry={reload}>{text}</ErrorLine>;
  }
  if (loading || data === null) return <Loading />;
  if (isEmpty?.(data)) return <Empty>{empty}</Empty>;
  return <>{children(data)}</>;
}

/** Props of {@link VoiceGate}. */
export interface VoiceGateProps {
  /** The voice parts, shown once voice is unlocked. Without it, an unlocked voice says to reload. */
  children?: ReactNode;
}

/**
 * Holds back the voice parts until two whole months of voice data exist. While locked it shows the
 * narrator line "voice stats unlock on <date>" (UTC) and nothing else, so voice is never drawn as zeros.
 *
 * @param props - See {@link VoiceGateProps}.
 */
export function VoiceGate({ children }: VoiceGateProps) {
  const status = useActivity<VoiceStatus>(activityPath("voice-status"));
  return (
    <View state={status}>
      {(s) =>
        !s.ready ? (
          <Empty>{voiceLockedLine(s.readyAt)}</Empty>
        ) : children ? (
          <>{children}</>
        ) : (
          <Empty>Voice stats are ready now. Reload the page to see them.</Empty>
        )
      }
    </View>
  );
}
