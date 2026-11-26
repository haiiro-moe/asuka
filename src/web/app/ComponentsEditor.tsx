/**
 * The Components V2 message editor: a friendly block list (text, separator, image, link button) over
 * the payload JSON, an accent picker, and a live preview that keeps Discord's layout drawn in haiiro.
 * Used by the bot message editor, auto-replies, store panels and club announcements.
 *
 * @module
 */
import { useEffect, useId, useState, type ReactNode } from "react";
import { DiscordMarkdown } from "./DiscordMarkdown.tsx";
import {
  Badge,
  ColourField,
  COLOUR_PRESETS,
  Empty,
  Heading,
  ImageFrame,
  InkButton,
  InkLink,
  PromptField,
  TextArea,
  Window,
  cx,
  normaliseHex,
  type ColourPreset,
} from "./ui.ts";

/** Editor block model (a friendly abstraction over Components V2 JSON). */
type Block =
  | { kind: "text"; content: string }
  | { kind: "separator" }
  | { kind: "image"; url: string }
  | { kind: "button"; label: string; url: string };

const COMPONENT_TYPE = {
  ACTION_ROW: 1,
  BUTTON: 2,
  TEXT: 10,
  MEDIA_GALLERY: 12,
  SEPARATOR: 14,
  CONTAINER: 17,
};

function hexToInt(hex: string): number {
  return parseInt(hex.replace("#", ""), 16) || 0;
}
function intToHex(n: number): string {
  return "#" + (n & 0xffffff).toString(16).padStart(6, "0");
}

/**
 * Reads a palette token's current `#rrggbb` from the page (`--color-<name>`), so no colour is written
 * twice. Null outside a browser or when the token is missing.
 */
function tokenHex(name: ColourPreset): string | null {
  if (typeof document === "undefined") return null;
  return normaliseHex(getComputedStyle(document.documentElement).getPropertyValue(`--color-${name}`));
}

/** The accent a payload without one gets: pine, the `Accent.primary` job (D-008). */
function defaultAccentHex(): string {
  return tokenHex("pine") ?? intToHex(0);
}

/** Serialize editor state into a Components V2 top-level payload array. */
export function serialize(accentHex: string, blocks: Block[]): unknown[] {
  const children: any[] = [];
  const buttons: any[] = [];
  for (const b of blocks) {
    if (b.kind === "text") children.push({ type: COMPONENT_TYPE.TEXT, content: b.content });
    else if (b.kind === "separator")
      children.push({ type: COMPONENT_TYPE.SEPARATOR, divider: true, spacing: 1 });
    else if (b.kind === "image" && b.url)
      children.push({
        type: COMPONENT_TYPE.MEDIA_GALLERY,
        items: [{ media: { url: b.url } }],
      });
    else if (b.kind === "button" && b.url)
      buttons.push({ type: COMPONENT_TYPE.BUTTON, style: 5, label: b.label, url: b.url });
  }
  if (buttons.length) children.push({ type: COMPONENT_TYPE.ACTION_ROW, components: buttons });
  return [{ type: COMPONENT_TYPE.CONTAINER, accent_color: hexToInt(accentHex), components: children }];
}

/**
 * Parse an existing payload back into editor state. A container without an accent gets pine; an empty
 * one gets a single starter text block.
 */
export function deserialize(payload: unknown[]): { accentHex: string; blocks: Block[] } {
  const container = (payload?.[0] as any) ?? {};
  const blocks: Block[] = [];
  for (const c of container.components ?? []) {
    if (c.type === COMPONENT_TYPE.TEXT) blocks.push({ kind: "text", content: c.content ?? "" });
    else if (c.type === COMPONENT_TYPE.SEPARATOR) blocks.push({ kind: "separator" });
    else if (c.type === COMPONENT_TYPE.MEDIA_GALLERY)
      for (const item of c.items ?? [])
        blocks.push({ kind: "image", url: item?.media?.url ?? "" });
    else if (c.type === COMPONENT_TYPE.ACTION_ROW)
      for (const btn of c.components ?? [])
        blocks.push({ kind: "button", label: btn.label ?? "", url: btn.url ?? "" });
  }
  return {
    accentHex: container.accent_color != null ? intToHex(container.accent_color) : defaultAccentHex(),
    blocks: blocks.length ? blocks : [{ kind: "text", content: "Hello." }],
  };
}

/* ------------------------------------------------------------------------------------------------ */

/** Props of {@link AccentPicker}. */
interface AccentPickerProps {
  value: string;
  onChange: (hex: string) => void;
}

/**
 * The container's accent stripe: six palette chips (pine, foam, gold, love, iris, rose) as a radio
 * group, and the hex itself in a typed colour field, so a custom colour an older message already has
 * stays visible and editable.
 */
