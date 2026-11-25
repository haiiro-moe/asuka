import { useEffect, useState } from "react";
import { api } from "./api.ts";
import { useMe } from "./me-context.ts";
import { card, btn, btnGhost, input, useAsync } from "./ui.ts";
import { MemberProfilePage } from "./MemberProfilePage.tsx";

/** Rename/recolor the member's active custom role, any time, for free. */
function CustomRoleEditor({
  customRole,
  onSaved,
}: {
  customRole: { roleId: string; name: string; color: string; itemName: string };
  onSaved: () => void;
}) {
  const [name, setName] = useState(customRole.name);
  const [color, setColor] = useState(customRole.color);
  const [state, setState] = useState<"idle" | "saving">("idle");
  const [msg, setMsg] = useState<string | null>(null);

  // Re-sync the form when a reload brings fresh role data.
  useEffect(() => {
    setName(customRole.name);
    setColor(customRole.color);
  }, [customRole.roleId, customRole.name, customRole.color]);

  const save = async () => {
    setState("saving");
    setMsg(null);
    try {
      await api.updateCustomRole({ roleName: name, roleColor: color });
      setMsg("Saved ✓");
      onSaved();
    } catch (e: any) {
      setMsg("Error: " + e.message);
    } finally {
      setState("idle");
    }
  };

  return (
    <div className={card + " space-y-3"}>
      <div className="comic-title text-2xl">🎨 YOUR CUSTOM ROLE</div>
      <div className="text-sm text-ink-soft font-bold">
        From “{customRole.itemName}” — edit the name and color whenever you like.
      </div>
      <div className="flex gap-2 items-center max-w-md">
        <input className={input} value={name} onChange={(e) => setName(e.target.value)} />
        <input
          type="color"
          className="w-10 h-8 bg-transparent cursor-pointer shrink-0"
          value={color}
          onChange={(e) => setColor(e.target.value)}
        />
        <span
          className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border-2 border-black bg-white text-sm font-bold whitespace-nowrap"
          style={{ color }}
        >
          {name || "…"}
        </span>
      </div>
      <div className="flex items-center gap-3">
        <button className={btn} disabled={state === "saving"} onClick={save}>
          {state === "saving" ? "Saving…" : "Save changes"}
        </button>
        {msg && <span className="text-sm font-bold">{msg}</span>}
      </div>
    </div>
  );
}

/** The signed-in member's own profile: stats card + inventory + item config. */
export function ProfilePage() {
  const me = useMe();
  const { data, reload } = useAsync<any>(() => api.inventory());

  if (!me) return null;
  if (!data) return <p className="on-bg">Loading…</p>;

  return (
    // The inventory + item customization render between the member card's
    // XP and roles sections, via MemberProfilePage's children slot.
    <MemberProfilePage userId={me.userId}>
      {data.customRole && <CustomRoleEditor customRole={data.customRole} onSaved={reload} />}

      <div className={card}>
        <div className="comic-title text-2xl mb-2">🎒 INVENTORY</div>
        {(data.purchases ?? []).length === 0 && (
          <div className="text-ink-soft font-bold text-sm">
            Nothing yet — visit the Store to spend your {data.balance.toLocaleString()} SC.
          </div>
        )}
        {(data.purchases ?? []).map((p: any) => (
          <div
            key={p.id}
            className="text-sm py-1.5 border-b border-black/15 last:border-0 flex flex-wrap items-center justify-between gap-x-4 gap-y-1"
          >
            <span className="font-bold">
              {p.itemName}{" "}
              <span className="text-ink-soft font-normal">
                · {p.price} SC · {new Date(p.createdAt * 1000).toLocaleDateString()}
              </span>
            </span>
            {p.link && (
              <span className="flex items-center gap-2 min-w-0">
                <a href={p.link} className="text-accent font-bold underline truncate">
                  magic link
                </a>
                <button className={btnGhost} onClick={() => navigator.clipboard.writeText(p.link)}>
                  Copy
                </button>
              </span>
            )}
            {p.linkUsed === true && <span className="text-ink-soft">link used</span>}
          </div>
        ))}
      </div>
    </MemberProfilePage>
  );
}
