/**
 * The Config page's messages tab: every registered bot message by group (tabs), a list of the group's
 * templates, the selected template's editor with its Discord preview, the store link that sells edit
 * access, and the owner-only JS variables.
 *
 * @module
 */
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { api } from "./api.ts";
import { ComponentsEditor } from "./ComponentsEditor.tsx";
import { CodeEditor } from "./CodeEditor.tsx";
import { Modal } from "./Modal.tsx";
import {
  Empty,
  ErrorLine,
  Heading,
  InkButton,
  Loading,
  PromptField,
  Saved,
  Select,
  Tabs,
  Window,
  cx,
  useAsync,
  useConfirm,
} from "./ui.ts";

/** One registered message as `GET /api/bot-messages` returns it. */
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

/** The `{param}` values a message takes and the `{{variable}}` names any message can use. */
function ParamLines({ message, variables }: { message: BotMessage; variables: string[] }) {
  return (
    <div className="px-2 pb-1 space-y-1">
      <p>
        <span className="text-subtle">params </span>
        {message.params.map((p) => (
          <code key={p.name} className="c6 mr-[1ch]" title={p.description}>
            {"{" + p.name + "}"}
          </code>
        ))}
        {message.params.length === 0 && <span className="text-subtle">none</span>}
      </p>
      <p>
        <span className="text-subtle">variables </span>
        {variables.map((v) => (
          <code key={v} className="c7 mr-[1ch]">{`{{${v}}}`}</code>
        ))}
        {variables.length === 0 && <span className="text-subtle">none yet (the bot owner defines them)</span>}
      </p>
    </div>
  );
}

/** Props of {@link MessageEditor}. */
interface MessageEditorProps {
  message: BotMessage;
  variables: string[];
  /** Re-fetches the catalogue (after a save or a store link change). */
  onSaved: () => Promise<unknown> | void;
  /** Re-fetches the catalogue and remounts the editor with the default payload. */
  onReset: () => Promise<unknown>;
  /** Tells the tab whether there are unsaved edits, so switching away can ask first. */
  onDirtyChange: (dirty: boolean) => void;
  /** The group's template list, placed above the editor in the left column. */
  list: ReactNode;
}

/**
 * The selected template: its params, the block editor (in a `vim: <key>` window under the template
 * list), the store-item link and the window's one gold `save`, with the preview in a foam window beside
 * it that stays in view while you scroll (stacked on phones). Reset asks first.
 */
