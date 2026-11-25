#!/usr/bin/env bash
#
# Zip the bot for shipping to a server: source + the few files a deploy needs
# (package.json, bun.lock, drizzle.config.ts, bunfig.toml, deploy.sh, env
# templates, migrations). No node_modules (deploy.sh runs `bun install` on the
# target), no secrets, no local db/build/cache junk.
#
# Usage:
#   ./scripts/bundle.sh              # writes asuka-bundle.zip in repo root
#   ./scripts/bundle.sh out/foo.zip  # custom output path

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

OUT="${1:-asuka-bundle.zip}"
[[ "$OUT" = /* ]] || OUT="${ROOT}/${OUT}"

command -v zip >/dev/null || { echo "ERROR: 'zip' not found." >&2; exit 1; }

rm -f "$OUT"

# Stops macOS from stuffing AppleDouble (._*) files and a __MACOSX/ folder
# into the archive — the thing that bloated the last hand-made zip.
export COPYFILE_DISABLE=1

zip -X -r "$OUT" . \
  -x 'node_modules/*' \
  -x '.git/*' -x '.git' \
  -x '.claude/*' \
  -x '.env' \
  -x '.env.local' -x '.env.development.local' -x '.env.test.local' -x '.env.production.local' \
  -x '*.sqlite' -x '*.sqlite-shm' -x '*.sqlite-wal' \
  -x 'coverage/*' -x 'dist/*' -x 'out/*' \
  -x '*.log' -x '*.tsbuildinfo' \
  -x '*.test.ts' \
  -x '.DS_Store' -x '*/.DS_Store' \
  -x '*.zip' \
  -x '__MACOSX/*' \
  -x '.idea/*' \
  -x '.eslintcache' -x '.cache/*' \
  >/dev/null

size="$(du -h "$OUT" | cut -f1)"
count="$(unzip -l "$OUT" | tail -1 | awk '{print $2}')"
echo "Wrote ${OUT} (${size}, ${count} files)"
