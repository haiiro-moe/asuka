import { useState, useEffect } from "react";
import { DiscordMarkdown } from "./DiscordMarkdown.tsx";

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

/** Parse an existing payload back into editor state. */
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
    accentHex: intToHex(container.accent_color ?? 0x5865f2),
    blocks: blocks.length ? blocks : [{ kind: "text", content: "Hello!" }],
  };
}

const btnCls = "comic-btn comic-btn--ghost px-2 py-1 text-sm";

export function ComponentsEditor({
  value,
  onChange,
}: {
  value: unknown[];
  onChange: (payload: unknown[]) => void;
}) {
  const initial = deserialize(value);
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

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      {/* Editor column */}
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <label className="text-sm text-ink-soft font-bold">Accent</label>
          <input
            type="color"
            value={accentHex}
            onChange={(e) => setAccentHex(e.target.value)}
            className="h-8 w-12 bg-transparent"
          />
        </div>

        {blocks.map((b, i) => (
          <div key={i} className="rounded-lg border-2 border-black/25 bg-white/50 p-2 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs uppercase tracking-wide text-ink-soft font-bold">{b.kind}</span>
              <div className="flex gap-1">
                <button className={btnCls} onClick={() => move(i, -1)}>↑</button>
                <button className={btnCls} onClick={() => move(i, 1)}>↓</button>
                <button className={btnCls} onClick={() => remove(i)}>✕</button>
              </div>
            </div>
            {b.kind === "text" && (
              <textarea
                className="comic-input w-full p-2 text-sm"
                rows={2}
                value={b.content}
                onChange={(e) => update(i, { content: e.target.value })}
                placeholder="Markdown supported…"
              />
            )}
            {b.kind === "image" && (
              <input
                className="comic-input w-full p-2 text-sm"
                value={b.url}
                onChange={(e) => update(i, { url: e.target.value })}
                placeholder="Image URL (https://…)"
              />
            )}
            {b.kind === "button" && (
              <div className="flex gap-2">
                <input
                  className="comic-input flex-1 p-2 text-sm"
                  value={b.label}
                  onChange={(e) => update(i, { label: e.target.value })}
                  placeholder="Label"
                />
                <input
                  className="comic-input flex-1 p-2 text-sm"
                  value={b.url}
                  onChange={(e) => update(i, { url: e.target.value })}
                  placeholder="https://…"
                />
              </div>
            )}
          </div>
        ))}

        <div className="flex gap-2">
          <button className={btnCls} onClick={() => setBlocks((b) => [...b, { kind: "text", content: "" }])}>
            + Text
          </button>
          <button className={btnCls} onClick={() => setBlocks((b) => [...b, { kind: "separator" }])}>
            + Separator
          </button>
          <button className={btnCls} onClick={() => setBlocks((b) => [...b, { kind: "image", url: "" }])}>
            + Image
          </button>
          <button
            className={btnCls}
            onClick={() => setBlocks((b) => [...b, { kind: "button", label: "Link", url: "" }])}
          >
            + Button
          </button>
        </div>
      </div>

      {/* Live preview column */}
      <div>
        <div className="text-sm text-ink-soft font-bold mb-2">Preview</div>
        {/* Deliberately dark: previews how the message looks inside Discord. */}
        <div
          className="rounded-md bg-[#313338] text-slate-200 p-3 space-y-2 border-2 border-black"
          style={{ borderLeft: `4px solid ${accentHex}` }}
        >
          {blocks.map((b, i) => {
            if (b.kind === "text")
              return b.content ? (
                <DiscordMarkdown key={i} content={b.content} />
              ) : (
                <div key={i} className="text-slate-600 text-sm">empty text</div>
              );
            if (b.kind === "separator") return <hr key={i} className="border-slate-600" />;
            if (b.kind === "image")
              return b.url ? (
                <img key={i} src={b.url} className="max-w-full rounded" alt="" />
              ) : (
                <div key={i} className="text-slate-600 text-sm">empty image</div>
              );
            return (
              <a
                key={i}
                href={b.url || undefined}
                target="_blank"
                className="inline-block px-3 py-1 mr-2 rounded bg-slate-600 text-sm no-underline text-white"
              >
                {b.label || "Link"}
              </a>
            );
          })}
        </div>
      </div>
    </div>
  );
}
