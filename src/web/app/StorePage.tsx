/**
 * The member storefront (`#/store`): the wallet, the items on sale as windows, the purchase forms
 * (custom role, sabotage target) and the receipt of the last purchase.
 *
 * @module
 */
import { useState } from "react";
import { api } from "./api.ts";
import { useNames } from "./names.tsx";
import { useMe } from "./me-context.ts";
import { useAsync } from "./ui.ts";
import {
  ColourField,
  Empty,
  ErrorLine,
  ImageFrame,
  InkButton,
  InkLink,
  Loading,
  PromptField,
  Select,
  SettingRow,
  Window,
  useConfirm,
} from "./ui/index.ts";

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

/** Colour a custom role gets when the buyer does not pick one: the haiiro default accent, pine (D-020). */
const DEFAULT_ROLE_COLOUR = "#31748f";

/** What each item kind is, in the muted caps line under the name. */
const KIND_LABEL: Record<string, string> = {
  panel_access: "one-time panel access",
  role: "role",
  custom_role: "custom role",
  sabotage: "election sabotage",
};

/** A short, path-safe form of an item's name for its window label (`fish: ~/store/night-owl`). */
function slug(name: string, id: number): string {
  const s = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 24)
    .replace(/-+$/, "");
  return s || String(id);
}

/**
 * An item's picture: the image URL in a full-colour square frame, or the emoji shown as data inside
 * the same frame (store icons are user content, so they are never dithered).
 */
function ItemIcon({ item, size = 48 }: { item: any; size?: number }) {
  return item.iconType === "image" ? (
    <ImageFrame src={item.icon} alt="" size={size} />
  ) : (
    <ImageFrame alt="" size={size} className="text-nav">
      {item.icon}
    </ImageFrame>
  );
}

/**
 * The member-facing storefront: browse items and spend SC. Buying asks for a confirmation first; the
 * outcome is told in one line in a window under the wallet.
 */
