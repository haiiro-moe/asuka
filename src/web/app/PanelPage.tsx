/**
 * The landing page behind a store-bought magic link (`/panel/:token`): one window with the editor the
 * purchase unlocked, on the blob backdrop of the standalone shell. Not part of the cookie session; the
 * token is the authorisation.
 *
 * @module
 */
import { useEffect, useState, type ReactNode } from "react";
import { ComponentsEditor } from "./ComponentsEditor.tsx";
import {
  ErrorLine,
  Heading,
  InkButton,
  Loading,
  PageHead,
  PromptField,
  Select,
  SettingRow,
  Toggle,
  Window,
} from "./ui/index.ts";

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

const MATCH_OPTIONS = [
  { value: "contains", label: "contains" },
  { value: "exact", label: "exact" },
  { value: "regex", label: "regex" },
];

/** A page that only says one thing: the head, then one window with a narrator line in it. */
function Notice({ title, tone, children }: { title: string; tone: "love" | "foam"; children: ReactNode }) {
  return (
    <>
      <PageHead title={title} cmd="vim" args="~/panel" />
      <Window label="fish: ~/panel" tone={tone}>
        {children}
      </Window>
    </>
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
  // Container accent 0x31748f: the haiiro default accent (pine, D-020) as the starting colour of a new reply.
  const [components, setComponents] = useState<unknown[]>([
    { type: 17, accent_color: 0x31748f, components: [{ type: 10, content: "Hello." }] },
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

  if (info === "loading") return <Loading>You turn the key in the lock</Loading>;
  if (info === "expired")
    return (
      <Notice title="used up" tone="love">
        <ErrorLine>This magic link has already been used. Each link allows one submission.</ErrorLine>
      </Notice>
    );
  if (info === "error")
    return (
      <Notice title="not found" tone="love">
        <ErrorLine>Link not found. You check the address and try again.</ErrorLine>
      </Notice>
    );
  if (state === "sent") {
    return (
      <Notice title="done" tone="foam">
        <p className="nar" role="status">
          <span className="c6">✓</span> It is done. The link is spent.
        </p>
        {applied.map((a) => (
          <p key={a} className="mt-2 text-subtle">
            <span className="c6">✓</span> {a}
          </p>
        ))}
      </Notice>
    );
  }

  const preview = (info.data.template ?? "%s").replace("%s", themeName || "…");
  const sending = state === "sending";

  const title = info.panel === "theme" ? "server theme" : info.panel === "botmessage" ? "edit message" : "auto-reply";
  const lede =
    `Your purchase of "${info.itemName}" unlocked this page. You may come back to it, but you get one ` +
    `submission, and the link expires once you apply.`;

  return (
    <>
      <PageHead title={title} cmd="vim" args={`~/panel/${info.panel}`} lede={lede} />

      {info.panel === "botmessage" ? (
        <Window label={`fish: ~/panel/message${info.data.label ? ` (${info.data.label})` : ""}`}>
          <p className="text-subtle">{info.data.description}</p>
          {(info.data.params ?? []).length > 0 && (
            <p className="mt-3">
              <span className="kv_label">placeholders kept working</span>{" "}
              {(info.data.params ?? []).map((p) => (
                <span key={p.name} className="c7 mr-2" title={p.description}>
                  {"{" + p.name + "}"}
                </span>
              ))}
            </p>
          )}
          <div className="mt-3">
            <ComponentsEditor
              value={messageComponents ?? info.data.components ?? []}
              onChange={setMessageComponents}
            />
          </div>
          {state === "senderror" && <ErrorLine>{error}</ErrorLine>}
          <div className="btns">
            <InkButton
              tone="gold"
              busy={sending}
              busyLabel="applying"
              onClick={() => submit({ components: messageComponents ?? info.data.components ?? [] })}
            >
              rewrite the message
            </InkButton>
          </div>
        </Window>
      ) : info.panel === "theme" ? (
        <Window label="fish: ~/panel/theme" contentClassName="[&_.pr]:shrink-0">
          <PromptField
            label="server name"
            promptWidth={24}
            hint={
              <>
                Fills the <span className="c7">%s</span> slot.
              </>
            }
            value={themeName}
            onChange={setThemeName}
            placeholder="Spring Festival"
          />
          <p className="nar px-2 pb-2">
            Preview: <span className="c6">{preview}</span>
          </p>
          <PromptField
            label="icon url"
            promptWidth={24}
            hint="optional"
            value={iconUrl}
            onChange={setIconUrl}
            placeholder="https://…/icon.png"
          />
          {state === "senderror" && <ErrorLine>{error}</ErrorLine>}
          <div className="btns">
            <InkButton
              tone="gold"
              busy={sending}
              busyLabel="applying"
              disabled={!themeName && !iconUrl}
              onClick={() => submit({ name: themeName || undefined, iconUrl: iconUrl || undefined })}
            >
              apply theme
            </InkButton>
          </div>
        </Window>
      ) : (
        <Window label="fish: ~/panel/autoreply" contentClassName="[&_.pr]:shrink-0">
          <PromptField label="name" promptWidth={24} value={arName} onChange={setArName} />
          <PromptField label="trigger" promptWidth={24} value={trigger} onChange={setTrigger} />
          <SettingRow label="match type" labelId="pnl-match">
            <Select ariaLabelledBy="pnl-match" options={MATCH_OPTIONS} value={matchType} onChange={setMatchType} />
          </SettingRow>
          <Toggle label="case sensitive" checked={caseSensitive} onChange={setCaseSensitive} />

          <Heading>reply</Heading>
          <ComponentsEditor value={components} onChange={setComponents} />

          {state === "senderror" && <ErrorLine>{error}</ErrorLine>}
          <div className="btns">
            <InkButton
              tone="gold"
              busy={sending}
              busyLabel="creating"
              disabled={!arName || !trigger}
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
              create auto-reply
            </InkButton>
          </div>
        </Window>
      )}
    </>
  );
}
