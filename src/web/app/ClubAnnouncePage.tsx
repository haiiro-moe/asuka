import { useEffect, useState, type ReactNode } from "react";
import { ComponentsEditor } from "./ComponentsEditor.tsx";
import { DiscordMarkdown } from "./DiscordMarkdown.tsx";
import { card, btn } from "./ui.ts";

interface AnnounceInfo {
  clubName: string;
  clubDescription: string;
  accent: number;
  memberCount: number;
  expiresInSec: number;
}

type LoadState = AnnounceInfo | "loading" | "error" | "expired";

function Centered({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen flex items-center justify-center p-6">
      <div className={card + " font-bold tilt"}>{children}</div>
    </div>
  );
}

/**
 * Standalone announce composer, reached via a one-time /club-announce/:token
 * link. Not part of the cookie-session dashboard — auth is the token itself.
 */
export function ClubAnnouncePage({ token }: { token: string }) {
  const [info, setInfo] = useState<LoadState>("loading");
  const [components, setComponents] = useState<unknown[]>([
    { type: 17, accent_color: 0xeb459e, components: [{ type: 10, content: "" }] },
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

  if (info === "loading") return <Centered>Loading…</Centered>;
  if (info === "expired") return <Centered>This link has expired or was already used.</Centered>;
  if (info === "error") return <Centered>Link not found.</Centered>;
  if (state === "sent") return <Centered>Announcement sent to {info.clubName} ✓</Centered>;

  return (
    <div className="min-h-screen max-w-4xl mx-auto p-4 sm:p-6 space-y-4">
      <div>
        <h1 className="comic-title text-3xl sm:text-4xl tilt inline-block">Announce to {info.clubName}</h1>
        <p className="on-bg text-sm">
          {info.memberCount} members · link expires in ~{Math.max(1, Math.ceil(info.expiresInSec / 60))} min
        </p>
      </div>

      <div className={card + " space-y-4"}>
        <div>
          <div className="text-sm text-ink-soft font-bold mb-1">
            Auto-added to DMs only (not editable, not sent to the club channel):
          </div>
          <div className="rounded-md bg-[#313338] text-slate-200 p-3 inline-block">
            <DiscordMarkdown content={`-# 📢 Announcement from ${info.clubName}`} />
          </div>
        </div>

        <ComponentsEditor value={components} onChange={setComponents} />
      </div>

      <div className="flex items-center gap-3">
        <button className={btn} disabled={state === "sending"} onClick={send}>
          {state === "sending" ? "Sending…" : "Send"}
        </button>
        {state === "senderror" && (
          <span className="text-red-700 font-bold text-sm">
            Failed to send — the link may have expired or already been used.
          </span>
        )}
      </div>
    </div>
  );
}
