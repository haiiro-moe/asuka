import { Fragment, type ReactNode } from "react";
import { useNames } from "./names.tsx";

const MENTION_RE = /<@!?(\d+)>/g;

type NameResolver = (id: string) => string;

/** Split plain text on <@id> mentions, rendering each as a resolved-name pill. */
function renderMentions(text: string, resolve: NameResolver, keyPrefix: string): ReactNode[] {
  const out: ReactNode[] = [];
  const re = new RegExp(MENTION_RE);
  let last = 0;
  let idx = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    out.push(
      <span key={`${keyPrefix}-m${idx++}`} className="bg-indigo-500/30 text-indigo-200 rounded px-1">
        @{resolve(m[1]!)}
      </span>,
    );
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

/**
 * Parse a subset of Discord inline markdown (code/bold/underline/strike/
 * italic/spoiler/mentions) into React nodes. Builds elements directly rather
 * than HTML strings, so there's no injection surface regardless of input.
 */
function parseInline(text: string, resolve: NameResolver, keyPrefix = "i"): ReactNode[] {
  const nodes: ReactNode[] = [];
  let buffer = "";
  let i = 0;
  let key = 0;

  const flush = () => {
    if (buffer) {
      nodes.push(...renderMentions(buffer, resolve, `${keyPrefix}-p${key++}`));
      buffer = "";
    }
  };

  const wrap = (delim: string, tag: (children: ReactNode[]) => ReactNode): boolean => {
    const end = text.indexOf(delim, i + delim.length);
    if (end === -1) return false;
    flush();
    const inner = parseInline(text.slice(i + delim.length, end), resolve, `${keyPrefix}-w${key}`);
    nodes.push(<Fragment key={`${keyPrefix}-w${key++}`}>{tag(inner)}</Fragment>);
    i = end + delim.length;
    return true;
  };

  while (i < text.length) {
    const ch = text[i];
    const two = text.slice(i, i + 2);

    if (ch === "`") {
      const end = text.indexOf("`", i + 1);
      if (end !== -1) {
        flush();
        nodes.push(
          <code key={`${keyPrefix}-c${key++}`} className="bg-slate-900 rounded px-1 text-[0.85em]">
            {text.slice(i + 1, end)}
          </code>,
        );
        i = end + 1;
        continue;
      }
    }
    if (two === "**" && wrap("**", (c) => <strong>{c}</strong>)) continue;
    if (two === "__" && wrap("__", (c) => <u>{c}</u>)) continue;
    if (two === "~~" && wrap("~~", (c) => <s>{c}</s>)) continue;
    if (
      two === "||" &&
      wrap("||", (c) => (
        <span className="bg-slate-600 text-slate-600 hover:text-slate-100 rounded px-1 transition cursor-pointer">
          {c}
        </span>
      ))
    )
      continue;
    if (ch === "*" && wrap("*", (c) => <em>{c}</em>)) continue;
    if (ch === "_" && wrap("_", (c) => <em>{c}</em>)) continue;

    buffer += ch;
    i++;
  }
  flush();
  return nodes;
}

type LineKind = "h2" | "h3" | "h4" | "quote" | "list" | "subtext" | "text" | "blank";

function classify(line: string): LineKind {
  if (line.trim() === "") return "blank";
  if (/^###\s+/.test(line)) return "h4";
  if (/^##\s+/.test(line)) return "h3";
  if (/^#\s+/.test(line)) return "h2";
  if (/^-#\s+/.test(line)) return "subtext";
  if (/^>\s?/.test(line)) return "quote";
  if (/^[-*]\s+/.test(line)) return "list";
  return "text";
}

/** Render a non-code segment: headers, blockquotes, bullet lists, paragraphs. */
function renderBlock(content: string, resolve: NameResolver): ReactNode[] {
  const lines = content.split("\n");
  const blocks: ReactNode[] = [];
  let i = 0;
  let key = 0;

  while (i < lines.length) {
    const kind = classify(lines[i]!);

    if (kind === "blank") {
      i++;
      continue;
    }

    if (kind === "h2" || kind === "h3" || kind === "h4") {
      const text = lines[i]!.replace(/^#{1,3}\s+/, "");
      const Tag = kind;
      const cls =
        kind === "h2" ? "text-xl font-bold" : kind === "h3" ? "text-lg font-bold" : "text-base font-bold";
      blocks.push(
        <Tag key={`b${key}`} className={cls}>
          {parseInline(text, resolve, `h${key++}`)}
        </Tag>,
      );
      i++;
      continue;
    }

    if (kind === "subtext") {
      const text = lines[i]!.replace(/^-#\s+/, "");
      blocks.push(
        <div key={`b${key}`} className="text-slate-400 text-xs">
          {parseInline(text, resolve, `s${key++}`)}
        </div>,
      );
      i++;
      continue;
    }

    if (kind === "quote") {
      const group: string[] = [];
      while (i < lines.length && classify(lines[i]!) === "quote") {
        group.push(lines[i]!.replace(/^>\s?/, ""));
        i++;
      }
      blocks.push(
        <blockquote key={`b${key}`} className="border-l-2 border-slate-500 pl-2 text-slate-300">
          {group.map((l, idx) => (
            <Fragment key={idx}>
              {idx > 0 && <br />}
              {parseInline(l, resolve, `q${key}-${idx}`)}
            </Fragment>
          ))}
        </blockquote>,
      );
      key++;
      continue;
    }

    if (kind === "list") {
      const items: string[] = [];
      while (i < lines.length && classify(lines[i]!) === "list") {
        items.push(lines[i]!.replace(/^[-*]\s+/, ""));
        i++;
      }
      blocks.push(
        <ul key={`b${key}`} className="list-disc pl-5">
          {items.map((l, idx) => (
            <li key={idx}>{parseInline(l, resolve, `l${key}-${idx}`)}</li>
          ))}
        </ul>,
      );
      key++;
      continue;
    }

    // Plain paragraph: consecutive text lines joined with <br/>, like Discord.
    const group: string[] = [];
    while (i < lines.length && classify(lines[i]!) === "text") {
      group.push(lines[i]!);
      i++;
    }
    blocks.push(
      <p key={`b${key}`}>
        {group.map((l, idx) => (
          <Fragment key={idx}>
            {idx > 0 && <br />}
            {parseInline(l, resolve, `p${key}-${idx}`)}
          </Fragment>
        ))}
      </p>,
    );
    key++;
  }

  return blocks;
}

/** Render a Components V2 text block's content with Discord-flavored markdown. */
export function DiscordMarkdown({ content }: { content: string }) {
  const mentionIds = [...content.matchAll(new RegExp(MENTION_RE))].map((m) => m[1]!);
  const resolve = useNames(mentionIds);

  // Fenced code blocks are split out first and rendered verbatim; everything
  // else goes through the block/inline markdown parser above.
  const segments = content.split(/```([\s\S]*?)```/);

  return (
    <div className="text-sm space-y-1">
      {segments.map((seg, idx) =>
        idx % 2 === 1 ? (
          <pre key={idx} className="bg-slate-900 rounded p-2 overflow-x-auto text-xs">
            <code>{seg}</code>
          </pre>
        ) : (
          <Fragment key={idx}>{renderBlock(seg, resolve)}</Fragment>
        ),
      )}
    </div>
  );
}
