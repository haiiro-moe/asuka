# asuka

To install dependencies:

```bash
bun install
```

To run:

```bash
bun run index.ts
```

This project was created using `bun init` in bun v1.3.14. [Bun](https://bun.com) is a fast all-in-one JavaScript runtime.

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
