/**
 * The Wrapped sign-ups window of the data tab: the sign-up message's state, `post sign-up message` with
 * a `with opt in / opt out buttons` chip, and `close sign-ups` or `reopen sign-ups`.
 *
 * @module
 */
import { useState } from "react";
import type { WrappedSignupState } from "../../../../plugins/activity/types/wrapped.ts";
import { Chip, ErrorLine, InkButton, Window, useConfirm } from "../../ui/index.ts";
import { useActivity } from "../useActivity.ts";
import { formatCount } from "./format.ts";
import { call } from "./http.ts";
import { Quiet, Sheet, ViewState } from "./parts.tsx";

/** The sign-up state in words. */
function StateSheet({ s }: { s: WrappedSignupState }) {
  return (
    <Sheet
      rows={[
        ["year", String(s.year)],
        ["message", s.posted ? (s.buttons ? "posted, with buttons" : "posted, without buttons") : "not posted"],
        ["sign-ups", s.closed ? <span className="c2">closed</span> : <span className="c6">open</span>],
        ["opted in", `${formatCount(s.optedIn)} members`],
      ]}
    />
  );
}

/**
 * The sign-ups window. Nothing is posted until the button is pressed; posting again for a year that has a
 * message asks first.
 */
export function SignupsWindow() {
  const state = useActivity<WrappedSignupState>("/api/activity/wrapped/signup");
  const [buttons, setButtons] = useState(true);
  const [busy, setBusy] = useState<"post" | "close" | "reopen" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [fresh, setFresh] = useState<WrappedSignupState | null>(null);
  const { confirm, dialog } = useConfirm();
  const s = fresh ?? state.data;

  const act = async (what: "post" | "close" | "reopen") => {
    if (what === "post" && s?.posted) {
      const ok = await confirm({
        message: `A sign-up message for ${s.year} is up already. Post a new one? The new message takes over the sign-ups.`,
        confirmLabel: "post",
      });
      if (!ok) return;
    }
    setBusy(what);
    setError(null);
    const res =
      what === "post"
        ? await call<WrappedSignupState>("POST", "/api/activity/wrapped/signup-message", { year: s?.year, buttons })
        : await call<WrappedSignupState>("POST", `/api/activity/wrapped/signup/${what}`);
    setBusy(null);
    if (res.ok && res.body) setFresh(res.body);
    else setError(res.error ?? "no answer");
  };

  return (
    <Window label="sh: ~/wrapped/sign-ups">
      {dialog}
      <p className="nar px-2">You ask the server who wants their Wrapped by DM. Only those who opt in get one.</p>
      <ViewState state={{ ...state, data: s }} what="the sign-ups" isEmpty={() => false} empty={null}>
        {(d) => (
          <>
            <StateSheet s={d} />
            <div className="flex flex-wrap gap-2 px-2 py-1">
              <Chip on={buttons} onToggle={setButtons} disabled={busy != null}>
                with opt in / opt out buttons
              </Chip>
            </div>
            <Quiet>Without buttons the message only informs; members opt in with /wrapped optin.</Quiet>
            {error && <ErrorLine className="px-2">That did not work: {error}.</ErrorLine>}
            <div className="btns">
              <InkButton tone="gold" onClick={() => act("post")} busy={busy === "post"} busyLabel="posting">
                post sign-up message
              </InkButton>
              {d.closed ? (
                <InkButton tone="pine" onClick={() => act("reopen")} busy={busy === "reopen"} busyLabel="reopening">
                  reopen sign-ups
                </InkButton>
              ) : (
                <InkButton tone="love" onClick={() => act("close")} busy={busy === "close"} busyLabel="closing">
                  close sign-ups
                </InkButton>
              )}
            </div>
            {d.closed && <Quiet>While closed, the buttons are disabled and opting in or out changes nothing.</Quiet>}
          </>
        )}
      </ViewState>
    </Window>
  );
}
