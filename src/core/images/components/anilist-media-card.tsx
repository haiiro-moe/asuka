import type { ReactNode } from "react";
import { fmtDate } from "../util.ts";
import {
  CardFrame,
  Tag,
  ImageFrame,
  KeyValue,
  ProgressBar,
  Rule,
  StillBackdrop,
  Text,
  Title,
  cleanText,
} from "./haiiro/index.ts";
import { mediaStatusTone, scoreTone } from "./anilist-theme.ts";

/** Width of the AniList media card in px. */
export const ANILIST_MEDIA_WIDTH = 900;

/**
 * Props for {@link AniListMediaCard}: one AniList anime or manga entry, already fetched.
 * Text is AniList content and is drawn as given (not lowercased).
 */
export interface AniListMediaCardProps {
  /** Display title (English, else romaji). Long titles drop from Jacquard to two lines of 32px text. */
  title: string;
  /**
   * Meta line joined with `  ·  `, e.g. `TV  ·  12 episodes  ·  Fall 2023  ·  Finished`.
   * The card splits it into chips (format, count), a status row and an aired row.
   */
  metaLine: string;
  /** Synopsis. Markup, spoiler tags and emoji are stripped and the text is cut cleanly at four lines. */
  description: string;
  /** Cover as a PNG/JPEG data URI, or null for the placeholder. Drawn in full colour. */
  coverDataUri: string | null;
  /** Banner as a data URI. Not drawn: the haiiro card has no banner. Kept for the call site. */
  bannerDataUri: string | null;
  /**
   * AniList's per-cover accent colour.
   *
   * @deprecated Unused. It is off-palette, so the card takes every colour from the haiiro
   * tokens (decision D-012). Kept in the type so call sites keep compiling.
   */
  coverColor: string | null;
  /** Average score, 0-100, or null when unrated. */
  averageScore: number | null;
  /** Popularity (number of users with the entry on a list), or null. */
  popularity: number | null;
  /** Favourites count, or null. */
  favourites: number | null;
  /** Genres as given; the first five are shown. */
  genres: string[];
  /** First studio's name, or null. */
  studio: string | null;
  /** The next airing episode (`inDays` is whole days from now, at least 1), or null. */
  nextEpisode: { episode: number; inDays: number } | null;
}

/** Cover box in px (outer, hairline included): 2:3 portrait. */
const COVER_W = 180;
const COVER_H = 270;
/** Content width inside the card frame: 900 - 2x32 backdrop - 2x5 frame - 2x20 padding. */
const CONTENT_W = 786;
/** Width of the text column beside the cover. */
const COL_W = CONTENT_W - COVER_W - 20;
/** Height of the chrome around the content: backdrop 64 + frame 10 + padding 24 + 16. */
const CHROME_H = 64 + 10 + 40;
/** Vertical gap between blocks in the text column. */
const COL_GAP = 8;
/** One 16px text line, and one 32px one, in px. */
const LINE = 18;
const LINE_LARGE = 36;
/** Jacquard 43px title line. */
const LINE_TITLE = 48;
/** Titles up to this many characters stay in Jacquard. */
const TITLE_MAX_CHARS = 24;

/**
 * Width of a string in 8px cells of the card fonts: IBM VGA and narrow Unifont glyphs are
 * one cell, wide (CJK, Hangul, full-width) glyphs two, combining marks none.
 *
 * @param text - Any text.
 * @returns Width in 8px cells at 16px font size.
 */
export function cellWidth(text: string): number {
  let w = 0;
  for (const ch of text) {
    const c = ch.codePointAt(0)!;
    if (c >= 0x300 && c <= 0x36f) continue;
    const wide =
      (c >= 0x1100 && c <= 0x115f) ||
      (c >= 0x2e80 && c <= 0xa4cf) ||
      (c >= 0xac00 && c <= 0xd7a3) ||
      (c >= 0xf900 && c <= 0xfaff) ||
      (c >= 0xfe30 && c <= 0xfe6f) ||
      (c >= 0xff00 && c <= 0xff60) ||
      (c >= 0xffe0 && c <= 0xffe6) ||
      c >= 0x20000;
    w += wide ? 2 : 1;
  }
  return w;
}

