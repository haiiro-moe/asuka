/**
 * The admin editor of the SC storefront's catalogue (`#/store-items`): the item list and the
 * create/edit form.
 *
 * @module
 */
import { useState } from "react";
import { api } from "./api.ts";
import { useAsync } from "./ui.ts";
import {
  Chip,
  Empty,
  ErrorLine,
  Heading,
  ImageFrame,
  InkButton,
  Loading,
  PromptField,
  Select,
  SettingRow,
  Toggle,
  Window,
  useConfirm,
} from "./ui/index.ts";

const KIND_OPTIONS = [
  { value: "panel_access", label: "magic link panel" },
  { value: "role", label: "existing role" },
  { value: "custom_role", label: "custom role" },
  { value: "sabotage", label: "election sabotage" },
];

const SABOTAGE_OPTIONS = [
  { value: "disable_voting", label: "disable voting" },
  { value: "cut_votes", label: "cut votes" },
  { value: "silence", label: "silence" },
];

const ICON_OPTIONS = [
  { value: "emoji", label: "emoji" },
  { value: "image", label: "image url" },
];

const PANEL_OPTIONS = [
  { value: "theme", label: "server theme" },
  { value: "autoreply", label: "auto-reply" },
  { value: "botmessage", label: "bot message" },
];

/** A new, empty item with the editor's defaults. */
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

/** The picture of an item in the list: its image URL, or the emoji as data, in the same square frame. */
function ItemIcon({ item }: { item: any }) {
  return item.iconType === "image" ? (
    <ImageFrame src={item.icon} alt="" size={32} />
  ) : (
    <ImageFrame alt="" size={32} className="text-body">
      {item.icon}
    </ImageFrame>
  );
}

/** What an item does, in one muted line: kind, target, price and limits (readable labels; stored values unchanged). */
function itemSummary(item: any): string {
  const sabotage = String(item.sabotageType).replace(/_/g, " ");
  const kind =
    item.kind === "panel_access"
      ? `panel access: ${item.panel}${item.messageKey ? `:${item.messageKey}` : ""}`
      : item.kind === "sabotage"
        ? `sabotage: ${sabotage}${
            item.sabotageType === "cut_votes"
              ? ` ${item.sabotagePercent}%`
              : item.sabotageType === "silence"
                ? ` for ${item.sabotageDays}d`
                : ` ${item.sabotageDays}d`
          }`
        : String(item.kind).replace(/_/g, " ");
  return [
    kind,
    `${item.price} SC`,
    item.maxPerUser != null ? `max ${item.maxPerUser}/user` : null,
    item.stock != null ? `stock ${item.stock}` : null,
  ]
    .filter(Boolean)
    .join(" · ");
}