function AccentPicker({ value, onChange }: AccentPickerProps) {
  const [tokens, setTokens] = useState<Partial<Record<ColourPreset, string | null>>>({});
  useEffect(() => setTokens(Object.fromEntries(COLOUR_PRESETS.map((p) => [p, tokenHex(p)]))), []);
  const labelId = useId();
  const current = normaliseHex(value);
  const custom = current != null && !COLOUR_PRESETS.some((p) => tokens[p] === current);
  return (
    <>
      {/* a SettingRow squeezes six chips on phones, so the chips wrap under the name here */}
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2 px-2 pt-1">
        <span id={labelId}>colour</span>
        <span className="inline-flex flex-wrap gap-2" role="radiogroup" aria-labelledby={labelId}>
          {COLOUR_PRESETS.map((p) => {
            const hex = tokens[p];
            const on = hex != null && hex === current;
            return (
              <button
                key={p}
                type="button"
                role="radio"
                aria-checked={on}
                disabled={!hex}
                className={cx("chip", on && "on")}
                onClick={() => hex && onChange(hex)}
              >
                {p}
              </button>
            );
          })}
        </span>
      </div>
      <p className="px-2 pt-1 text-label text-subtle">
        {custom ? "A custom colour. Pick a palette colour to replace it." : "The stripe down the left of the message."}
      </p>
      <ColourField
        label="hex"
        value={value}
        onChange={onChange}
        presets={false}
        promptWidth={10}
        hint="Palette colours only. Custom hex stays allowed for old messages."
      />
    </>
  );
}

/** What each block kind is called in the editor. */
const KIND_LABEL: Record<Block["kind"], string> = {
  text: "text",
  separator: "separator",
  image: "image",
  button: "link button",
};

/* ------------------------------------------------------------------------------------------------ */

/** Props of {@link MessagePreview}. */
interface MessagePreviewProps {
  accentHex: string;
  blocks: Block[];
}

/** `today 18:04`, the time stamp a message sent now would carry. */
function nowStamp(): string {
  return `today ${new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false })}`;
}

/**
 * The message as Discord lays it out, drawn with haiiro tokens (D-004): the bot's name line, then the
 * container on base with a hairline and a 4px accent stripe in the message's own colour (data, so it
 * stays dynamic), its blocks in order, and the link buttons in one row at the end, where Discord puts
 * the action row.
 */
