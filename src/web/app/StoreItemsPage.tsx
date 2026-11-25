import { useState } from "react";
import { api } from "./api.ts";
import { card, btn, btnGhost, input, useAsync } from "./ui.ts";

const KIND_OPTIONS = [
  { value: "panel_access", label: "One-time panel access (magic link)" },
  { value: "role", label: "Existing role" },
  { value: "custom_role", label: "Custom role (buyer picks name + color)" },
  { value: "sabotage", label: "Election sabotage" },
];

const SABOTAGE_OPTIONS = [
  { value: "disable_voting", label: "Disable voting for X days" },
  { value: "cut_votes", label: "Cut votes by X%" },
  { value: "silence", label: "Silence (stamp their card) for X days" },
];

function blankItem() {
  return {
    name: "",
    description: "",
    iconType: "emoji",
    icon: "🎁",
    price: 100,
    kind: "role",
    panel: "theme",
    messageKey: "",
    roleId: "",
    anchorRoleId: "",
    maxPerUser: "",
    stock: "",
    sabotageType: "disable_voting",
    sabotageDays: 3,
    sabotagePercent: 25,
    enabled: 1,
  };
}

/** Admin-only editor for the SC storefront's catalogue. */
export function StoreItemsPage() {
  const { data, reload } = useAsync(() => api.storeItems());
  const botMessages = useAsync(() => api.botMessages());
  const [editing, setEditing] = useState<any | null>(null);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    setError(null);
    try {
      if (editing.id) await api.updateStoreItem(editing.id, editing);
      else await api.createStoreItem(editing);
      setEditing(null);
      reload();
    } catch (e: any) {
      setError(e.message);
    }
  };

  if (editing) {
    const set = (patch: any) => setEditing({ ...editing, ...patch });
    return (
      <div className={card + " space-y-4 max-w-3xl"}>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <label className="text-sm space-y-1">
            <span className="text-ink-soft">Name</span>
            <input className={input} value={editing.name} onChange={(e) => set({ name: e.target.value })} />
          </label>
          <label className="text-sm space-y-1">
            <span className="text-ink-soft">Price (SC)</span>
            <input
              className={input}
              type="number"
              min={0}
              value={editing.price}
              onChange={(e) => set({ price: Number(e.target.value) })}
            />
          </label>
          <label className="text-sm space-y-1 sm:col-span-2">
            <span className="text-ink-soft">Description</span>
            <input
              className={input}
              value={editing.description}
              onChange={(e) => set({ description: e.target.value })}
            />
          </label>

          <label className="text-sm space-y-1">
            <span className="text-ink-soft">Icon type</span>
            <select
              className={input}
              value={editing.iconType}
              onChange={(e) => set({ iconType: e.target.value })}
            >
              <option value="emoji">Emoji</option>
              <option value="image">Image URL</option>
            </select>
          </label>
          <label className="text-sm space-y-1">
            <span className="text-ink-soft">
              {editing.iconType === "image" ? "Image URL" : "Emoji"}
            </span>
            <input
              className={input}
              value={editing.icon}
              placeholder={editing.iconType === "image" ? "https://…/icon.png" : "🎁"}
              onChange={(e) => set({ icon: e.target.value })}
            />
          </label>

          <label className="text-sm space-y-1">
            <span className="text-ink-soft">Item type</span>
            <select className={input} value={editing.kind} onChange={(e) => set({ kind: e.target.value })}>
              {KIND_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </label>
          <label className="text-sm flex items-center gap-2 mt-5">
            <input
              type="checkbox"
              checked={!!editing.enabled}
              onChange={(e) => set({ enabled: e.target.checked ? 1 : 0 })}
            />
            <span className="text-ink-soft">Enabled (visible in the store)</span>
          </label>

          <label className="text-sm space-y-1">
            <span className="text-ink-soft">Max purchases per user (blank = unlimited)</span>
            <input
              className={input}
              type="number"
              min={1}
              value={editing.maxPerUser ?? ""}
              onChange={(e) => set({ maxPerUser: e.target.value })}
            />
          </label>
          <label className="text-sm space-y-1">
            <span className="text-ink-soft">Global stock (blank = unlimited)</span>
            <input
              className={input}
              type="number"
              min={1}
              value={editing.stock ?? ""}
              onChange={(e) => set({ stock: e.target.value })}
            />
          </label>

          {editing.kind === "panel_access" && (
            <label className="text-sm space-y-1">
              <span className="text-ink-soft">Panel the magic link opens</span>
              <select className={input} value={editing.panel ?? "theme"} onChange={(e) => set({ panel: e.target.value })}>
                <option value="theme">Server theme editor</option>
                <option value="autoreply">Auto-reply creator</option>
                <option value="botmessage">Bot message editor (one-time rewrite)</option>
              </select>
            </label>
          )}

          {editing.kind === "panel_access" && editing.panel === "botmessage" && (
            <label className="text-sm space-y-1">
              <span className="text-ink-soft">Bot message the link edits</span>
              <select
                className={input}
                value={editing.messageKey ?? ""}
                onChange={(e) => set({ messageKey: e.target.value })}
              >
                <option value="">Pick a message…</option>
                {(botMessages.data?.messages ?? []).map((m: any) => (
                  <option key={m.key} value={m.key}>{m.label}</option>
                ))}
              </select>
            </label>
          )}

          {editing.kind === "role" && (
            <label className="text-sm space-y-1">
              <span className="text-ink-soft">Role ID to grant</span>
              <input
                className={input}
                value={editing.roleId ?? ""}
                placeholder="123456789012345678"
                onChange={(e) => set({ roleId: e.target.value })}
              />
            </label>
          )}

          {editing.kind === "custom_role" && (
            <>
              <label className="text-sm space-y-1">
                <span className="text-ink-soft">Anchor role ID (optional)</span>
                <input
                  className={input}
                  value={editing.anchorRoleId ?? ""}
                  placeholder="123456789012345678"
                  onChange={(e) => set({ anchorRoleId: e.target.value })}
                />
              </label>
              <div className="text-xs text-ink-soft sm:col-span-2">
                Bought roles are placed directly below the anchor role so their color still
                shows on names. Each member can only have one active custom role, editable
                from their Profile page.
              </div>
            </>
          )}

          {editing.kind === "sabotage" && (
            <>
              <label className="text-sm space-y-1">
                <span className="text-ink-soft">Sabotage effect</span>
                <select
                  className={input}
                  value={editing.sabotageType ?? "disable_voting"}
                  onChange={(e) => set({ sabotageType: e.target.value })}
                >
                  {SABOTAGE_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
              </label>
              {editing.sabotageType === "cut_votes" ? (
                <label className="text-sm space-y-1">
                  <span className="text-ink-soft">Cut votes by (%)</span>
                  <input
                    className={input}
                    type="number"
                    min={1}
                    max={100}
                    value={editing.sabotagePercent ?? 25}
                    onChange={(e) => set({ sabotagePercent: Number(e.target.value) })}
                  />
                </label>
              ) : (
                <label className="text-sm space-y-1">
                  <span className="text-ink-soft">Duration (days)</span>
                  <input
                    className={input}
                    type="number"
                    min={1}
                    max={30}
                    value={editing.sabotageDays ?? 3}
                    onChange={(e) => set({ sabotageDays: Number(e.target.value) })}
                  />
                </label>
              )}
              <div className="text-xs text-ink-soft sm:col-span-2">
                Sabotage items only appear in the store while an election is open, and each
                can be bought once per election.
              </div>
            </>
          )}
        </div>

        <div className="flex items-center gap-2">
          <button className={btn} onClick={save}>Save</button>
          <button className={btnGhost} onClick={() => setEditing(null)}>Cancel</button>
          {error && <span className="text-red-700 font-bold text-sm">{error}</span>}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <button className={btn} onClick={() => setEditing(blankItem())}>+ New item</button>
      {(data ?? []).map((item: any) => (
        <div key={item.id} className={card + " flex flex-wrap items-center justify-between gap-2"}>
          <div className="flex items-center gap-3 min-w-0">
            {item.iconType === "image" ? (
              <img src={item.icon} alt="" className="w-8 h-8 rounded object-cover" />
            ) : (
              <span className="text-2xl">{item.icon}</span>
            )}
            <div>
              <div className="font-medium">
                {item.name}{" "}
                {!item.enabled && <span className="text-ink-soft text-sm">(disabled)</span>}
              </div>
              <div className="text-ink-soft text-sm">
                {item.kind}
                {item.kind === "panel_access" &&
                  ` → ${item.panel}${item.messageKey ? `:${item.messageKey}` : ""}`}
                {item.kind === "sabotage" &&
                  ` → ${item.sabotageType} ${
                    item.sabotageType === "cut_votes"
                      ? `${item.sabotagePercent}%`
                      : `${item.sabotageDays}d`
                  }`}
                {" · "}
                {item.price} SC
                {item.maxPerUser != null && ` · max ${item.maxPerUser}/user`}
                {item.stock != null && ` · stock ${item.stock}`}
              </div>
            </div>
          </div>
          <div className="flex gap-2">
            <button className={btnGhost} onClick={() => setEditing({ ...item })}>Edit</button>
            <button
              className={btnGhost}
              onClick={async () => {
                if (!window.confirm(`Delete “${item.name}”?`)) return;
                await api.deleteStoreItem(item.id);
                reload();
              }}
            >
              Delete
            </button>
          </div>
        </div>
      ))}
      {(data ?? []).length === 0 && (
        <div className={card + " text-ink-soft"}>No items yet — create the first one.</div>
      )}
    </div>
  );
}