/** Admin-only editor for the SC storefront's catalogue. */
export function StoreItemsPage() {
  const { data, reload } = useAsync(() => api.storeItems());
  const botMessages = useAsync(() => api.botMessages());
  const [editing, setEditing] = useState<any | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { confirm, dialog } = useConfirm();

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
      <Window
        label={`vim: ~/store/items/${editing.id ? editing.id : "new"}`}
        foot={<span>saves to the store catalogue</span>}
        contentClassName="[&_.pr]:shrink-0"
      >
        <Heading first>item</Heading>
        <PromptField label="name" promptWidth={26} value={editing.name} onChange={(v) => set({ name: v })} />
        <PromptField
          label="price"
          promptWidth={26}
          type="number"
          min={0}
          hint="in SC"
          value={String(editing.price)}
          onChange={(v) => set({ price: Number(v) })}
        />
        <PromptField
          label="description"
          promptWidth={26}
          value={editing.description}
          onChange={(v) => set({ description: v })}
        />

        <Heading>icon</Heading>
        <SettingRow label="icon type" labelId="si-icon-type">
          <Select
            ariaLabelledBy="si-icon-type"
            options={ICON_OPTIONS}
            value={editing.iconType}
            onChange={(v) => set({ iconType: v })}
          />
        </SettingRow>
        <PromptField
          label={editing.iconType === "image" ? "image url" : "emoji"}
          promptWidth={26}
          value={editing.icon}
          placeholder={editing.iconType === "image" ? "https://…/icon.png" : "paste an emoji"}
          onChange={(v) => set({ icon: v })}
        />

        <Heading>kind</Heading>
        <SettingRow label="item type" labelId="si-kind" description="a custom role lets the buyer pick its name and colour">
          <Select
            ariaLabelledBy="si-kind"
            options={KIND_OPTIONS}
            value={editing.kind}
            onChange={(v) => set({ kind: v })}
          />
        </SettingRow>

        {editing.kind === "panel_access" && (
          <SettingRow label="panel" labelId="si-panel" description="what the magic link opens">
            <Select
              ariaLabelledBy="si-panel"
              options={PANEL_OPTIONS}
              value={editing.panel ?? "theme"}
              onChange={(v) => set({ panel: v })}
            />
          </SettingRow>
        )}

        {editing.kind === "panel_access" && editing.panel === "botmessage" && (
          <SettingRow label="bot message" labelId="si-message" description="the message the link rewrites once">
            <Select
              ariaLabelledBy="si-message"
              placeholder="pick a message"
              value={editing.messageKey || null}
              onChange={(v) => set({ messageKey: v })}
              options={(botMessages.data?.messages ?? []).map((m: any) => ({ value: m.key, label: m.label }))}
            />
          </SettingRow>
        )}

        {editing.kind === "role" && (
          <PromptField
            label="role id"
            promptWidth={26}
            hint="the role to grant"
            value={editing.roleId ?? ""}
            placeholder="123456789012345678"
            onChange={(v) => set({ roleId: v })}
          />
        )}

        {editing.kind === "custom_role" && (
          <>
            <PromptField
              label="anchor role id"
              promptWidth={26}
              hint="optional"
              value={editing.anchorRoleId ?? ""}
              placeholder="123456789012345678"
              onChange={(v) => set({ anchorRoleId: v })}
            />
            <p className="nar mt-2">
              Bought roles sit directly below the anchor role, so their colour still shows on names. Each
              member can hold one active custom role, editable from their profile page.
            </p>
          </>
        )}

        {editing.kind === "sabotage" && (
          <>
            <SettingRow label="sabotage effect" labelId="si-sabotage" description="disable voting and silence last X days, cut votes takes X percent">
              <Select
                ariaLabelledBy="si-sabotage"
                options={SABOTAGE_OPTIONS}
                value={editing.sabotageType ?? "disable_voting"}
                onChange={(v) => set({ sabotageType: v })}
              />
            </SettingRow>
            {editing.sabotageType === "cut_votes" ? (
              <PromptField
                label="cut votes by"
                promptWidth={26}
                type="number"
                min={1}
                max={100}
                hint="percent, 1 to 100"
                value={String(editing.sabotagePercent ?? 25)}
                onChange={(v) => set({ sabotagePercent: Number(v) })}
              />
            ) : (
              <PromptField
                label="duration"
                promptWidth={26}
                type="number"
                min={1}
                max={30}
                hint="days, 1 to 30"
                value={String(editing.sabotageDays ?? 3)}
                onChange={(v) => set({ sabotageDays: Number(v) })}
              />
            )}
            <p className="nar mt-2">
              Sabotage items only show in the store while an election is open, and each can be bought once
              per election.
            </p>
          </>
        )}

        <Heading>limits</Heading>
        <PromptField
          label="max per user"
          promptWidth={26}
          type="number"
          min={1}
          hint="blank means unlimited"
          value={String(editing.maxPerUser ?? "")}
          onChange={(v) => set({ maxPerUser: v })}
        />
        <PromptField
          label="global stock"
          promptWidth={26}
          type="number"
          min={1}
          hint="blank means unlimited"
          value={String(editing.stock ?? "")}
          onChange={(v) => set({ stock: v })}
        />
        <Toggle
          label="enabled"
          description="visible in the store"
          checked={!!editing.enabled}
          onChange={(next) => set({ enabled: next ? 1 : 0 })}
        />

        {error && <ErrorLine>{error}</ErrorLine>}
        <div className="btns">
          <InkButton tone="gold" onClick={save}>
            save
          </InkButton>
          <InkButton tone="muted" onClick={() => setEditing(null)}>
            cancel
          </InkButton>
        </div>
      </Window>
    );
  }

  return (
    <>
      <Window label="fish: ~/store/items" foot={<span>{(data ?? []).length} items</span>}>
        <div className="btns pt-0">
          <InkButton tone="gold" onClick={() => setEditing(blankItem())}>
            new item
          </InkButton>
        </div>
        {!data ? (
          <Loading>You walk the shelves</Loading>
        ) : data.length === 0 ? (
          <Empty>No items yet. The shelves are bare, so stock the first one.</Empty>
        ) : (
          <div className="fx-feed">
            {data.map((item: any) => (
              <div key={item.id} className="li flex-wrap items-center">
                <ItemIcon item={item} />
                <span className="txt">
                  <span className="break-words">
                    {item.name} {!item.enabled && <Chip>disabled</Chip>}
                  </span>
                  <span className="sub break-words">{itemSummary(item)}</span>
                </span>
                <span className="flex gap-2">
                  <InkButton tone="flat" onClick={() => setEditing({ ...item })}>
                    edit
                  </InkButton>
                  <InkButton
                    tone="love"
                    onClick={async () => {
                      const ok = await confirm({
                        label: "confirm: ~/store/items/delete",
                        title: "delete store item",
                        message: `Delete "${item.name}"? It leaves the shelf for good.`,
                        confirmLabel: "delete",
                      });
                      if (!ok) return;
                      await api.deleteStoreItem(item.id);
                      reload();
                    }}
                  >
                    delete
                  </InkButton>
                </span>
              </div>
            ))}
          </div>
        )}
      </Window>
      {dialog}
    </>
  );
}
