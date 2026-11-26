/**
 * The standalone club announcement composer, reached from a one-time `/club-announce/:token` link.
 * It is rendered inside {@link StandaloneShell} by `main.tsx` (blob backdrop, brand bar, one column), so it
 * only writes the page itself: a page head, a window with the composer and a window with the send action.
 *
 * @module
 */
import { useEffect, useState, type ReactNode } from "react";
import { ComponentsEditor } from "./ComponentsEditor.tsx";
import { DiscordMarkdown } from "./DiscordMarkdown.tsx";
import { ErrorLine, InkButton, Loading, PageHead, Window } from "./ui/index.ts";

/** What `GET /api/club-announce/:token` returns for a live link. */
interface AnnounceInfo {
  clubName: string;
  clubDescription: string;
  accent: number;
  memberCount: number;
  expiresInSec: number;
}

type LoadState = AnnounceInfo | "loading" | "error" | "expired";

/**
 * The line the bot puts above every announcement in the DMs. It mirrors `announcementHeader` in
 * `announceHeader` in `src/plugins/clubs/service.ts`; keep the two in step.
 */
/** The club accent a new announcement starts with: iris, the same as `Accent.club` on the server. */
const CLUB_ACCENT = 0xc4a7e7;

/** A club name as a lowercase kebab slug for a window label (`Moon Club` becomes `moon-club`). */
const slug = (name: string) =>
  name.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-+|-+$/g, "") || "club";

const autoHeader = (clubName: string) => `-# announcement from ${clubName}`;

/** A page with one window and one line in it, for the loading, expired, missing and sent states. */
function Notice({ tone, label, children }: { tone?: "love" | "foam"; label: string; children: ReactNode }) {
  return (
    <>
      <PageHead title="announce" cmd="vim" args="~/club/announce" />
      <Window label={label} tone={tone}>
        {children}
      </Window>
    </>
  );
}

/**
 * Standalone announce composer, reached via a one-time `/club-announce/:token`
 * link. Not part of the cookie-session dashboard: auth is the token itself.
 *
 * @param props.token - The magic-link token from the URL path.
 */
export function ClubAnnouncePage({ token }: { token: string }) {
  const [info, setInfo] = useState<LoadState>("loading");
  const [components, setComponents] = useState<unknown[]>([
    { type: 17, accent_color: CLUB_ACCENT, components: [{ type: 10, content: "" }] },
  ]);
  const [state, setState] = useState<"idle" | "sending" | "sent" | "senderror">("idle");

  useEffect(() => {
    fetch(`/api/club-announce/${token}`)
      .then(async (res) => {
        if (res.status === 410) return setInfo("expired");
        if (!res.ok) return setInfo("error");
        setInfo(await res.json());
      })
      .catch(() => setInfo("error"));
  }, [token]);

  const send = async () => {
    setState("sending");
    const res = await fetch(`/api/club-announce/${token}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ components }),
    }).catch(() => null);
    setState(res?.ok ? "sent" : "senderror");
  };

  if (info === "loading") {
    return (
      <Notice label="vim: ~/club/announce">
        <Loading>Opening the link</Loading>
      </Notice>
    );
  }
  if (info === "expired") {
    return (
      <Notice tone="love" label="vim: ~/club/announce">
        <ErrorLine>This link has expired or was already used.</ErrorLine>
      </Notice>
    );
  }
  if (info === "error") {
    return (
      <Notice tone="love" label="vim: ~/club/announce">
        <ErrorLine>Link not found.</ErrorLine>
      </Notice>
    );
  }
  if (state === "sent") {
    return (
      <Notice tone="foam" label="vim: ~/club/announce">
        <p className="nar">
          <span className="c6">✓</span> Announcement sent to {info.clubName}. The members will see it in their DMs.
        </p>
      </Notice>
    );
  }

  const minutes = Math.max(1, Math.ceil(info.expiresInSec / 60));
  return (
    <>
      <PageHead
        title="announce"
        cmd="vim"
        args="~/club/announce"
        lede={`You are writing to ${info.clubName}. Whatever you compose goes out to every member in their DMs.`}
        note={<span style={{ color: "var(--color-subtle)" }}>{`${info.memberCount} members · link expires in about ${minutes} min`}</span>}
      />

      <Window label={`vim: ~/club/${slug(info.clubName)}`}>
        <p className="hd first">added by the bot</p>
        <p className="note-s px-2">DMs only. It is not editable and is not sent to the club channel.</p>
        <div className="mx-2 my-2 border border-ink-muted bg-base p-2">
          <DiscordMarkdown content={autoHeader(info.clubName)} />
        </div>
        <p className="hd">message</p>
        <div className="px-2 pb-2">
          <ComponentsEditor value={components} onChange={setComponents} />
        </div>
      </Window>

      <Window label="fish: ~/club/send" tone={state === "senderror" ? "love" : "pine"}>
        {state === "senderror" && (
          <ErrorLine>Failed to send. The link may have expired or already been used.</ErrorLine>
        )}
        <div className="btns">
          <InkButton tone="gold" busy={state === "sending"} busyLabel="sending" onClick={send}>
            send
          </InkButton>
        </div>
      </Window>
    </>
  );
}
