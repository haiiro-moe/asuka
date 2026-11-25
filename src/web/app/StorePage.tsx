import { useState } from "react";
import { api } from "./api.ts";
import { useNames } from "./names.tsx";
import { useMe } from "./me-context.ts";
import { card, btn, input, useAsync } from "./ui.ts";

interface StoreData {
  balance: number;
  hasCustomRole: boolean;
  items: any[];
  election: {
    id: number;
    status: string;
    candidates: { userId: string; silenced: boolean; votingDisabled: boolean }[];
  } | null;
}

function ItemIcon({ item }: { item: any }) {
  if (item.iconType === "image") {
    return <img src={item.icon} alt="" className="w-12 h-12 rounded object-cover" />;
  }
  return <span className="text-4xl leading-none">{item.icon}</span>;
}

const KIND_LABEL: Record<string, string> = {
  panel_access: "One-time panel access",
  role: "Role",
  custom_role: "Custom role",
  sabotage: "Election sabotage",
};

/** The member-facing storefront: browse items and spend SC. */
export function StorePage() {
  const { data, reload } = useAsync<StoreData>(() => api.store());
  const me = useMe();
  const name = useNames((data?.election?.candidates ?? []).map((c) => c.userId));

  // Per-item purchase form state (custom-role fields / sabotage target).
  const [forms, setForms] = useState<Record<number, any>>({});
  const [busy, setBusy] = useState<number | null>(null);
  const [notice, setNotice] = useState<{ kind: "ok" | "error"; text: string; link?: string } | null>(null);

  if (!data) return <p className="on-bg-soft">Loading…</p>;

  const form = (id: number) => forms[id] ?? {};
  const setForm = (id: number, patch: any) =>
    setForms((f) => ({ ...f, [id]: { ...form(id), ...patch } }));

  const buy = async (item: any) => {
    const f = form(item.id);
    if (!window.confirm(`Buy “${item.name}” for ${item.price} SC?`)) return;
    setBusy(item.id);
    setNotice(null);
    try {
      const res = await api.buyItem(item.id, {
        targetUserId: f.target,
        roleName: f.roleName,
        roleColor: f.roleColor ?? "#5865f2",
      });
      setNotice({ kind: "ok", text: res.message, link: res.link });
      setForms((cur) => ({ ...cur, [item.id]: {} }));
      reload();
    } catch (e: any) {
      setNotice({ kind: "error", text: e.message });
    } finally {
      setBusy(null);
    }
  };

  const candidates = (data.election?.candidates ?? []).filter((c) => c.userId !== me?.userId);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <p className="on-bg text-sm max-w-xl">
          Spend your Social Credits on perks. Magic links can be opened any time, but expire
          after one submission.
        </p>
        <div className="shrink-0 rounded-full bg-sun border-3 border-black shadow-[3px_3px_0_#000] px-4 py-1.5 font-bold">
          🪙 {data.balance.toLocaleString()} SC
        </div>
      </div>

      {notice && (
        <div
          className={
            card +
            " text-sm " +
            (notice.kind === "ok" ? "border-green-700" : "border-red-700 text-red-700")
          }
        >
          <div>{notice.text}</div>
          {notice.link && (
            <div className="mt-2 space-y-1">
              <a href={notice.link} className="text-accent font-bold break-all underline">
                {notice.link}
              </a>
              <div className="text-amber-800 font-bold">
                ⚠️ One submission only — the link dies once you hit apply. Copy it somewhere
                safe.
              </div>
            </div>
          )}
        </div>
      )}

      {data.items.length === 0 && (
        <div className={card + " text-ink-soft"}>Nothing for sale right now — check back later.</div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {data.items.map((item) => (
          <div key={item.id} className={card + " space-y-3 flex flex-col"}>
            <div className="flex items-start gap-3">
              <ItemIcon item={item} />
              <div className="flex-1">
                <div className="font-medium">
                  {item.name}
                  {item.remainingStock != null && !item.soldOut && (
                    <span className="ml-2 text-xs text-ink-soft font-bold">
                      {item.remainingStock} left
                    </span>
                  )}
                </div>
                <div className="text-xs text-ink-soft">{KIND_LABEL[item.kind] ?? item.kind}</div>
                <div className="text-ink-soft text-sm mt-1">{item.description}</div>
              </div>
              <div className="comic-title text-xl whitespace-nowrap">{item.price} SC</div>
            </div>

            {item.kind === "custom_role" &&
              (data.hasCustomRole ? (
                <div className="text-sm text-ink-soft font-bold">
                  You already have a custom role — edit it on your Profile page.
                </div>
              ) : (
                <div className="flex gap-2 items-center">
                  <input
                    className={input}
                    placeholder="Role name"
                    value={form(item.id).roleName ?? ""}
                    onChange={(e) => setForm(item.id, { roleName: e.target.value })}
                  />
                  <input
                    type="color"
                    className="w-10 h-8 bg-transparent cursor-pointer"
                    value={form(item.id).roleColor ?? "#5865f2"}
                    onChange={(e) => setForm(item.id, { roleColor: e.target.value })}
                  />
                </div>
              ))}

            {item.kind === "sabotage" && !item.soldOut && (
              <select
                className={input}
                value={form(item.id).target ?? ""}
                onChange={(e) => setForm(item.id, { target: e.target.value })}
              >
                <option value="">Pick a candidate to sabotage…</option>
                {candidates.map((c) => (
                  <option key={c.userId} value={c.userId}>
                    {name(c.userId)}
                    {c.silenced ? " (silenced)" : ""}
                    {c.votingDisabled ? " (voting disabled)" : ""}
                  </option>
                ))}
              </select>
            )}

            <div className="mt-auto">
              {item.soldOut ? (
                <span className="inline-block px-3 py-1.5 rounded-lg bg-paper-dim border-2 border-black/40 text-ink-soft text-sm font-bold">
                  SOLD OUT{item.kind === "sabotage" ? " this election" : ""}
                </span>
              ) : (
                <button
                  className={btn}
                  disabled={
                    busy === item.id ||
                    item.limitReached ||
                    item.price > data.balance ||
                    (item.kind === "sabotage" && !form(item.id).target) ||
                    (item.kind === "custom_role" && data.hasCustomRole)
                  }
                  onClick={() => buy(item)}
                >
                  {busy === item.id
                    ? "Buying…"
                    : item.limitReached
                      ? "Limit reached"
                      : item.kind === "custom_role" && data.hasCustomRole
                        ? "Already owned"
                        : item.price > data.balance
                          ? "Not enough SC"
                          : "Buy"}
                </button>
              )}
            </div>
          </div>
        ))}
      </div>

      <div className={card + " text-sm text-ink-soft font-bold"}>
        Bought something? Everything you own lives on your <strong>My Profile</strong> page —
        magic links included.
      </div>
    </div>
  );
}
