/**
 * The variable snippet editor: CodeMirror 6 with JavaScript, completions for the bot sandbox, and a
 * haiiro theme built from the CSS tokens (no colour of its own).
 *
 * @module
 */
import { useEffect, useRef } from "react";
import { EditorView, basicSetup } from "codemirror";
import { javascript, javascriptLanguage } from "@codemirror/lang-javascript";
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { tags as t } from "@lezer/highlight";
import type { Extension } from "@codemirror/state";
import type { CompletionContext, CompletionResult } from "@codemirror/autocomplete";

/**
 * Dotted-path suggestions for the sandbox the variable snippets run in
 * (src/core/variables.ts): client/guildId/config/db/schema plus the common
 * discord.js and Drizzle chains hanging off them.
 */
const API_TREE: Record<string, { label: string; type: string; info?: string }[]> = {
  "": [
    { label: "client", type: "variable", info: "Live discord.js Client" },
    { label: "guildId", type: "variable", info: "The locked guild's id" },
    { label: "config", type: "variable", info: "guild_config singleton row" },
    { label: "db", type: "variable", info: "Drizzle bun:sqlite instance" },
    { label: "schema", type: "variable", info: "Drizzle table definitions" },
    { label: "ctx", type: "variable", info: "Full BotContext" },
    { label: "return", type: "keyword" },
    { label: "await", type: "keyword" },
  ],
  client: [
    { label: "guilds", type: "property" },
    { label: "channels", type: "property" },
    { label: "users", type: "property" },
    { label: "user", type: "property", info: "The bot's own user" },
    { label: "ws", type: "property" },
    { label: "uptime", type: "property", info: "ms since ready" },
    { label: "readyAt", type: "property" },
  ],
  "client.guilds": [
    { label: "fetch(guildId)", type: "function", info: "await → Guild" },
    { label: "cache", type: "property" },
  ],
  "client.channels": [
    { label: "fetch(id)", type: "function", info: "await → Channel" },
    { label: "cache", type: "property" },
  ],
  "client.users": [
    { label: "fetch(id)", type: "function", info: "await → User" },
    { label: "cache", type: "property" },
  ],
  "client.user": [
    { label: "username", type: "property" },
    { label: "id", type: "property" },
    { label: "displayAvatarURL()", type: "function" },
  ],
  "client.ws": [{ label: "ping", type: "property", info: "Gateway latency (ms)" }],
  config: [
    { label: "starboardChannelId", type: "property" },
    { label: "electionChannelId", type: "property" },
    { label: "levelUpChannelId", type: "property" },
    { label: "announcementChannelId", type: "property" },
    { label: "presidentRoleId", type: "property" },
    { label: "serverNameTemplate", type: "property" },
    { label: "starboardEmoji", type: "property" },
    { label: "starboardThreshold", type: "property" },
  ],
  db: [
    { label: "select()", type: "function", info: ".from(schema.…).all()/.get()" },
    { label: "insert(schema.…)", type: "function" },
    { label: "update(schema.…)", type: "function" },
    { label: "delete(schema.…)", type: "function" },
  ],
  schema: [
    { label: "members", type: "property" },
    { label: "warnings", type: "property" },
    { label: "modLog", type: "property" },
    { label: "clubs", type: "property" },
    { label: "clubMembers", type: "property" },
    { label: "elections", type: "property" },
    { label: "candidates", type: "property" },
    { label: "president", type: "property" },
    { label: "storeItems", type: "property" },
    { label: "storePurchases", type: "property" },
    { label: "starboardPosts", type: "property" },
    { label: "botVariables", type: "property" },
    { label: "anilistLinks", type: "property" },
  ],
  ctx: [
    { label: "client", type: "property" },
    { label: "guildId", type: "property" },
    { label: "config()", type: "function", info: "Fresh guild_config row" },
  ],
};

function botCompletions(context: CompletionContext): CompletionResult | null {
  const word = context.matchBefore(/[\w$.]*/);
  if (!word || (word.from === word.to && !context.explicit)) return null;
  const lastDot = word.text.lastIndexOf(".");
  const prefix = lastDot === -1 ? "" : word.text.slice(0, lastDot);
  const options = API_TREE[prefix];
  if (!options) return null;
  return {
    from: lastDot === -1 ? word.from : word.from + lastDot + 1,
    options,
    validFor: /^[\w$]*$/,
  };
}

/* ------------------------------------------------------------------------------------------------ */

/** A haiiro colour token as a CSS value, so the theme follows the page's tokens. */
const v = (name: string) => `var(--${name})`;

