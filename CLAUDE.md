
# Asuka — Discord Community Bot + Web Admin

Asuka is a single-guild ("locked") Discord bot plus an admin/elected-user web dashboard,
built on **Bun + discord.js 14 + Drizzle (bun:sqlite) + React/Tailwind**. The bot and the
web server run in **one Bun process** and share the live client + database in-memory.

## Run

```sh
cp .env.example .env        # fill in DISCORD_TOKEN, CLIENT_ID, CLIENT_SECRET, GUILD_ID
bun run db:generate         # regenerate migrations after editing src/db/schema.ts
bun run dev                 # bun --hot src/index.ts  (bot + web UI)
bun run start               # production
bun run typecheck           # tsc for server AND src/web/app (separate tsconfigs)
bun test
```

Boot sequence (`src/index.ts`): `initDb()` (migrate + seed singletons) → create client →
`loadPlugins()` (registers commands/listeners/schedules, collects web API routes) → login →
on `ClientReady`: leave non-locked guilds, deploy **guild** slash commands, start web server.

## Hard rules

- **No legacy embeds.** Every non-trivial bot message uses **Components V2** via the helpers in
  `src/core/components.ts` (`v2()`, `card()`, `ContainerBuilder`, …) with `MessageFlags.IsComponentsV2`.
  Only trivial ephemeral acks may use plain `content`.
- **Slash commands only**, guild-scoped. Auto-replies are a message listener, managed **only in the web UI**.
- **Guild lock:** the bot leaves any guild whose id ≠ `GUILD_ID` (`src/core/client.ts`).
- Use Bun built-ins (`bun:sqlite`, `Bun.serve`, `fetch`) — see Bun notes below. No express/ws/vite/dotenv/pg.

## Architecture

```
src/
  index.ts              entrypoint / boot + core gateway routing
  config/env.ts         validated env
  core/
    plugin.ts           Plugin/Command/Listener/Schedule/ApiRoute interfaces + BotContext
    plugin-loader.ts    wires plugins into client + collects API routes
    command-registry.ts builds/deploys guild commands, routes interactions, runtime perm checks
    permissions.ts      Discord-perm + config-role + president/admin resolution
    components.ts       Components V2 helpers (the no-embeds boundary)
    scheduler.ts        croner wrapper with persisted last-run state
    members.ts          ensureMember / addXp / addCredits (shared service)
    client.ts           client factory + guild-lock
    util.ts             parseDuration/formatDuration/randomInt/nowSec
  db/ index.ts schema.ts migrations/    Drizzle + bun:sqlite, migrate-on-boot, getConfig() singleton
  plugins/<feature>/    each exports a Plugin (see contract below)
  web/
    server.ts           Bun.serve: React app + OAuth + /api/me + guarded /api/* dispatch
    auth.ts             Discord OAuth2 code flow + HMAC signed-cookie sessions
    routes.ts           cross-cutting dashboard API (config, clubs, elections, members, modlog)
    app/                React + Tailwind SPA (own tsconfig with DOM lib)
```

### Plugin contract (`src/core/plugin.ts`)
A plugin exports `{ name, commands?, listeners?, schedules?, api? }`. Register it in
`src/plugins/index.ts`. A `Command` has `data` (SlashCommandBuilder), optional
`requiredPermission` (PermissionFlagsBits — also sets `setDefaultMemberPermissions`) and/or
`requiredRoleConfigKey` (a `guild_config` column naming a role; member must hold it or higher),
plus `execute()` / optional `autocomplete()`. `ApiRoute` declares `method`, `path` (supports
`:params`), `access: "admin" | "president" | "user" | "public"`, and `handle(req, ApiContext)`.

### Permission web (defaults, all role IDs configurable via web UI)
mod timeout/warn → `ModerateMembers`; kick → `KickMembers`; ban → `BanMembers`;
censor/config → `ManageGuild`; create club → `clubCreateMinRoleId`; approve/terminate club →
president **or** admin; election start/end → admin; apply for president →
`presidentApplyMinRoleId` + ≥7 days membership; theme → president; profiles/leaderboard → everyone.
Web UI tiers (user < president < admin, `resolveWebRole`): every guild member may sign in —
"user" sees stats, read-only lists and the store; president adds the President panel + club
oversight; admin (`Administrator`/`ManageGuild`) = full (config, auto-replies, elections,
moderation, store item editor).