/**
 * Clean AniList or Discord-bound prose for a card: removes spoiler blocks, HTML tags and
 * entities, markdown emphasis, links and headings, emoji, and collapses whitespace. The
 * ellipsis becomes three dots so every glyph is one cell wide.
 *
 * @param raw - Raw description.
 * @returns Plain single-line text, possibly empty.
 */
export function cleanBlurb(raw: string | null | undefined): string {
  if (!raw) return "";
  const named: Record<string, string> = {
    amp: "&",
    lt: "<",
    gt: ">",
    quot: '"',
    apos: "'",
    nbsp: " ",
    mdash: "-",
    ndash: "-",
    hellip: "...",
    rsquo: "'",
    lsquo: "'",
    rdquo: '"',
    ldquo: '"',
  };
  const text = raw
    .replace(/~!.*?!~/gs, " ")
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<\/?(p|div|li|ul|ol|h[1-6])[^>]*>/gi, " ")
    .replace(/<[^>]*>/g, "")
    .replace(/&#x([0-9a-f]+);/gi, (_, h: string) => String.fromCodePoint(parseInt(h, 16) || 32))
    .replace(/&#(\d+);/g, (_, d: string) => String.fromCodePoint(parseInt(d, 10) || 32))
    .replace(/&([a-z]+);/gi, (m, n: string) => named[n.toLowerCase()] ?? m)
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/(\*\*|__|~~)/g, "")
    .replace(/(^|\s)[*_]+([^*_]+)[*_]+(?=\s|$)/g, "$1$2")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/…/g, "...");
  return cleanText(text);
}

/**
 * Wrap text onto monospace lines of `cols` cells and cut it cleanly after `maxLines`:
 * the last line ends at a word boundary with `...`, with no dangling punctuation. The card
 * fonts are fixed-width, so the result is exact and the layout height is known up front.
 *
 * @param text - Plain text (see {@link cleanBlurb}).
 * @param cols - Line width in cells.
 * @param maxLines - Most lines to return.
 * @param scale - Cell multiplier: 2 for the 32px face (default 1).
 * @returns The lines, at most `maxLines`; empty for empty text.
 */
export function wrapCells(text: string, cols: number, maxLines: number, scale = 1): string[] {
  const w = (s: string) => cellWidth(s) * scale;
  const words: string[] = [];
  for (const word of text.split(" ").filter(Boolean)) {
    if (w(word) <= cols) {
      words.push(word);
      continue;
    }
    let chunk = "";
    for (const ch of word) {
      if (w(chunk + ch) > cols) {
        words.push(chunk);
        chunk = ch;
      } else chunk += ch;
    }
    if (chunk) words.push(chunk);
  }
  const lines: string[] = [];
  let cur = "";
  for (const word of words) {
    if (!cur) cur = word;
    else if (w(cur) + scale + w(word) <= cols) cur += ` ${word}`;
    else {
      lines.push(cur);
      cur = word;
    }
  }
  if (cur) lines.push(cur);
  if (lines.length <= maxLines) return lines;
  const out = lines.slice(0, maxLines);
  const dots = "...";
  let last = out[maxLines - 1]!;
  while (last && w(last) + w(dots) > cols) {
    const cut = last.lastIndexOf(" ");
    last = cut > 0 ? last.slice(0, cut) : Array.from(last).slice(0, -1).join("");
  }
  out[maxLines - 1] = `${last.replace(/[\s,;:\-]+$/, "")}${dots}`;
  return out;
}

/**
 * Turn a name into the path segment of a notch label: lowercase, letters and digits kept
 * (any script), everything else a single dash, at most 28 characters.
 *
 * @param name - A title or user name.
 * @param fallback - Used when nothing is left.
 * @returns The slug.
 */
export function slugify(name: string, fallback: string): string {
  const slug = cleanText(name)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 28)
    .replace(/-+$/, "");
  return slug || fallback;
}