function MessageEditor({ message, variables, onSaved, onReset, onDirtyChange, list }: MessageEditorProps) {
  const [components, setComponents] = useState<unknown[]>(message.components);
  const baseline = useRef<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [linkItemId, setLinkItemId] = useState<number | null>(null);
  const [newItemName, setNewItemName] = useState("");
  const [newItemPrice, setNewItemPrice] = useState(500);
  const [linkedItems, setLinkedItems] = useState(message.linkedItems);
  const storeItems = useAsync(() => api.storeItems());
  const { confirm, dialog } = useConfirm();

  const dirty = baseline.current != null && JSON.stringify(components) !== baseline.current;
  useEffect(() => onDirtyChange(dirty), [dirty]);
  useEffect(() => () => onDirtyChange(false), []);

  const onChange = (payload: unknown[]) => {
    // the editor reports its normalised payload on mount: that is the saved state
    if (baseline.current == null) baseline.current = JSON.stringify(payload);
    setComponents(payload);
    setSaved(false);
  };

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      return true;
    } catch (e: any) {
      setError(e.message);
      return false;
    } finally {
      setBusy(false);
    }
  };

  const save = async () => {
    const ok = await run(() => api.updateBotMessage(message.key, components));
    if (!ok) return;
    baseline.current = JSON.stringify(components);
    setSaved(true);
    await onSaved();
  };

  const reset = async () => {
    const yes = await confirm({
      label: `confirm: ~/messages/${message.key}`,
      title: "reset to default",
      message: "Your version of this message goes, and the default comes back in its place.",
      confirmLabel: "reset",
    });
    if (!yes) return;
    const ok = await run(() => api.resetBotMessage(message.key));
    if (ok) await onReset();
  };

  const linkable = (storeItems.data ?? []).filter(
    (i: any) => i.kind === "panel_access" && !linkedItems.some((l) => l.id === i.id),
  );

  return (
    <>
      <ComponentsEditor
        value={message.components}
        onChange={onChange}
        layout={({ editor, preview }) => (
          <>
            <div className="flex flex-col gap-4 flex-[1_1_440px] min-w-0">
              {list}
              <Window
                label={`vim: ${message.key}`}
                className="min-w-0"
                foot={
                  <>
                    <span>{dirty ? "[+] unsaved changes" : "no changes"}</span>
                    <span className="r">{message.overridden ? "edited" : "default"}</span>
                  </>
                }
              >
                <p className="px-2 pb-1 text-subtle">{message.description}</p>
                <ParamLines message={message} variables={variables} />
                {editor}
  
                <Heading>store link</Heading>
                {linkedItems.map((i) => (
                  <p key={i.id} className="px-2">
                    <span className="c4" aria-hidden="true">» </span>
                    linked to <b>{i.name}</b> <span className="c6">{i.price} SC</span>
                    {!i.enabled && <span className="text-subtle"> (disabled)</span>}
                  </p>
                ))}
                <p className="px-2 pb-1 text-label text-subtle">
                  {linkedItems.length > 0
                    ? "Buyers get a one-time magic link that edits this message."
                    : "Sell one-time edit access: link a panel item, or create one."}
                </p>
                <div className="flex flex-wrap items-center gap-2 px-2 py-1">
                  <Select
                    options={linkable.map((i: any) => ({ value: i.id as number, label: String(i.name), meta: `${i.price} SC` }))}
                    value={linkItemId}
                    onChange={setLinkItemId}
                    placeholder={linkable.length ? "link a panel item" : "no panel items to link"}
                    disabled={!linkable.length || busy}
                    ariaLabel="panel item to link"
                  />
                  <InkButton
                    tone="muted"
                    disabled={linkItemId == null || busy}
                    onClick={() =>
                      run(async () => {
                        const res = await api.linkBotMessageItem(message.key, Number(linkItemId));
                        setLinkedItems(res.linkedItems);
                        setLinkItemId(null);
                      })
                    }
                  >
                    link
                  </InkButton>
                </div>
                <PromptField
                  label="new item"
                  promptWidth={12}
                  value={newItemName}
                  onChange={setNewItemName}
                  placeholder={`Edit “${message.label}”`}
                />
                <PromptField
                  label="price"
                  promptWidth={12}
                  type="number"
                  min={0}
                  inputMode="numeric"
                  value={String(newItemPrice)}
                  onChange={(v) => setNewItemPrice(Number(v))}
                  hint="In SC."
                />
                <div className="btns pt-1">
                  <InkButton
                    tone="muted"
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
                    + create item
                  </InkButton>
                </div>
  
                <div className="btns items-center border-t border-ink-hairline mt-2">
                  <InkButton tone="gold" busy={busy} busyLabel="saving" onClick={save}>
                    save
                  </InkButton>
                  {message.overridden && (
                    <InkButton tone="muted" disabled={busy} onClick={reset}>
                      reset to default
                    </InkButton>
                  )}
                  {saved && !dirty && <Saved />}
                </div>
                {error && <ErrorLine className="px-2">{error}</ErrorLine>}
              </Window>
            </div>
            <div className="flex-[1_1_360px] min-w-0 desk:sticky desk:top-[56px]">{preview}</div>
          </>
        )}
      />
      {dialog}
    </>
  );
}

// --- Variables (owner only) ---

const DEFAULT_SNIPPET = `// Runs on the bot. Return the value spliced into messages.
// Available: client, guildId, config, db, schema, ctx — await freely.
const guild = await client.guilds.fetch(guildId);
return guild.memberCount;
`;

/** Props of {@link VariableModal}. */
interface VariableModalProps {
  variable: { id?: number; name: string; description: string; code: string };
  onClose: () => void;
  onSaved: () => void;
}

/**
 * Creates or edits one owner variable: name, description and the JavaScript in the haiiro code editor,
 * with a test run that shows the result (foam) or the error (love) before saving.
 */
