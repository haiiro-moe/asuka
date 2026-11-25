#!/usr/bin/env bash
#
# Promote a freshly-unzipped bundle (scripts/bundle.sh output, already
# unzipped) to be the live "bot" install, archiving the current one.
#
# Run as root, FROM the currently-live bot directory:
#
#   cd /var/lib/asuka/bot
#   sudo ./redeploy.sh /path/to/unzipped-new-version [old-version-tag]
#
# What it does:
#   1. Stops the systemd unit.
#   2. Copies any .env* files from the current install into the new one
#      (bundle.sh never ships secrets, so they don't exist in a fresh unzip).
#   3. Runs `bun install --frozen-lockfile` in the new install — the step
#      that's easy to forget and leaves the site completely dead.
#   4. Archives the current install as ../bot<tag> (tag defaults to a
#      timestamp) and promotes the new one to the live path.
#   5. Fixes ownership, restarts the unit, and verifies it actually came up.
#
# The sqlite database lives in DATA_DIR (one level up, e.g. /var/lib/asuka/),
# not inside the bot folder, so swapping folders never touches it.

set -euo pipefail

SERVICE_NAME="asuka"
SERVICE_USER="asuka"

bold()  { printf '\033[1m%s\033[0m\n' "$*"; }
info()  { printf '\033[36m==>\033[0m %s\n' "$*"; }
warn()  { printf '\033[33mWARN:\033[0m %s\n' "$*"; }
die()   { printf '\033[31mERROR:\033[0m %s\n' "$*" >&2; exit 1; }

[[ "$(id -u)" -eq 0 ]] || die "Run as root (sudo ./redeploy.sh ...)."

NEW_DIR="${1:-}"
TAG="${2:-$(date +%Y%m%d%H%M%S)}"
[[ -n "$NEW_DIR" ]] || die "Usage: ./redeploy.sh /path/to/unzipped-new-version [old-version-tag]"

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PARENT_DIR="$(dirname "$APP_DIR")"
ARCHIVE_DIR="${PARENT_DIR}/bot${TAG}"

NEW_DIR="$(cd "$NEW_DIR" && pwd)"
[[ -f "${NEW_DIR}/package.json" && -d "${NEW_DIR}/src/db/migrations" ]] \
  || die "${NEW_DIR} doesn't look like an unzipped bundle (no package.json / src/db/migrations)."
[[ "$NEW_DIR" != "$APP_DIR" ]] || die "New dir can't be the live bot dir itself."
[[ ! -e "$ARCHIVE_DIR" ]] || die "${ARCHIVE_DIR} already exists — pick a different tag."

bold ""
bold "Asuka redeploy"
bold "=============="
echo "  Live install : ${APP_DIR}"
echo "  New install  : ${NEW_DIR}"
echo "  Archiving to : ${ARCHIVE_DIR}"
echo

info "Stopping ${SERVICE_NAME}.service"
systemctl stop "$SERVICE_NAME" || true

info "Carrying over .env files"
copied=0
for f in .env .env.local .env.development.local .env.test.local .env.production.local; do
  if [[ -f "${APP_DIR}/${f}" && ! -f "${NEW_DIR}/${f}" ]]; then
    cp -p "${APP_DIR}/${f}" "${NEW_DIR}/${f}"
    echo "  copied ${f}"
    copied=$((copied + 1))
  fi
done
[[ "$copied" -gt 0 ]] || warn "No .env files found in ${APP_DIR} to carry over — is that expected?"

info "Installing dependencies in the new install"
(cd "$NEW_DIR" && bun install --frozen-lockfile)

info "Archiving current install"
mv "$APP_DIR" "$ARCHIVE_DIR"

info "Promoting new install to ${APP_DIR}"
mv "$NEW_DIR" "$APP_DIR"

info "Fixing ownership"
chown -R "${SERVICE_USER}:${SERVICE_USER}" "$APP_DIR"
chmod 600 "${APP_DIR}"/.env* 2>/dev/null || true

info "Starting ${SERVICE_NAME}.service"
systemctl start "$SERVICE_NAME"

sleep 3
if systemctl is-active --quiet "$SERVICE_NAME"; then
  bold ""
  bold "Redeployed. ${SERVICE_NAME}.service is running."
  echo "  Previous install kept at: ${ARCHIVE_DIR}"
else
  echo
  warn "Service failed to start after redeploy. Logs:"
  journalctl -u "$SERVICE_NAME" -e --no-pager -n 50
  warn "Live dir is already the new code — roll back with:"
  warn "  systemctl stop ${SERVICE_NAME} && rm -rf '${APP_DIR}' && mv '${ARCHIVE_DIR}' '${APP_DIR}' && systemctl start ${SERVICE_NAME}"
  exit 1
fi