/** A block of the text column: its element and its exact height in px. */
interface Block {
  el: ReactNode;
  h: number;
}

/** Meta line split into the parts the card shows. */
interface Meta {
  chips: string[];
  status: string | null;
  aired: string | null;
}

const STATUS_WORDS = new Set(["releasing", "finished", "not yet released", "cancelled", "hiatus"]);

/**
 * Split the plugin's `metaLine` back into format and count chips, a status and an aired
 * season. Unknown parts become chips, so a changed meta line never loses information.
 */
function parseMeta(metaLine: string): Meta {
  const meta: Meta = { chips: [], status: null, aired: null };
  for (const raw of metaLine.split("·")) {
    const part = cleanText(raw);
    if (!part) continue;
    const lower = part.toLowerCase();
    if (STATUS_WORDS.has(lower)) meta.status = lower;
    else if (/^(winter|spring|summer|fall)\s+\d{4}$/i.test(part) || /^\d{4}$/.test(part)) meta.aired = lower;
    else meta.chips.push(lower);
  }
  return meta;
}

/** Number with thousands separators. */
function fmtCount(n: number): string {
  return n.toLocaleString("en-US");
}

/**
 * The text blocks beside the cover, top to bottom, each with its exact height.
 */
function columnBlocks(props: AniListMediaCardProps): Block[] {
  const blocks: Block[] = [];
  const title = cleanText(props.title) || "untitled";
  if (cellWidth(title) <= TITLE_MAX_CHARS) {
    blocks.push({
      h: LINE_TITLE,
      el: (
        <div key="title" style={{ display: "flex", width: COL_W, overflow: "hidden" }}>
          <Title truncate>{title}</Title>
        </div>
      ),
    });
  } else {
    const lines = wrapCells(title, COL_W / 8, 2, 2);
    blocks.push({
      h: LINE_LARGE * lines.length,
      el: (
        <div key="title" style={{ display: "flex", flexDirection: "column" }}>
          {lines.map((l, i) => (
            <Text key={i} size="large">
              {l}
            </Text>
          ))}
        </div>
      ),
    });
  }

  const meta = parseMeta(props.metaLine);
  if (meta.chips.length > 0) {
    blocks.push({
      h: LINE + 2,
      el: (
        <div key="chips" style={{ display: "flex", gap: 8 }}>
          {meta.chips.slice(0, 4).map((c) => (
            <Tag key={c}>{c}</Tag>
          ))}
        </div>
      ),
    });
  }

  if (props.averageScore != null) {
    const tone = scoreTone(props.averageScore);
    blocks.push({
      h: LINE + 4 + 10,
      el: (
        <div key="score" style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <KeyValue label="score" value={`${props.averageScore} / 100`} tone={tone} />
          <ProgressBar value={props.averageScore} tone={tone} />
        </div>
      ),
    });
  } else {
    blocks.push({ h: LINE, el: <KeyValue key="score" label="score" value="unrated" tone="subtle" /> });
  }

  if (props.popularity != null || props.favourites != null) {
    blocks.push({
      h: LINE,
      el: (
        <div key="pop" style={{ display: "flex", gap: 24 }}>
          {props.popularity != null ? (
            <KeyValue grow label="popularity" value={fmtCount(props.popularity)} tone="foam" />
          ) : null}
          {props.favourites != null ? (
            <KeyValue grow label="favourites" value={fmtCount(props.favourites)} tone="gold" />
          ) : null}
        </div>
      ),
    });
  }

  if (meta.status || meta.aired) {
    blocks.push({
      h: LINE,
      el: (
        <div key="status" style={{ display: "flex", gap: 24 }}>
          {meta.status ? (
            <KeyValue grow label="status" value={meta.status} tone={mediaStatusTone(meta.status.toUpperCase().replace(/ /g, "_"))} />
          ) : null}
          {meta.aired ? <KeyValue grow label="aired" value={meta.aired} tone="foam" /> : null}
        </div>
      ),
    });
  }

  const studio = props.studio ? cleanText(props.studio) : "";
  if (studio) {
    blocks.push({
      h: LINE,
      el: (
        <KeyValue
          key="studio"
          label="studio"
          value={
            <Text tone="iris" truncate style={{ maxWidth: COL_W - 120 }}>
              {studio}
            </Text>
          }
        />
      ),
    });
  }

  const genreLines = wrapCells(
    props.genres
      .slice(0, 5)
      .map((g) => cleanText(g))
      .filter(Boolean)
      .join("  ·  "),
    (COL_W - 8 * 8 - 16) / 8,
    2,
  );
  if (genreLines.length > 0) {
    blocks.push({
      h: LINE * genreLines.length,
      el: (
        <KeyValue
          key="genres"
          label="genres"
          value={
            <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end" }}>
              {genreLines.map((l, i) => (
                <Text key={i} tone="iris">
                  {l}
                </Text>
              ))}
            </div>
          }
        />
      ),
    });
  }

  if (props.nextEpisode) {
    const days = props.nextEpisode.inDays;
    const date = fmtDate(Date.now() / 1000 + days * 86400);
    blocks.push({
      h: LINE,
      el: (
        <KeyValue
          key="next"
          label="next"
          value={`ep ${props.nextEpisode.episode}, ${date} (in ${days} day${days === 1 ? "" : "s"})`}
          tone="gold"
        />
      ),
    });
  }
  if (blocks.length <= 2) {
    blocks.push({
      h: LINE,
      el: (
        <Text key="quiet" tone="rose">
          nothing else is on file for this one.
        </Text>
      ),
    });
  }
  return blocks;
}