function VariableModal({ variable, onClose, onSaved }: VariableModalProps) {
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
    <Modal
      title={form.id ? `variable {{${variable.name}}}` : "new variable"}
      label={`vim: ~/variables/${form.id ? variable.name : "new"}`}
      onClose={onClose}
      wide
    >
      <PromptField
        label="name"
        promptWidth={14}
        value={form.name}
        onChange={(name) => setForm({ ...form, name })}
        placeholder="member_count"
        spellCheck={false}
        hint="Used as {{name}} in any message."
      />
      <PromptField
        label="description"
        promptWidth={14}
        value={form.description}
        onChange={(description) => setForm({ ...form, description })}
      />

      <Heading>javascript</Heading>
      <p className="px-2 pb-2 text-label text-subtle">Runs on the bot each time a message that uses it is sent.</p>
      <div className="px-2">
        <CodeEditor value={form.code} onChange={(code) => setForm((f) => ({ ...f, code }))} ariaLabel="variable code" />
      </div>

      {test && (
        <div className="px-2 pt-3" role="status">
          {test.ok ? (
            <p>
              <span className="c6">→ {test.text || "(empty string)"}</span>
              <span className="text-subtle"> · {test.ms}ms</span>
            </p>
          ) : (
            <p className="c2">× {test.text}</p>
          )}
        </div>
      )}

      <div className="btns items-center">
        <InkButton tone="gold" busy={busy} busyLabel="saving" onClick={save}>
          save
        </InkButton>
        <InkButton tone="foam" disabled={busy} onClick={runTest}>
          test run
        </InkButton>
        <InkButton tone="muted" onClick={onClose}>
          cancel
        </InkButton>
      </div>
      {error && <ErrorLine className="px-2">{error}</ErrorLine>}
    </Modal>
  );
}

/** The owner's JS variables: a list with edit and delete per row, and a gold `new variable`. */
function VariablesSection() {
  const { data, error, reload } = useAsync(() => api.variables());
  const [editing, setEditing] = useState<any | null>(null);
  const { confirm, dialog } = useConfirm();

  const remove = async (v: any) => {
    const yes = await confirm({
      label: "confirm: ~/variables/delete",
      title: `delete {{${v.name}}}`,
      message: `{{${v.name}}} is deleted for good. Messages that use it stop getting its value.`,
      confirmLabel: "delete",
    });
    if (!yes) return;
    await api.deleteVariable(v.id);
    reload();
  };

  return (
    <Window label="fish: ~/variables" foot={<span>bot owner only</span>}>
      <p className="px-2 pb-2 text-subtle">
        JS snippets that run on the bot. Use them in any message as <code className="c7">{"{{name}}"}</code>.
      </p>
      {error && <ErrorLine onRetry={reload}>{error}</ErrorLine>}
      {data && data.length === 0 && <Empty className="px-2">No variables yet.</Empty>}
      {data && data.length > 0 && (
        <div className="list">
          {data.map((v: any) => (
            <div key={v.id} className="li">
              <span className="mk" />
              <span className="grow">
                <code className="c7">{`{{${v.name}}}`}</code>
                {v.description && <span className="text-subtle"> {v.description}</span>}
              </span>
              <InkButton tone="flat" aria-label={`edit {{${v.name}}}`} onClick={() => setEditing({ ...v })}>
                edit
              </InkButton>
              <InkButton tone="flat" aria-label={`delete {{${v.name}}}`} onClick={() => remove(v)}>
                delete
              </InkButton>
            </div>
          ))}
        </div>
      )}
      <div className="btns">
        <InkButton tone="gold" onClick={() => setEditing({ name: "", description: "", code: DEFAULT_SNIPPET })}>
          + new variable
        </InkButton>
      </div>
      {editing && <VariableModal variable={editing} onClose={() => setEditing(null)} onSaved={reload} />}
      {dialog}
    </Window>
  );
}

/* ------------------------------------------------------------------------------------------------ */

