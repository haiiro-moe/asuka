import { useEffect, useState } from "react";
import { api } from "./api.ts";
import { useMe } from "./me-context.ts";
import {
  Chip,
  ColourField,
  Empty,
  ErrorLine,
  InkButton,
  InkLink,
  Loading,
  PromptField,
  Saved,
  Swatch,
  Window,
  useAsync,
} from "./ui.ts";
import { MemberProfilePage } from "./MemberProfilePage.tsx";

/**
 * Rename/recolor the member's active custom role, any time, for free.
 *
 * @param props.customRole The active custom role and the store item it came from.
 * @param props.onSaved Called after a successful save so the parent reloads.
 */
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
  const [failed, setFailed] = useState(false);

  // Re-sync the form when a reload brings fresh role data.
  useEffect(() => {
    setName(customRole.name);
    setColor(customRole.color);
  }, [customRole.roleId, customRole.name, customRole.color]);

  const save = async () => {
    setState("saving");
    setMsg(null);
    setFailed(false);
    try {
      await api.updateCustomRole({ roleName: name, roleColor: color });
      setMsg("Saved");
      onSaved();
    } catch (e: any) {
      setFailed(true);
      setMsg(e.message);
    } finally {
      setState("idle");
    }
  };

  return (
    <Window label="fish: ~/custom-role">
      <p className="nar m-0 p-2">
        From “{customRole.itemName}”. Edit the name and colour whenever you like.
      </p>
      <div className="p-2">
        <PromptField label="role name" value={name} onChange={setName} />
        <ColourField label="colour" value={color} onChange={setColor} />
        <p className="m-0 mt-2">
          <span className="kv_label">preview </span>
          <Chip on>
            <Swatch colour={color} /> {name || "…"}
          </Chip>
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-3 p-2">
        <InkButton tone="gold" busy={state === "saving"} busyLabel="saving" onClick={save}>
          save changes
        </InkButton>
        {msg && !failed && <Saved>{msg}</Saved>}
      </div>
      {msg && failed && <ErrorLine>{msg}</ErrorLine>}
    </Window>
  );
}

/**
 * The signed-in member's own profile: character sheet (via {@link MemberProfilePage}) plus the
 * custom role editor and the inventory slotted between the sheet and the roles window.
 */
export function ProfilePage() {
  const me = useMe();
  const { data, reload } = useAsync<any>(() => api.inventory());

  if (!me) return null;
  if (!data) return <Loading>Opening your bag</Loading>;

  const purchases: any[] = data.purchases ?? [];

  return (
    // The inventory + item customization render between the member card's
    // sheet and roles windows, via MemberProfilePage's children slot.
    <MemberProfilePage userId={me.userId}>
      {data.customRole && <CustomRoleEditor customRole={data.customRole} onSaved={reload} />}

      <Window label="fish: ~/inventory">
        {purchases.length === 0 ? (
          <Empty>Nothing yet. Visit the store to spend your {data.balance.toLocaleString()} SC.</Empty>
        ) : (
          <div className="fx-scroll">
            <table className="fx-table">
              <thead>
                <tr>
                  <th>item</th>
                  <th className="r">price</th>
                  <th>bought</th>
                  <th>link</th>
                </tr>
              </thead>
              <tbody>
                {purchases.map((p: any) => (
                  <tr key={p.id}>
                    <td>{p.itemName}</td>
                    <td className="r">{p.price} SC</td>
                    <td>
                      {new Date(p.createdAt * 1000).toLocaleDateString("en-GB", {
                        year: "numeric",
                        month: "short",
                        day: "numeric",
                      })}
                    </td>
                    <td>
                      {p.link && (
                        <span className="inline-flex items-center gap-2">
                          <InkLink tone="foam" href={p.link}>
                            magic link
                          </InkLink>
                          <InkButton tone="muted" onClick={() => navigator.clipboard.writeText(p.link)}>
                            copy
                          </InkButton>
                        </span>
                      )}
                      {p.linkUsed === true && <span className="text-subtle">link used</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Window>
    </MemberProfilePage>
  );
}
