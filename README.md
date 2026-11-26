# asuka

Asuka is a single-guild Discord community bot with a web dashboard. It runs both in one Bun process
(Bun, discord.js 14, Drizzle on `bun:sqlite`, React and Tailwind). It does moderation, XP and levels,
Social Credits and a store, clubs, elections with a president, events, AniList lookups, starboard,
auto-replies and link fixing. Messages are Components V2, cards are PNGs, and the dashboard follows the
haiiro design system (one dark theme, bitmap type, square windows).

## Run

Copy `.env.example` to `.env` and set `DISCORD_TOKEN`, `CLIENT_ID`, `CLIENT_SECRET` and `GUILD_ID`.

```sh
nix develop -c bun install --frozen-lockfile
nix develop -c bun run dev          # bot and dashboard, hot reload
nix develop -c bun run typecheck    # server and src/web/app
bun run db:generate                 # after editing src/db/schema.ts
```

Without Nix, `bun install`, `bun run dev` and `bun run start` do the same with Bun on your PATH. There
are no automated tests; `typecheck` is the gate. The entry point is `src/index.ts`.

## Docs

- [CLAUDE.md](CLAUDE.md): architecture, plugin contract, gotchas
- [docs/web-ui.md](docs/web-ui.md): dashboard design rules, shell, primitives, adding a page
- [docs/cards.md](docs/cards.md): PNG cards, fonts, crispness, adding a card
- [docs/voice.md](docs/voice.md): Discord wording, accent palette, message templates

## Nix / NixOS

The repo ships a flake (`x86_64-linux`, `aarch64-linux`). Nothing else needs to be installed globally.

```sh
nix develop                                   # shell with bun and zip
bun install --frozen-lockfile                 # installs node_modules (tsc, drizzle-kit, ...) from bun.lock
bun run typecheck                             # server + src/web/app
bun run dev                                   # bot + dashboard, needs .env (see .env.example)

# one-shot equivalents
nix develop -c bun install --frozen-lockfile
nix develop -c bun run typecheck

# install from bun.lock and start the bot (run from the checkout, with .env present)
nix run
```

With direnv, the committed `.envrc` (`use flake`) loads the dev shell automatically after `direnv allow`.

There is no `packages.default`: nixpkgs cannot read `bun.lock`, so a hermetic build would need a third party
generator or a hash that breaks on every dependency bump, and the bot is deployed as source anyway (`deploy.sh`).
`nix run` therefore runs `bun install --frozen-lockfile && bun src/index.ts` and needs network on first start.
The prebuilt `@resvg/resvg-js` native module (PNG profile/leaderboard cards) loads fine under the Nix `bun`, so no
extra library path is needed. `typescript` and `drizzle-kit` come from `node_modules`, so their versions follow `bun.lock`.
