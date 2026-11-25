{
  description = "asuka: Discord community bot + web dashboard (Bun, TypeScript)";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
  };

  outputs = { self, nixpkgs }:
    let
      # The two platforms the Nix support is meant for. Bun and the prebuilt
      # native modules we install (@resvg/resvg-js) exist for both.
      systems = [ "x86_64-linux" "aarch64-linux" ];
      forAllSystems = f:
        nixpkgs.lib.genAttrs systems (system: f nixpkgs.legacyPackages.${system});
    in
    {
      devShells = forAllSystems (pkgs: {
        default = pkgs.mkShell {
          packages = [
            # Runtime, package manager, test runner and bundler. Note that the
            # `typescript` compiler (`tsc`, used by `bun run typecheck`) and
            # drizzle-kit come from node_modules via `bun install`, not from
            # Nix, so their versions follow bun.lock.
            pkgs.bun
            # scripts/bundle.sh refuses to run without it.
            pkgs.zip
          ];

          # No LD_LIBRARY_PATH needed: the prebuilt napi binary of
          # @resvg/resvg-js (PNG cards) was checked to load and render under
          # the nixpkgs bun without it.
          shellHook = ''
            echo "asuka dev shell: bun $(bun --version). Run 'bun install' first, then 'bun run typecheck' or 'bun run dev'."
          '';
        };
      });

      # No `packages.default`, on purpose. nixpkgs cannot consume bun.lock
      # (lockfileVersion 1, text format): there is no buildBunPackage, so a
      # hermetic build needs a third party generator (bun2nix) or a
      # fixed-output derivation whose hash has to be recomputed on every
      # dependency bump. The bot is also deployed as source with `bun install`
      # on the target (see deploy.sh), so a store package would not replace
      # anything. Instead `nix run` uses the same toolchain as the dev shell
      # and installs from the frozen lockfile at run time (needs network on
      # first start, and writes ./node_modules).
      apps = forAllSystems (pkgs:
        let
          run = pkgs.writeShellApplication {
            name = "asuka";
            runtimeInputs = [ pkgs.bun ];
            text = ''
              # Run from the checkout: src/index.ts, bunfig.toml and
              # .env (loaded by Bun from the cwd) are resolved relative to it.
              bun install --frozen-lockfile
              exec bun src/index.ts "$@"
            '';
          };
        in
        {
          default = {
            type = "app";
            meta.description = "Install deps from bun.lock and start the asuka bot + dashboard";
            program = "${run}/bin/asuka";
          };
        });

      # `nix flake check` builds the dev shell on every system, which catches
      # evaluation errors and broken package references.
      checks = forAllSystems (pkgs: {
        devShell = self.devShells.${pkgs.stdenv.hostPlatform.system}.default;
      });
    };
}
