import { useEffect, useRef } from "react";
import { EditorView, basicSetup } from "codemirror";
import { javascript, javascriptLanguage } from "@codemirror/lang-javascript";
import { oneDark } from "@codemirror/theme-one-dark";
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

/** CodeMirror 6 JS editor with bot-API completions (dark, self-contained). */
export function CodeEditor({
  value,
  onChange,
  maxHeight = "18rem",
}: {
  value: string;
  onChange: (code: string) => void;
  maxHeight?: string;
}) {
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
        oneDark,
        javascriptLanguage.data.of({ autocomplete: botCompletions }),
        EditorView.updateListener.of((update) => {
          if (update.docChanged) onChangeRef.current(update.state.doc.toString());
        }),
        EditorView.theme({
          "&": { fontSize: "13px", maxHeight },
          ".cm-scroller": { overflow: "auto", fontFamily: "ui-monospace, monospace" },
        }),
      ],
    });
    return () => view.destroy();
    // The editor owns the document after mount; `value` is only the seed.
  }, []);

  return <div ref={host} className="rounded-lg border-2 border-black overflow-hidden" />;
}