export function StorePage() {
  const { data, error, reload } = useAsync<StoreData>(() => api.store());
  const me = useMe();
  const name = useNames((data?.election?.candidates ?? []).map((c) => c.userId));
  const { confirm, dialog } = useConfirm();

  // Per-item purchase form state (custom-role fields / sabotage target).
  const [forms, setForms] = useState<Record<number, any>>({});
  const [busy, setBusy] = useState<number | null>(null);
  const [notice, setNotice] = useState<{ kind: "ok" | "error"; text: string; link?: string } | null>(null);

  if (!data) {
    return error ? (
      <Window label="fish: ~/store" tone="love">
        <ErrorLine onRetry={reload}>{error}</ErrorLine>
      </Window>
    ) : (
      <Loading>You count your coins</Loading>
    );
  }

  const form = (id: number) => forms[id] ?? {};
  const setForm = (id: number, patch: any) =>
    setForms((f) => ({ ...f, [id]: { ...form(id), ...patch } }));

  const buy = async (item: any) => {
    const f = form(item.id);
    const ok = await confirm({
      label: "confirm: ~/store/buy",
      title: "buy item",
      message: `Buy "${item.name}" for ${item.price} SC? The coins leave your balance.`,
      confirmLabel: "buy",
      tone: "gold",
    });
    if (!ok) return;
    setBusy(item.id);
    setNotice(null);
    try {
      const res = await api.buyItem(item.id, {
        targetUserId: f.target,
        roleName: f.roleName,
        roleColor: f.roleColor ?? DEFAULT_ROLE_COLOUR,
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
    <>
      <Window label="fish: ~/wallet">
        <div className="kv">
          <span className="kv_label">balance</span>
          <span className="kv_value text-gold">{data.balance.toLocaleString()} SC</span>
        </div>
        <p className="mt-3 text-subtle">
          Magic links open any time, but each one dies after a single submission.
        </p>
        <p className="mt-1 text-subtle">
          Everything you buy waits on your <InkLink tone="foam" href="#/profile">profile</InkLink>, magic
          links included.
        </p>
      </Window>

      {notice && (
        <Window
          label="fish: ~/receipt"
          tone={notice.kind === "error" ? "love" : notice.link ? "gold" : "foam"}
        >
          {notice.kind === "error" ? (
            <ErrorLine onDismiss={() => setNotice(null)}>{notice.text}</ErrorLine>
          ) : (
            <>
              <p className="nar" role="status">
                {notice.text}
              </p>
              {notice.link && (
                <>
                  <p className="mt-3">
                    <InkLink tone="foam" href={notice.link} className="break-all">
                      {notice.link}
                    </InkLink>
                  </p>
                  <p className="mt-3 text-gold">
                    One submission only. The link dies once you hit apply, so copy it somewhere safe.
                  </p>
                </>
              )}
              <div className="btns">
                <InkButton tone="muted" onClick={() => setNotice(null)}>
                  dismiss
                </InkButton>
              </div>
            </>
          )}
        </Window>
      )}

      {data.items.length === 0 ? (
        <Window label="fish: ~/store" tone="off">
          <Empty>Nothing is for sale right now. The shelves are bare, so check back later.</Empty>
        </Window>
      ) : (
        <div className="fx-grid">
          {data.items.map((item) => {
            const f = form(item.id);
            const owned = item.kind === "custom_role" && data.hasCustomRole;
            const caps = [
              KIND_LABEL[item.kind] ?? item.kind,
              item.remainingStock != null && !item.soldOut ? `${item.remainingStock} left` : null,
              item.maxPerUser != null ? `limit ${item.maxPerUser} per member` : null,
            ].filter(Boolean);
            return (
              <Window
                key={item.id}
                label={`fish: ~/store/${slug(item.name, item.id)}`}
                tone={item.soldOut ? "off" : "pine"}
                className="flex flex-col"
                contentClassName="flex flex-1 flex-col [&_.pr]:shrink-0"
              >
                <div className="flex items-start gap-3">
                  <ItemIcon item={item} />
                  <div className="min-w-0 flex-1">
                    <p className="break-words">{item.name}</p>
                    <p className="kv_label mt-1">{caps.join(" · ")}</p>
                  </div>
                  <span className="whitespace-nowrap text-gold">{item.price} SC</span>
                </div>
                {item.description && <p className="mt-3 text-subtle break-words">{item.description}</p>}

                {item.kind === "custom_role" &&
                  (data.hasCustomRole ? (
                    <p className="nar mt-3">
                      You already have a custom role. You can edit it on your profile page.
                    </p>
                  ) : (
                    <div className="mt-3">
                      <PromptField
                        label="role name"
                        promptWidth={22}
                        placeholder="night owl"
                        value={f.roleName ?? ""}
                        onChange={(v) => setForm(item.id, { roleName: v })}
                      />
                      <ColourField
                        label="role colour"
                        promptWidth={22}
                        value={f.roleColor ?? DEFAULT_ROLE_COLOUR}
                        onChange={(hex) => setForm(item.id, { roleColor: hex })}
                      />
                    </div>
                  ))}

                {item.kind === "sabotage" && !item.soldOut && (
                  <div className="mt-3">
                    <SettingRow label="target" labelId={`sab-${item.id}`}>
                      <Select
                        ariaLabelledBy={`sab-${item.id}`}
                        placeholder="pick a candidate"
                        value={f.target ?? null}
                        onChange={(v) => setForm(item.id, { target: v })}
                        options={candidates.map((c) => ({
                          value: c.userId,
                          label: name(c.userId),
                          meta:
                            [c.silenced && "silenced", c.votingDisabled && "voting disabled"]
                              .filter(Boolean)
                              .join(", ") || undefined,
                        }))}
                      />
                    </SettingRow>
                  </div>
                )}

                <div className="btns mt-auto">
                  {item.soldOut ? (
                    <span className="chip">sold out{item.kind === "sabotage" ? " this election" : ""}</span>
                  ) : (
                    <InkButton
                      tone="gold"
                      busy={busy === item.id}
                      busyLabel="buying"
                      disabled={
                        item.limitReached ||
                        item.price > data.balance ||
                        (item.kind === "sabotage" && !f.target) ||
                        owned
                      }
                      onClick={() => buy(item)}
                    >
                      {item.limitReached
                        ? "limit reached"
                        : owned
                          ? "already owned"
                          : item.price > data.balance
                            ? "not enough SC"
                            : "buy"}
                    </InkButton>
                  )}
                </div>
              </Window>
            );
          })}
        </div>
      )}
      {dialog}
    </>
  );
}