/** Square form controls inside CodeMirror's own panels (search, go to line). */
const PANEL_CONTROL = {
  font: "inherit",
  fontSize: "16px",
  lineHeight: "1.15",
  color: v("color-text"),
  backgroundImage: "none",
  border: `${v("border-hairline")} solid ${v("ink-muted")}`,
  borderRadius: "0",
  boxShadow: "none",
};

/**
 * The editor chrome in haiiro: base background on a 1px ink-muted hairline, surface gutters, IBM VGA at
 * 16px with line height 1.15, a square block caret in text (inverted over the glyph under it), the
 * selection on pine, the active line on highlight-low, and the 2px foam focus ring outside the box.
 * Tooltips and panels are square, flat and token-coloured. No radius, no shadow, no transition.
 *
 * @param maxHeight - CSS height after which the editor scrolls.
 */
function haiiroEditorTheme(maxHeight: string): Extension {
  return EditorView.theme(
    {
      "&": {
        color: v("color-text"),
        backgroundColor: v("color-base"),
        border: `${v("border-hairline")} solid ${v("ink-muted")}`,
        borderRadius: "0",
        fontSize: "16px",
        maxHeight,
      },
      "&.cm-focused": { outline: `2px solid ${v("color-foam")}`, outlineOffset: "2px" },
      // the page-wide focus ring would draw a second ring inside the box
      ".cm-content:focus-visible": { outline: "none" },
      ".cm-scroller": { overflow: "auto", fontFamily: v("font-mono"), lineHeight: "1.15" },
      ".cm-content": { caretColor: v("color-text"), padding: "8px 0" },
      ".cm-line": { padding: "0 8px" },

      // a square block caret, 1ch wide; the layer inverts what is under it like a terminal cursor
      ".cm-cursorLayer": { mixBlendMode: "difference" },
      ".cm-cursor, .cm-dropCursor": {
        borderLeft: `1ch solid ${v("color-text")}`,
        marginLeft: "0",
      },
      "&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection":
        { backgroundColor: v("color-pine") },
      ".cm-activeLine": { backgroundColor: v("color-highlight-low") },
      ".cm-selectionMatch": { backgroundColor: v("color-highlight-med") },
      "&.cm-focused .cm-matchingBracket": {
        backgroundColor: v("color-highlight-med"),
        outline: `${v("border-hairline")} solid ${v("color-subtle")}`,
      },
      "&.cm-focused .cm-nonmatchingBracket": { color: v("color-love"), backgroundColor: "transparent" },
      ".cm-searchMatch": {
        backgroundColor: v("color-highlight-med"),
        outline: `${v("border-hairline")} solid ${v("color-gold")}`,
      },
      ".cm-searchMatch.cm-searchMatch-selected": { backgroundColor: v("color-highlight-high") },
      ".cm-placeholder": { color: v("color-muted") },

      ".cm-gutters": {
        backgroundColor: v("color-surface"),
        color: v("color-muted"),
        border: "none",
        borderRight: `${v("border-hairline")} solid ${v("ink-hairline")}`,
      },
      ".cm-activeLineGutter": { backgroundColor: v("color-highlight-low"), color: v("color-subtle") },
      ".cm-lineNumbers .cm-gutterElement": { padding: "0 1ch 0 1ch" },
      ".cm-foldGutter .cm-gutterElement": { padding: "0 4px", color: v("color-muted") },
      ".cm-foldPlaceholder": {
        backgroundColor: "transparent",
        border: `${v("border-hairline")} dashed ${v("ink-muted")}`,
        borderRadius: "0",
        color: v("color-muted"),
        padding: "0 4px",
      },

      ".cm-tooltip": {
        fontFamily: v("font-mono"),
        fontSize: "16px",
        lineHeight: "1.15",
        color: v("color-text"),
        backgroundColor: v("color-surface"),
        border: `${v("border-hairline")} solid ${v("ink-muted")}`,
        borderRadius: "0",
        boxShadow: "none",
      },
      ".cm-tooltip .cm-tooltip-arrow:before, .cm-tooltip .cm-tooltip-arrow:after": {
        borderTopColor: "transparent",
        borderBottomColor: "transparent",
      },
      ".cm-tooltip.cm-tooltip-autocomplete > ul": { fontFamily: v("font-mono"), maxHeight: "16em" },
      ".cm-tooltip.cm-tooltip-autocomplete > ul > li": { padding: "2px 8px", lineHeight: "1.15" },
      ".cm-tooltip-autocomplete ul li[aria-selected]": {
        backgroundColor: v("color-highlight-med"),
        color: v("color-text"),
      },
      ".cm-completionLabel": { color: v("color-text") },
      ".cm-completionMatchedText": { color: v("color-foam"), textDecoration: "none" },
      ".cm-completionDetail": { color: v("color-muted"), fontStyle: "normal" },
      ".cm-completionIcon": { color: v("color-iris"), opacity: "1" },
      ".cm-completionInfo": { padding: "4px 8px", color: v("color-subtle") },
      ".cm-tooltip-lint": { padding: "0" },
      ".cm-diagnostic": { borderLeft: "none", padding: "4px 8px" },
      ".cm-diagnostic-error": { color: v("color-love") },
      ".cm-diagnostic-warning": { color: v("color-gold") },
      ".cm-diagnostic-info": { color: v("color-foam") },

      ".cm-panels": { backgroundColor: v("color-surface"), color: v("color-text") },
      ".cm-panels.cm-panels-top": { borderBottom: `${v("border-hairline")} solid ${v("ink-hairline")}` },
      ".cm-panels.cm-panels-bottom": { borderTop: `${v("border-hairline")} solid ${v("ink-hairline")}` },
      ".cm-panel.cm-search": { fontFamily: v("font-mono"), padding: "4px 8px" },
      ".cm-panel.cm-search label": { fontSize: "16px", color: v("color-subtle") },
      ".cm-panel.cm-search [name=close]": { color: v("color-subtle"), fontSize: "16px" },
      ".cm-textfield": { ...PANEL_CONTROL, backgroundColor: v("color-base"), padding: "0 6px" },
      ".cm-button": { ...PANEL_CONTROL, backgroundColor: v("color-overlay"), padding: "0 1ch" },
      ".cm-button:active": { backgroundImage: "none", backgroundColor: v("color-highlight-med") },
    },
    { dark: true },
  );
}

