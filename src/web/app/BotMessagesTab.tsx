import { useState } from "react";
import { api } from "./api.ts";
import { ComponentsEditor } from "./ComponentsEditor.tsx";
import { CodeEditor } from "./CodeEditor.tsx";
import { Modal } from "./Modal.tsx";
import { card, btn, btnGhost, input, useAsync } from "./ui.ts";

interface BotMessage {
  key: string;
  label: string;
  description: string;
  category: string;
  params: { name: string; description: string }[];
  components: unknown[];
  overridden: boolean;
  linkedItems: { id: number; name: string; price: number; enabled: boolean }[];
}

function ParamChips({ message, variables }: { message: BotMessage; variables: string[] }) {
  return (
    <div className="text-xs space-y-1">
      <div>
        <span className="text-ink-soft font-bold">Params: </span>
        {message.params.map((p) => (
          <code key={p.name} className="mr-2" title={p.description}>
            {"{" + p.name + "}"}
          </code>
        ))}
        {message.params.length === 0 && <span className="text-ink-soft">none</span>}
      </div>
      <div>
        <span className="text-ink-soft font-bold">Variables: </span>
        {variables.map((v) => (
          <code key={v} className="mr-2">{`{{${v}}}`}</code>
        ))}
        {variables.length === 0 && (
          <span className="text-ink-soft">none defined yet (owner-only, below)</span>
        )}
      </div>
    </div>
  );
}