### Features → plugins
`moderation` (timeout/untimeout/kick/ban/unban/warn/warnings/censor via AutoMod, mod log) ·
`autoreply` (web-managed Components V2 replies + runtime matcher) · `xp` (throttled message XP,
voice-session XP tick, leveling in `xp/leveling.ts`) · `economy` (Social Credits: random reward
every 200–1000 messages, starboard bonus, club daily payout) · `starboard` (reaction sync +
reward) · `profile` (`/profile` with election-view toggle button, `/leaderboard` paginated; both render PNG cards via `core/images`, text fallback) ·
`clubs` (tiers: thread→channel→+voice, listing directory, approval buttons, daily payout, ≤3/user) ·
`elections` (quarterly cron, 1-week registration phase then 1-week 🗳️ reaction voting, max 2
back-to-back terms per user, president role + weekly theme powers) ·
`store` (SC storefront: admin-defined items with optional per-user cap + global stock —
one-time panel magic links (`/panel/:token`, open freely, burned on submit), role grants,
buyer-customized roles (one active per member, anchor-positioned below a configured role,
editable from the My Profile inventory), per-election sabotage items (disable voting /
cut votes / silence with a SABOTAGED card stamp); failed fulfilment refunds the purchase).

### Gotchas
- Plugin modules are imported (evaluated) **before** `initDb()` runs, so never call `getConfig()`
  at module top-level and **schedule cron strings must be static literals** (not read from DB).
  `guild_config.electionIntervalCron` is informational; the active cron is the literal in `elections/index.ts`.
- Drizzle filters: combine conditions with `and(...)`, never `&&`.
- Component/button interactions are handled by plugin `InteractionCreate` listeners keyed by
  `customId` prefix (`lb:` leaderboard, `pf:` profile view toggle, `club:` approvals). Button
  handlers ack with `ackButtonLoading()` (disables all buttons, clicked one shows "⏳ Loading…"),
  then `editReply` the final state — wrap the work in try/catch that edits an error card so the
  message never sticks in the loading state.
- Image cards (`src/core/images/`, satori + resvg): satori lays React fragments out as a **row**
  (keep panels as siblings), can't tile radial-gradient dots, has no emoji font (strip via
  `sanitizeText`), and resvg can't decode webp — fetch avatars with `extension: "png"`. Every
  call site falls back to the old text-only payload when `tryRenderPng` returns null. On message
  edits that swap an image, pass `attachments: []` or the old upload lingers.

---

Default to using Bun instead of Node.js.

- Use `bun <file>` instead of `node <file>` or `ts-node <file>`
- Use `bun test` instead of `jest` or `vitest`
- Use `bun build <file.html|file.ts|file.css>` instead of `webpack` or `esbuild`
- Use `bun install` instead of `npm install` or `yarn install` or `pnpm install`
- Use `bun run <script>` instead of `npm run <script>` or `yarn run <script>` or `pnpm run <script>`
- Use `bunx <package> <command>` instead of `npx <package> <command>`
- Bun automatically loads .env, so don't use dotenv.

## APIs

- `Bun.serve()` supports WebSockets, HTTPS, and routes. Don't use `express`.
- `bun:sqlite` for SQLite. Don't use `better-sqlite3`.
- `Bun.redis` for Redis. Don't use `ioredis`.
- `Bun.sql` for Postgres. Don't use `pg` or `postgres.js`.
- `WebSocket` is built-in. Don't use `ws`.
- Prefer `Bun.file` over `node:fs`'s readFile/writeFile
- Bun.$`ls` instead of execa.

## Testing

Use `bun test` to run tests.

```ts#index.test.ts
import { test, expect } from "bun:test";

test("hello world", () => {
  expect(1).toBe(1);
});
```

## Frontend

Use HTML imports with `Bun.serve()`. Don't use `vite`. HTML imports fully support React, CSS, Tailwind.

Server:

```ts#index.ts
import index from "./index.html"

Bun.serve({
  routes: {
    "/": index,
    "/api/users/:id": {
      GET: (req) => {
        return new Response(JSON.stringify({ id: req.params.id }));
      },
    },
  },
  // optional websocket support
  websocket: {
    open: (ws) => {
      ws.send("Hello, world!");
    },
    message: (ws, message) => {
      ws.send(message);
    },
    close: (ws) => {
      // handle close
    }
  },
  development: {
    hmr: true,
    console: true,
  }
})
```

HTML files can import .tsx, .jsx or .js files directly and Bun's bundler will transpile & bundle automatically. `<link>` tags can point to stylesheets and Bun's CSS bundler will bundle.

```html#index.html
<html>
  <body>
    <h1>Hello, world!</h1>
    <script type="module" src="./frontend.tsx"></script>
  </body>
</html>
```

With the following `frontend.tsx`:

```tsx#frontend.tsx
import React from "react";
import { createRoot } from "react-dom/client";

// import .css files directly and it works
import './index.css';

const root = createRoot(document.body);

export default function Frontend() {
  return <h1>Hello, world!</h1>;
}

root.render(<Frontend />);
```

Then, run index.ts

```sh
bun --hot ./index.ts
```

For more information, read the Bun API docs in `node_modules/bun-types/docs/**.mdx`.