/** Synopsis lines, or the narrator's line when there is none. */
function descriptionLines(description: string): string[] {
  const lines = wrapCells(cleanBlurb(description), CONTENT_W / 8, 4);
  return lines.length > 0 ? lines : ["you find no synopsis on file."];
}

/**
 * Height in px of the media card for these props: the cover or the text column, whichever
 * is taller, plus the synopsis and the frame. The layout is fixed-width text, so this is
 * exact.
 *
 * @param props - The card props.
 * @returns Image height in px.
 */
export function anilistMediaCardHeight(props: AniListMediaCardProps): number {
  const blocks = columnBlocks(props);
  const colH = blocks.reduce((sum, b) => sum + b.h, 0) + COL_GAP * (blocks.length - 1);
  const descH = descriptionLines(props.description).length * LINE;
  return CHROME_H + Math.max(COVER_H, colH) + 12 + 1 + 12 + descH;
}

/**
 * AniList anime/manga card in haiiro: a labelled window (`anilist: ~/media/<slug>`) with a
 * full-colour portrait cover in a hairline frame, the title (Jacquard, or two lines of
 * 32px text when long), format and count chips, the score as a toned readout and bar,
 * popularity, favourites, status, aired season, studio, genres, the next episode with
 * its date, and a rose synopsis. Render at {@link ANILIST_MEDIA_WIDTH} by
 * {@link anilistMediaCardHeight}.
 *
 * @param props - {@link AniListMediaCardProps}
 */
export function AniListMediaCard(props: AniListMediaCardProps) {
  const height = anilistMediaCardHeight(props);
  const blocks = columnBlocks(props);
  const title = cleanText(props.title) || "untitled";
  const lines = descriptionLines(props.description);
  return (
    <StillBackdrop width={ANILIST_MEDIA_WIDTH} height={height} seed={11}>
      <CardFrame label={`anilist: ~/media/${slugify(props.title, "media")}`}>
        <div style={{ display: "flex", gap: 20 }}>
          <ImageFrame src={props.coverDataUri} size={COVER_W} height={COVER_H} initial={title} />
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: COL_GAP,
              flexGrow: 1,
              flexShrink: 1,
              flexBasis: 0,
              minWidth: 0,
            }}
          >
            {blocks.map((b) => b.el)}
          </div>
        </div>
        <Rule gap={0} />
        <div style={{ display: "flex", flexDirection: "column" }}>
          {lines.map((l, i) => (
            <Text key={i} tone="rose">
              {l}
            </Text>
          ))}
        </div>
      </CardFrame>
    </StillBackdrop>
  );
}