/**
 * Syntax colours from the haiiro jobs: comments muted, keywords and operators iris, strings foam,
 * numbers and constants gold, function calls rose, properties and names text, errors love.
 */
const haiiroHighlight = HighlightStyle.define([
  { tag: [t.comment, t.lineComment, t.blockComment, t.docComment], color: v("color-muted") },
  {
    tag: [t.keyword, t.controlKeyword, t.moduleKeyword, t.operatorKeyword, t.definitionKeyword, t.modifier, t.self],
    color: v("color-iris"),
  },
  { tag: [t.operator, t.derefOperator, t.arithmeticOperator, t.logicOperator, t.compareOperator], color: v("color-iris") },
  { tag: [t.string, t.special(t.string), t.regexp, t.escape, t.character], color: v("color-foam") },
  { tag: [t.number, t.integer, t.float, t.bool, t.null, t.atom], color: v("color-gold") },
  {
    tag: [t.function(t.variableName), t.function(t.propertyName), t.function(t.definition(t.variableName))],
    color: v("color-rose"),
  },
  { tag: [t.propertyName, t.variableName, t.definition(t.variableName), t.definition(t.propertyName)], color: v("color-text") },
  { tag: [t.typeName, t.className, t.namespace], color: v("color-gold") },
  { tag: [t.punctuation, t.bracket, t.separator, t.meta, t.labelName], color: v("color-subtle") },
  { tag: t.invalid, color: v("color-love") },
]);

/** Props of {@link CodeEditor}. */
export interface CodeEditorProps {
  /** The initial document. The editor owns the text after mount; later changes of this prop are ignored. */
  value: string;
  /** Called with the whole document on every edit. */
  onChange: (code: string) => void;
  /** CSS height after which the editor scrolls. Default `18rem`. */
  maxHeight?: string;
  /** Accessible name of the text area. Default `javascript snippet`. */
  ariaLabel?: string;
}

/**
 * A CodeMirror 6 JavaScript editor with completions for the variable sandbox (`client`, `guildId`,
 * `config`, `db`, `schema`, `ctx` and their common chains), drawn in the haiiro theme above.
 */
export function CodeEditor({ value, onChange, maxHeight = "18rem", ariaLabel = "javascript snippet" }: CodeEditorProps) {
  const host = useRef<HTMLDivElement>(null);
  // Keep the latest callback without re-creating the editor.
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  useEffect(() => {
    const view = new EditorView({
      doc: value,
      parent: host.current!,
      extensions: [
        basicSetup,
        javascript(),
        haiiroEditorTheme(maxHeight),
        syntaxHighlighting(haiiroHighlight),
        javascriptLanguage.data.of({ autocomplete: botCompletions }),
        EditorView.contentAttributes.of({ "aria-label": ariaLabel }),
        EditorView.updateListener.of((update) => {
          if (update.docChanged) onChangeRef.current(update.state.doc.toString());
        }),
      ],
    });
    return () => view.destroy();
    // The editor owns the document after mount; `value` is only the seed.
  }, []);

  return <div ref={host} className="min-w-0" />;
}