function MessagePreview({ accentHex, blocks }: MessagePreviewProps) {
  const buttons = blocks.filter((b): b is Extract<Block, { kind: "button" }> => b.kind === "button");
  const body = blocks.filter((b) => b.kind !== "button");
  return (
    <Window tone="foam" label="preview: discord">
      <div className="flex gap-3 py-2 px-1">
        <ImageFrame alt="" size={40} />
        <div className="flex flex-col gap-1.5 min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <b>asuka</b>
            <Badge>bot</Badge>
            <span className="text-label text-subtle">{nowStamp()}</span>
          </div>
          <div className="flex border border-ink-hairline bg-base max-w-[460px] min-w-0">
            <span className="w-1 flex-none" style={{ background: accentHex }} aria-hidden="true" />
            <div className="flex flex-col gap-1.5 px-3 py-2.5 min-w-0 flex-1">
              {blocks.length === 0 && <Empty>Nothing to send yet. Add a block.</Empty>}
              {body.map((b, i) => {
                if (b.kind === "text")
                  return b.content ? (
                    <DiscordMarkdown key={i} content={b.content} />
                  ) : (
                    <span key={i} className="text-label text-subtle">
                      empty text
                    </span>
                  );
                if (b.kind === "separator")
                  return <hr key={i} className="m-0 w-full border-0 border-t border-ink-hairline" />;
                if (b.kind === "image")
                  return b.url ? (
                    <img key={i} src={b.url} className="block max-w-full border border-ink-muted" alt="" />
                  ) : (
                    <span key={i} className="text-label text-subtle">
                      empty image
                    </span>
                  );
                return null;
              })}
              {buttons.length > 0 && (
                <div className="flex flex-wrap gap-2 pt-1">
                  {buttons.map((b, i) => (
                    <InkLink
                      key={i}
                      tone="muted"
                      href={b.url || undefined}
                      target="_blank"
                      rel="noreferrer noopener"
                    >
                      {b.label || "Link"}
                    </InkLink>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </Window>
  );
}

/* ------------------------------------------------------------------------------------------------ */

/** The two parts {@link ComponentsEditor} renders, for callers that place them in their own layout. */
export interface ComponentsEditorParts {
  /** The accent picker and the block list with its add buttons (no window of its own). */
  editor: ReactNode;
  /** The live preview, in a foam window labelled `preview: discord`. */
  preview: ReactNode;
}

/** Props of {@link ComponentsEditor}. */
export interface ComponentsEditorProps {
  /** The initial payload. The editor owns its state after mount; remount (change `key`) to load another. */
  value: unknown[];
  /** Called with the serialized payload on mount and after every change. */
  onChange: (payload: unknown[]) => void;
  /**
   * Places the editor and the preview. Default: two columns that wrap to one on narrow screens.
   * The bot message editor uses it to put the preview in a window beside its own.
   */
  layout?: (parts: ComponentsEditorParts) => ReactNode;
}

/** The default placement: editor and preview side by side, stacked when there is no room. */
function defaultLayout({ editor, preview }: ComponentsEditorParts): ReactNode {
  return (
    <div className="flex flex-wrap items-start gap-6">
      <div className="flex-[1_1_320px] min-w-0">{editor}</div>
      <div className="flex-[1_1_320px] min-w-0">{preview}</div>
    </div>
  );
}

/**
 * Edits one Components V2 container as a list of blocks: text (Discord markdown), separator, image and
 * link button. Blocks move with `↑ ↓` and go with `×`; the accent is a palette chip or a hex. Every
 * change is serialized and passed to `onChange`, and the preview follows live.
 */
export function ComponentsEditor({ value, onChange, layout = defaultLayout }: ComponentsEditorProps) {
  const [initial] = useState(() => deserialize(value));
  const [accentHex, setAccentHex] = useState(initial.accentHex);
  const [blocks, setBlocks] = useState<Block[]>(initial.blocks);

  useEffect(() => {
    onChange(serialize(accentHex, blocks));
  }, [accentHex, blocks]);

  const update = (i: number, patch: Partial<Block>) =>
    setBlocks((bs) => bs.map((b, idx) => (idx === i ? ({ ...b, ...patch } as Block) : b)));
  const remove = (i: number) => setBlocks((bs) => bs.filter((_, idx) => idx !== i));
  const move = (i: number, dir: -1 | 1) =>
    setBlocks((bs) => {
      const next = [...bs];
      const j = i + dir;
      if (j < 0 || j >= next.length) return bs;
      [next[i], next[j]] = [next[j]!, next[i]!];
      return next;
    });
  const add = (b: Block) => setBlocks((bs) => [...bs, b]);

  const editor = (
    <div className="min-w-0">
      <Heading first>accent</Heading>
      <AccentPicker value={accentHex} onChange={setAccentHex} />

      <Heading>blocks</Heading>
      {blocks.length === 0 && <Empty className="px-2">No blocks yet. Add one below.</Empty>}
      <ol className="m-0 p-0 list-none">
        {blocks.map((b, i) => {
          const n = i + 1;
          const name = `${KIND_LABEL[b.kind]} block ${n}`;
          return (
            <li key={i} className="border-t border-ink-hairline py-2" aria-label={name}>
              <div className="flex items-center gap-2 px-2 pb-1">
                <span className="text-subtle">{String(n).padStart(2, "0")}</span>
                <span className="c7 flex-1 min-w-0">{KIND_LABEL[b.kind]}</span>
                <InkButton tone="flat" aria-label={`move ${name} up`} title="move up" disabled={i === 0} onClick={() => move(i, -1)}>
                  ↑
                </InkButton>
                <InkButton
                  tone="flat"
                  aria-label={`move ${name} down`}
                  title="move down"
                  disabled={i === blocks.length - 1}
                  onClick={() => move(i, 1)}
                >
                  ↓
                </InkButton>
                <InkButton tone="flat" aria-label={`remove ${name}`} title="remove" onClick={() => remove(i)}>
                  ×
                </InkButton>
              </div>
              {b.kind === "text" && (
                <TextArea
                  ariaLabel={name}
                  rows={3}
                  value={b.content}
                  onChange={(content) => update(i, { content })}
                  placeholder="Markdown works here: **bold**, ## heading, ||spoiler||"
                  className="px-2"
                />
              )}
              {b.kind === "separator" && <p className="px-2 text-label text-subtle">A divider line across the message.</p>}
              {b.kind === "image" && (
                <PromptField
                  label="image url"
                  value={b.url}
                  onChange={(url) => update(i, { url })}
                  placeholder="https://…"
                  inputMode="url"
                  spellCheck={false}
                />
              )}
              {b.kind === "button" && (
                <>
                  <PromptField
                    label="label"
                    promptWidth={14}
                    value={b.label}
                    onChange={(label) => update(i, { label })}
                    placeholder="Label"
                  />
                  <PromptField
                    label="url"
                    promptWidth={14}
                    value={b.url}
                    onChange={(url) => update(i, { url })}
                    placeholder="https://…"
                    inputMode="url"
                    spellCheck={false}
                    hint={b.url ? undefined : "A button without a url is left out."}
                  />
                </>
              )}
            </li>
          );
        })}
      </ol>

      <div className="btns border-t border-ink-hairline" role="group" aria-label="add a block">
        <InkButton tone="flat" onClick={() => add({ kind: "text", content: "" })}>
          + text
        </InkButton>
        <InkButton tone="flat" onClick={() => add({ kind: "separator" })}>
          + separator
        </InkButton>
        <InkButton tone="flat" onClick={() => add({ kind: "image", url: "" })}>
          + image
        </InkButton>
        <InkButton tone="flat" onClick={() => add({ kind: "button", label: "Link", url: "" })}>
          + button
        </InkButton>
      </div>
    </div>
  );

  return <>{layout({ editor, preview: <MessagePreview accentHex={accentHex} blocks={blocks} /> })}</>;
}
