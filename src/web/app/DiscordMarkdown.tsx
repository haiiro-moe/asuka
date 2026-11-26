/**
 * Discord-flavoured markdown for previews (bot message editor, events, club announcements), drawn with
 * haiiro tokens: Discord's structure, haiiro's colours and type.
 *
 * @module
 */
import { Fragment, useState, type ReactNode } from "react";
import { useNames } from "./names.tsx";

const MENTION_RE = /<@!?(\d+)>/g;

type NameResolver = (id: string) => string;

/** Split plain text on <@id> mentions, rendering each resolved name as text on a pine band. */
function renderMentions(text: string, resolve: NameResolver, keyPrefix: string): ReactNode[] {
  const out: ReactNode[] = [];
  const re = new RegExp(MENTION_RE);
  let last = 0;
  let idx = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    out.push(
      <span key={`${keyPrefix}-m${idx++}`} className="bg-pine text-text px-[0.5ch]">
        @{resolve(m[1]!)}
      </span>,
    );
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

/**
 * A `||spoiler||`: hidden under the system's dither veil until clicked (or Enter/Space), then shown on
 * an overlay band. No fade: it is either covered or not.
 */
function Spoiler({ children }: { children: ReactNode }) {
  const [shown, setShown] = useState(false);
  if (shown) return <span className="bg-overlay px-[0.5ch]">{children}</span>;
  const reveal = () => setShown(true);
  return (
    <span
      role="button"
      tabIndex={0}
      aria-label="spoiler, press to reveal"
      title="spoiler"
      className="dith inline px-[0.5ch] cursor-pointer [color:transparent] select-none"
      onClick={reveal}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          reveal();
        }
      }}
    >
      <span aria-hidden="true">{children}</span>
    </span>
  );
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
          <code key={`${keyPrefix}-c${key++}`} className="bg-base border border-ink-hairline px-[0.5ch]">
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
    if (two === "||" && wrap("||", (c) => <Spoiler>{c}</Spoiler>)) continue;
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

/**
 * Heading looks on the VGA grid (crisp at 16 and 32px only): `#` 32px bold, `##` foam bold (the
 * in-window heading job, as in the approved editor preview), `###` bold. `text-body` sets the size;
 * `text-base` would be the base colour.
 */
const HEADING_CLASS: Record<"h2" | "h3" | "h4", string> = {
  h2: "text-nav font-bold text-text",
  h3: "text-body font-bold text-foam",
  h4: "text-body font-bold text-text",
};

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
      blocks.push(
        <Tag key={`b${key}`} className={`m-0 ${HEADING_CLASS[kind]}`}>
          {parseInline(text, resolve, `h${key++}`)}
        </Tag>,
      );
      i++;
      continue;
    }

    if (kind === "subtext") {
      const text = lines[i]!.replace(/^-#\s+/, "");
      blocks.push(
        <div key={`b${key}`} className="text-label text-subtle">
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
        <blockquote key={`b${key}`} className="m-0 border-l-4 border-muted pl-[1ch]">
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
        <ul key={`b${key}`} className="m-0 list-disc pl-[3ch]">
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
      <p key={`b${key}`} className="m-0">
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

/**
 * Render a Components V2 text block's content with Discord-flavoured markdown: headings, `-#` subtext,
 * quotes (4px muted bar), bullet lists, fenced and inline code (on base with a hairline), bold,
 * underline, strike, italic, spoilers (dither veil, click to reveal) and `<@id>` mentions (resolved
 * names on a pine band). Emoji in the content are data and stay as written.
 */
export function DiscordMarkdown({ content }: { content: string }) {
  const mentionIds = [...content.matchAll(new RegExp(MENTION_RE))].map((m) => m[1]!);
  const resolve = useNames(mentionIds);

  // Fenced code blocks are split out first and rendered verbatim; everything
  // else goes through the block/inline markdown parser above.
  const segments = content.split(/```([\s\S]*?)```/);

  return (
    <div className="text-body space-y-1 [overflow-wrap:anywhere]">
      {segments.map((seg, idx) =>
        idx % 2 === 1 ? (
          <pre key={idx} className="m-0 bg-base border border-ink-hairline px-[1ch] py-1 overflow-x-auto">
            <code>{seg}</code>
          </pre>
        ) : (
          <Fragment key={idx}>{renderBlock(seg, resolve)}</Fragment>
        ),
      )}
    </div>
  );
}