/** Modal editor for one registered bot message + its store-item link. */
function MessageModal({
  message,
  variables,
  onClose,
  onSaved,
}: {
  message: BotMessage;
  variables: string[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [components, setComponents] = useState<unknown[]>(message.components);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [linkItemId, setLinkItemId] = useState("");
  const [newItemName, setNewItemName] = useState("");
  const [newItemPrice, setNewItemPrice] = useState(500);
  const [linkedItems, setLinkedItems] = useState(message.linkedItems);
  const storeItems = useAsync(() => api.storeItems());

  const run = async (fn: () => Promise<unknown>, close = false) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      onSaved();
      if (close) onClose();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const linkable = (storeItems.data ?? []).filter(
    (i: any) => i.kind === "panel_access" && !linkedItems.some((l) => l.id === i.id),
  );

  return (
    <Modal title={message.label} onClose={onClose} wide>
      <div className="space-y-4">
        <p className="text-ink-soft text-sm font-bold">{message.description}</p>
        <ParamChips message={message} variables={variables} />

        <ComponentsEditor value={components} onChange={setComponents} />

        <div className="border-t-2 border-black/15 pt-3 space-y-2">
          <div className="font-bold text-sm">🛒 Store link (one-time edit access)</div>
          {linkedItems.map((i) => (
            <div key={i.id} className="text-sm">
              Linked to <strong>{i.name}</strong> ({i.price} SC
              {i.enabled ? "" : ", disabled"}) — buyers get a one-time magic link that
              edits this message.
            </div>
          ))}
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <select
              className={input + " !w-auto"}
              value={linkItemId}
              onChange={(e) => setLinkItemId(e.target.value)}
            >
              <option value="">Link existing panel item…</option>
              {linkable.map((i: any) => (
                <option key={i.id} value={i.id}>
                  {i.name} ({i.price} SC)
                </option>
              ))}
            </select>
            <button
              className={btnGhost}
              disabled={!linkItemId || busy}
              onClick={() =>
                run(async () => {
                  const res = await api.linkBotMessageItem(message.key, Number(linkItemId));
                  setLinkedItems(res.linkedItems);
                  setLinkItemId("");
                })
              }
            >
              Link
            </button>
            <span className="text-ink-soft">or</span>
            <input
              className={input + " !w-44"}
              placeholder={`Edit “${message.label}”`}
              value={newItemName}
              onChange={(e) => setNewItemName(e.target.value)}
            />
            <input
              className={input + " !w-24"}
              type="number"
              min={0}
              value={newItemPrice}
              onChange={(e) => setNewItemPrice(Number(e.target.value))}
            />
            <button
              className={btnGhost}
              disabled={busy}
              onClick={() =>
                run(async () => {
                  const res = await api.createBotMessageItem(message.key, {
                    name: newItemName,
                    price: newItemPrice,
                  });
                  setLinkedItems(res.linkedItems);
                  setNewItemName("");
                })
              }
            >
              + Create item
            </button>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            className={btn}
            disabled={busy}
            onClick={() => run(() => api.updateBotMessage(message.key, components), true)}
          >
            Save
          </button>
          {message.overridden && (
            <button
              className={btnGhost}
              disabled={busy}
              onClick={() => {
                if (!window.confirm("Discard the customization and restore the default?")) return;
                run(() => api.resetBotMessage(message.key), true);
              }}
            >
              Reset to default
            </button>
          )}
          <button className={btnGhost} onClick={onClose}>Cancel</button>
          {error && <span className="text-red-700 font-bold text-sm">{error}</span>}
        </div>
      </div>
    </Modal>
  );
}

// --- Variables (owner only) ---

const DEFAULT_SNIPPET = `// Runs on the bot. Return the value spliced into messages.
// Available: client, guildId, config, db, schema, ctx — await freely.
const guild = await client.guilds.fetch(guildId);
return guild.memberCount;
`;

function VariableModal({
  variable,
  onClose,
  onSaved,
}: {
  variable: { id?: number; name: string; description: string; code: string };
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState(variable);
  const [test, setTest] = useState<{ ok: boolean; text: string; ms?: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const runTest = async () => {
    setBusy(true);
    setTest(null);
    try {
      const res = await api.testVariable(form.code);
      setTest({ ok: true, text: res.result, ms: res.ms });
    } catch (e: any) {
      setTest({ ok: false, text: e.message });
    } finally {
      setBusy(false);
    }
  };

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      if (form.id) await api.updateVariable(form.id, form);
      else await api.createVariable(form);
      onSaved();
      onClose();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title={form.id ? `Variable {{${variable.name}}}` : "New variable"} onClose={onClose} wide>
      <div className="space-y-3">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <label className="text-sm space-y-1">
            <span className="text-ink-soft">Name (used as {"{{name}}"})</span>
            <input
              className={input}
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="member_count"
            />
          </label>
          <label className="text-sm space-y-1">
            <span className="text-ink-soft">Description</span>
            <input
              className={input}
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
            />
          </label>
        </div>

        <div className="text-sm space-y-1">
          <span className="text-ink-soft">
            JavaScript — executes on the bot each time a message using it is sent
          </span>
          <CodeEditor
            value={form.code}
            onChange={(code) => setForm((f) => ({ ...f, code }))}
          />
        </div>

        {test && (
          <div
            className={`text-sm font-bold rounded-lg border-2 border-black p-2 ${
              test.ok ? "bg-green-200" : "bg-red-200"
            }`}
          >
            {test.ok ? `→ ${test.text || "(empty string)"} · ${test.ms}ms` : `✗ ${test.text}`}
          </div>
        )}

        <div className="flex items-center gap-2">
          <button className={btnGhost} disabled={busy} onClick={runTest}>
            ▶ Test run
          </button>
          <button className={btn} disabled={busy} onClick={save}>Save</button>
          <button className={btnGhost} onClick={onClose}>Cancel</button>
          {error && <span className="text-red-700 font-bold text-sm">{error}</span>}
        </div>
      </div>
    </Modal>
  );
}

function VariablesSection() {
  const { data, reload } = useAsync(() => api.variables());
  const [editing, setEditing] = useState<any | null>(null);

  return (
    <div className={card + " space-y-3"}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <div className="font-bold">⚡ Variables (bot owner only)</div>
          <div className="text-ink-soft text-sm">
            JS snippets that run on the bot; use them in any message as{" "}
            <code>{"{{name}}"}</code>.
          </div>
        </div>
        <button
          className={btn}
          onClick={() => setEditing({ name: "", description: "", code: DEFAULT_SNIPPET })}
        >
          + New variable
        </button>
      </div>
      {(data ?? []).map((v: any) => (
        <div
          key={v.id}
          className="flex flex-wrap items-center justify-between gap-2 border-t-2 border-black/10 pt-2"
        >
          <div className="text-sm min-w-0">
            <code className="font-bold">{`{{${v.name}}}`}</code>
            {v.description && <span className="text-ink-soft"> — {v.description}</span>}
          </div>
          <div className="flex gap-2 shrink-0">
            <button className={btnGhost} onClick={() => setEditing({ ...v })}>Edit</button>
            <button
              className={btnGhost}
              onClick={async () => {
                if (!window.confirm(`Delete {{${v.name}}}?`)) return;
                await api.deleteVariable(v.id);
                reload();
              }}
            >
              Delete
            </button>
          </div>
        </div>
      ))}
      {(data ?? []).length === 0 && (
        <div className="text-ink-soft text-sm">No variables yet.</div>
      )}
      {editing && (
        <VariableModal
          variable={editing}
          onClose={() => setEditing(null)}
          onSaved={reload}
        />
      )}
    </div>
  );
}

function MessageButton({ message, onOpen }: { message: BotMessage; onOpen: () => void }) {
  return (
    <button className={card + " text-left hover:bg-paper-dim transition"} onClick={onOpen}>
      <div className="font-bold flex items-center gap-2 flex-wrap">
        {message.label}
        {message.overridden && (
          <span className="text-xs px-2 py-0.5 rounded-full border-2 border-black bg-sun">
            customized
          </span>
        )}
        {message.linkedItems.length > 0 && (
          <span className="text-xs px-2 py-0.5 rounded-full border-2 border-black bg-green-200">
            🛒 {message.linkedItems.length} linked
          </span>
        )}
      </div>
      <div className="text-ink-soft text-sm">{message.description}</div>
      <code className="text-xs text-ink-soft">{message.key}</code>
    </button>
  );
}

/** One collapsible category of messages. */
function CategorySection({
  category,
  messages,
  expanded,
  onToggle,
  onOpen,
}: {
  category: string;
  messages: BotMessage[];
  expanded: boolean;
  onToggle: () => void;
  onOpen: (key: string) => void;
}) {
  const customized = messages.filter((m) => m.overridden).length;
  return (
    <div className="space-y-3">
      <button
        className="flex w-full items-center gap-2 text-left font-bold"
        onClick={onToggle}
      >
        <span
          className={
            "inline-block transition-transform duration-150 " +
            (expanded ? "rotate-90" : "")
          }
        >
          ▶
        </span>
        <span className="comic-title text-2xl">{category}</span>
        <span className="text-ink-soft text-sm font-bold">
          {messages.length} message{messages.length === 1 ? "" : "s"}
          {customized > 0 && ` · ${customized} customized`}
        </span>
      </button>
      {expanded && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {messages.map((m) => (
            <MessageButton key={m.key} message={m} onOpen={() => onOpen(m.key)} />
          ))}
        </div>
      )}
    </div>
  );
}

/** The Config page's second tab: every registered bot response + variables. */
export function BotMessagesTab() {
  const { data, reload } = useAsync(() => api.botMessages());
  const [openKey, setOpenKey] = useState<string | null>(null);
  // Categories the user collapsed (default: everything expanded).
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  if (!data) return <p className="on-bg-soft">Loading…</p>;
  const open = data.messages.find((m: BotMessage) => m.key === openKey);

  // Group by category, preserving catalog order for both groups and members.
  const categories: { name: string; messages: BotMessage[] }[] = [];
  for (const m of data.messages as BotMessage[]) {
    const group = categories.find((c) => c.name === m.category);
    if (group) group.messages.push(m);
    else categories.push({ name: m.category, messages: [m] });
  }

  return (
    <div className="space-y-5">
      {categories.map((c) => (
        <CategorySection
          key={c.name}
          category={c.name}
          messages={c.messages}
          expanded={!collapsed[c.name]}
          onToggle={() => setCollapsed((s) => ({ ...s, [c.name]: !s[c.name] }))}
          onOpen={setOpenKey}
        />
      ))}

      {open && (
        <MessageModal
          key={open.key}
          message={open}
          variables={data.variables}
          onClose={() => setOpenKey(null)}
          onSaved={reload}
        />
      )}

      {data.isOwner && <VariablesSection />}
    </div>
  );
}
