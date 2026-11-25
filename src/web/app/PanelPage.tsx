import { useEffect, useState, type ReactNode } from "react";
import { ComponentsEditor } from "./ComponentsEditor.tsx";
import { card, btn, input } from "./ui.ts";

interface PanelInfo {
  panel: "theme" | "autoreply" | "botmessage";
  itemName: string;
  data: {
    template?: string;
    // botmessage panels
    key?: string;
    label?: string;
    description?: string;
    params?: { name: string; description: string }[];
    components?: unknown[];
  };
}

type LoadState = PanelInfo | "loading" | "error" | "expired";

function Centered({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen flex items-center justify-center p-6">
      <div className={card + " font-bold tilt"}>{children}</div>
    </div>
  );
}

/**
 * Landing page behind a store-bought magic link (/panel/:token). The page can
 * be opened and revisited freely; the link only expires when the editor's
 * single submission goes through.
 */
export function PanelPage({ token }: { token: string }) {
  const [info, setInfo] = useState<LoadState>("loading");
  const [state, setState] = useState<"idle" | "sending" | "sent" | "senderror">("idle");
  const [error, setError] = useState<string | null>(null);
  const [applied, setApplied] = useState<string[]>([]);

  // Theme fields
  const [themeName, setThemeName] = useState("");
  const [iconUrl, setIconUrl] = useState("");

  // Auto-reply fields
  const [arName, setArName] = useState("");
  const [trigger, setTrigger] = useState("");
  const [matchType, setMatchType] = useState("contains");
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [components, setComponents] = useState<unknown[]>([
    { type: 17, accent_color: 0x5865f2, components: [{ type: 10, content: "Hello!" }] },
  ]);

  // Bot-message editor state (seeded from the message's current payload).
  const [messageComponents, setMessageComponents] = useState<unknown[] | null>(null);

  useEffect(() => {
    fetch(`/api/panel/${token}`)
      .then(async (res) => {
        if (res.status === 410) return setInfo("expired");
        if (!res.ok) return setInfo("error");
        setInfo(await res.json());
      })
      .catch(() => setInfo("error"));
  }, [token]);

  const submit = async (body: Record<string, unknown>) => {
    setState("sending");
    setError(null);
    const res = await fetch(`/api/panel/${token}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }).catch(() => null);
    if (res?.ok) {
      const data = await res.json().catch(() => ({}));
      setApplied(data.applied ?? []);
      setState("sent");
    } else {
      const data = await res?.json().catch(() => ({}));
      setError((data as any)?.error ?? "Something went wrong.");
      setState("senderror");
    }
  };

  if (info === "loading") return <Centered>Loading…</Centered>;
  if (info === "expired")
    return <Centered>This magic link has already been used. Each link allows one submission.</Centered>;
  if (info === "error") return <Centered>Link not found.</Centered>;
  if (state === "sent") {
    return (
      <Centered>
        <div className="space-y-1">
          <div>Done ✓</div>
          {applied.map((a) => (
            <div key={a} className="text-ink-soft text-sm">{a}</div>
          ))}
        </div>
      </Centered>
    );
  }

  const preview = (info.data.template ?? "%s").replace("%s", themeName || "…");

  return (
    <div className="min-h-screen max-w-4xl mx-auto p-4 sm:p-6 space-y-4">
      <div>
        <h1 className="comic-title text-3xl sm:text-4xl tilt inline-block">
          {info.panel === "theme"
            ? "🎨 Server Theme"
            : info.panel === "botmessage"
              ? `✏️ Edit “${info.data.label}”`
              : "💬 Create an Auto-Reply"}
        </h1>
        <p className="on-bg text-sm">
          Unlocked by your purchase of “{info.itemName}”. You can come back to this page, but
          you only get one submission — the link expires once you apply.
        </p>
      </div>

      {info.panel === "botmessage" ? (
        <div className={card + " space-y-4"}>
          <div className="text-sm text-ink-soft font-bold">{info.data.description}</div>
          {(info.data.params ?? []).length > 0 && (
            <div className="text-xs">
              <span className="text-ink-soft font-bold">Placeholders kept working: </span>
              {(info.data.params ?? []).map((p) => (
                <code key={p.name} className="mr-2" title={p.description}>
                  {"{" + p.name + "}"}
                </code>
              ))}
            </div>
          )}
          <ComponentsEditor
            value={messageComponents ?? info.data.components ?? []}
            onChange={setMessageComponents}
          />
          <button
            className={btn}
            disabled={state === "sending"}
            onClick={() =>
              submit({ components: messageComponents ?? info.data.components ?? [] })
            }
          >
            {state === "sending" ? "Applying…" : "Rewrite the message"}
          </button>
        </div>
      ) : info.panel === "theme" ? (
        <div className={card + " space-y-3"}>
          <label className="text-sm space-y-1 block">
            <span className="text-ink-soft">
              Custom server name (fills the <code>%s</code> slot)
            </span>
            <input
              className={input}
              value={themeName}
              onChange={(e) => setThemeName(e.target.value)}
              placeholder="e.g. Spring Festival"
            />
          </label>
          <div className="text-xs text-ink-soft">
            Preview: <code>{preview}</code>
          </div>
          <label className="text-sm space-y-1 block">
            <span className="text-ink-soft">Server icon URL (optional)</span>
            <input
              className={input}
              value={iconUrl}
              onChange={(e) => setIconUrl(e.target.value)}
              placeholder="https://…/icon.png"
            />
          </label>
          <button
            className={btn}
            disabled={state === "sending" || (!themeName && !iconUrl)}
            onClick={() => submit({ name: themeName || undefined, iconUrl: iconUrl || undefined })}
          >
            {state === "sending" ? "Applying…" : "Apply theme"}
          </button>
        </div>
      ) : (
        <div className={card + " space-y-4"}>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <label className="text-sm space-y-1">
              <span className="text-ink-soft">Name</span>
              <input className={input} value={arName} onChange={(e) => setArName(e.target.value)} />
            </label>
            <label className="text-sm space-y-1">
              <span className="text-ink-soft">Trigger</span>
              <input className={input} value={trigger} onChange={(e) => setTrigger(e.target.value)} />
            </label>
            <label className="text-sm space-y-1">
              <span className="text-ink-soft">Match type</span>
              <select className={input} value={matchType} onChange={(e) => setMatchType(e.target.value)}>
                <option value="contains">contains</option>
                <option value="exact">exact</option>
                <option value="regex">regex</option>
              </select>
            </label>
            <label className="text-sm flex items-center gap-2 mt-5">
              <input
                type="checkbox"
                checked={caseSensitive}
                onChange={(e) => setCaseSensitive(e.target.checked)}
              />
              <span className="text-ink-soft">Case sensitive</span>
            </label>
          </div>

          <div>
            <div className="text-ink font-bold mb-2">Reply (Components V2)</div>
            <ComponentsEditor value={components} onChange={setComponents} />
          </div>

          <button
            className={btn}
            disabled={state === "sending" || !arName || !trigger}
            onClick={() =>
              submit({
                name: arName,
                trigger,
                matchType,
                caseSensitive,
                responseComponents: components,
              })
            }
          >
            {state === "sending" ? "Creating…" : "Create auto-reply"}
          </button>
        </div>
      )}

      {state === "senderror" && <div className="text-red-700 font-bold text-sm">{error}</div>}
    </div>
  );
}