/** A category as one lowercase tab word (`XP & Levels` becomes `xp`); the full name if words clash. */
function tabWords(names: string[]): string[] {
  const first = names.map((n) => n.toLowerCase().split(/[^a-z0-9]+/).find(Boolean) ?? n.toLowerCase());
  return first.map((w, i) => (first.indexOf(w) !== first.lastIndexOf(w) ? names[i]!.toLowerCase() : w));
}

/**
 * The Config page's messages tab: groups as tabs, the group's templates as a list (`»` on the open one,
 * a gold `edited` on customised ones), the open template's editor and preview, and, for the bot owner,
 * the variables. Leaving a template with unsaved edits asks first.
 */
export function BotMessagesTab() {
  const { data, error, reload } = useAsync(() => api.botMessages());
  const [tab, setTab] = useState(0);
  const [openKey, setOpenKey] = useState<string | null>(null);
  const [version, setVersion] = useState(0);
  const dirty = useRef(false);
  const { confirm, dialog } = useConfirm();
  const idPrefix = useId().replace(/:/g, "");

  if (error && !data) return <ErrorLine onRetry={reload}>The message catalogue did not load: {error}</ErrorLine>;
  if (!data) return <Loading>Reading the message catalogue</Loading>;

  // Group by category, preserving catalog order for both groups and members.
  const categories: { name: string; messages: BotMessage[] }[] = [];
  for (const m of data.messages as BotMessage[]) {
    const group = categories.find((c) => c.name === m.category);
    if (group) group.messages.push(m);
    else categories.push({ name: m.category, messages: [m] });
  }
  if (!categories.length) return <Empty>No messages are registered. The bot has nothing to say yet.</Empty>;

  const words = tabWords(categories.map((c) => c.name));
  const current = Math.min(tab, categories.length - 1);
  const group = categories[current]!;
  const open = group.messages.find((m) => m.key === openKey) ?? group.messages[0]!;
  const edited = group.messages.filter((m) => m.overridden).length;

  /** Runs `go` now, or after asking when the open template has unsaved edits. */
  const leave = async (go: () => void) => {
    if (dirty.current) {
      const yes = await confirm({
        label: `confirm: ~/messages/${open.key}`,
        title: "discard changes",
        message: "Your changes to this message are not saved. Leave it and they are gone.",
        confirmLabel: "discard",
      });
      if (!yes) return;
    }
    dirty.current = false;
    go();
  };

  const list = (
    <Window
      label={`ls ~/${words[current]}`}
      contentClassName="px-0.5 py-1.5"
      foot={
        <span>
          {edited} edited · {group.messages.length - edited} default
        </span>
      }
    >
      <div className="list">
        {group.messages.map((m) => {
          const sel = m.key === open.key;
          return (
            <button
              key={m.key}
              type="button"
              className={cx("li", sel && "sel")}
              aria-current={sel || undefined}
              title={m.key}
              onClick={() => !sel && leave(() => setOpenKey(m.key))}
            >
              <span className="mk" aria-hidden="true">
                »
              </span>
              <span className="grow">{m.label.toLowerCase()}</span>
              {m.linkedItems.length > 0 && <span className="meta">{m.linkedItems.length} linked</span>}
              {m.overridden && <span className="meta text-gold">edited</span>}
            </button>
          );
        })}
      </div>
    </Window>
  );

  return (
    <div className="space-y-4">
      <Tabs
        items={words.map((w, i) => ({ value: i, label: w }))}
        value={current}
        className="pl-[1ch]"
        onChange={(i) =>
          leave(() => {
            setTab(i);
            setOpenKey(null);
          })
        }
        ariaLabel="message groups"
        idPrefix={idPrefix}
      />

      <div
        className="flex flex-wrap items-start gap-x-6 gap-y-4"
        role="tabpanel"
        id={`${idPrefix}-panel-${current}`}
        aria-labelledby={`${idPrefix}-tab-${current}`}
      >
        <MessageEditor
          key={`${open.key}#${version}`}
          message={open}
          variables={data.variables}
          onSaved={reload}
          onReset={async () => {
            await reload();
            setVersion((n) => n + 1);
          }}
          list={list}
          onDirtyChange={(d) => {
            dirty.current = d;
          }}
        />
      </div>

      {data.isOwner && <VariablesSection />}
      {dialog}
    </div>
  );
}
