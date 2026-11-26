#!/usr/bin/env bash
#
# Install (or remove) the systemd timer that keeps Asuka up to date from GitHub.
#
# Run as root from the install directory, after deploy.sh has set Asuka up:
#
#   sudo scripts/install-auto-update.sh                       # check GitHub every 15 minutes, follow main
#   sudo scripts/install-auto-update.sh --branch main --interval 1h
#   sudo scripts/install-auto-update.sh --remove              # disable and delete the units
#
# It writes:
#   /etc/systemd/system/asuka-update.service   oneshot unit that runs scripts/auto-update.sh as root
#   /etc/systemd/system/asuka-update.timer     the schedule (boot + 3 min, then every interval)
#   /etc/asuka/auto-update.conf                settings, created once and never overwritten
#
# The install directory must be a git clone of the GitHub repository (not an unzipped bundle).
# See docs/auto-update.md for how it works and how to read the logs.

set -euo pipefail

SERVICE_NAME="asuka"
SERVICE_USER="asuka"
DATA_DIR="/var/lib/asuka"
UPDATE_SERVICE="asuka-update"
UNIT_DIR="${ASUKA_UNIT_DIR:-/etc/systemd/system}"
CONF_DIR="${ASUKA_CONF_DIR:-/etc/asuka}"
DRY="${ASUKA_NO_SYSTEMCTL:-}"   # set to 1 to only write the files (tests)
CONF_FILE="${CONF_DIR}/auto-update.conf"
APP_DIR="${ASUKA_APP_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"

BRANCH="main"
REMOTE="origin"
INTERVAL="15min"
ACTION="install"

info() { printf '\033[36m==>\033[0m %s\n' "$*"; }
warn() { printf '\033[33mWARN:\033[0m %s\n' "$*"; }
die()  { printf '\033[31mERROR:\033[0m %s\n' "$*" >&2; exit 1; }

while [[ $# -gt 0 ]]; do
  case "$1" in
    --branch)   BRANCH="${2:?--branch needs a value}"; shift 2 ;;
    --remote)   REMOTE="${2:?--remote needs a value}"; shift 2 ;;
    --interval) INTERVAL="${2:?--interval needs a value (e.g. 15min, 1h)}"; shift 2 ;;
    --remove)   ACTION="remove"; shift ;;
    -h|--help)  sed -n '2,19p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *)          die "unknown option: $1" ;;
  esac
done

[[ "$(uname -s)" == "Linux" ]] || die "this targets Linux with systemd."
[[ "$(id -u)" -eq 0 || -n "$DRY" ]] || die "run as root (sudo scripts/install-auto-update.sh)."
[[ -n "$DRY" ]] || command -v systemctl >/dev/null || die "systemd is required."
sc() { if [[ -z "$DRY" ]]; then systemctl "$@"; fi; }

if [[ "$ACTION" == "remove" ]]; then
  info "Disabling ${UPDATE_SERVICE}.timer"
  sc disable --now "${UPDATE_SERVICE}.timer" 2>/dev/null || true
  rm -f "${UNIT_DIR}/${UPDATE_SERVICE}.service" "${UNIT_DIR}/${UPDATE_SERVICE}.timer"
  sc daemon-reload
  info "Removed. ${CONF_FILE} and ${DATA_DIR}/auto-update (history, backups) were left in place."
  exit 0
fi

[[ -d "${APP_DIR}/.git" ]] \
  || die "${APP_DIR} is not a git checkout. Clone the repository there (git clone <url> ${APP_DIR}) so it can pull updates."
git -C "$APP_DIR" remote get-url "$REMOTE" >/dev/null 2>&1 \
  || die "git remote '${REMOTE}' is not configured in ${APP_DIR}."
[[ -x "${APP_DIR}/scripts/auto-update.sh" ]] || die "${APP_DIR}/scripts/auto-update.sh is missing or not executable."
[[ -f "${UNIT_DIR}/${SERVICE_NAME}.service" ]] \
  || warn "${SERVICE_NAME}.service is not installed yet; run deploy.sh first or updates will not be able to restart anything."

BUN_BIN="$(command -v bun || true)"
[[ -n "$BUN_BIN" && "$BUN_BIN" != /root/* ]] || BUN_BIN="/usr/local/bin/bun"
[[ -x "$BUN_BIN" ]] || die "bun not found (looked at ${BUN_BIN}); run deploy.sh first."

info "Following ${REMOTE}/${BRANCH} of $(git -C "$APP_DIR" remote get-url "$REMOTE")"

mkdir -p "$CONF_DIR" "$UNIT_DIR"
if [[ ! -f "$CONF_FILE" ]]; then
  info "Writing ${CONF_FILE}"
  cat > "$CONF_FILE" <<EOF
# Settings for scripts/auto-update.sh (loaded by ${UPDATE_SERVICE}.service). Restart nothing after editing:
# the next timer run picks them up.

# What to follow.
AUTO_UPDATE_REMOTE=${REMOTE}
AUTO_UPDATE_BRANCH=${BRANCH}

# Seconds the bot must stay up after a restart before the update counts as good. If it crashes or
# restarts within this time, the update is rolled back (commit, database and dependencies).
AUTO_UPDATE_HEALTH_WAIT=30

# Database backups kept in ${DATA_DIR}/auto-update/backups (one is taken before every update).
AUTO_UPDATE_KEEP_BACKUPS=5

# Only deploy commits signed by one of these keys (an ssh allowed-signers file, see "ALLOWED SIGNERS FILE"
# in ssh-keygen(1)). Leave empty to deploy whatever is on the branch.
AUTO_UPDATE_SIGNERS=
EOF
  chmod 644 "$CONF_FILE"
else
  info "Keeping existing ${CONF_FILE}"
fi

info "Writing ${UNIT_DIR}/${UPDATE_SERVICE}.service"
cat > "${UNIT_DIR}/${UPDATE_SERVICE}.service" <<EOF
[Unit]
Description=Update Asuka from GitHub
After=network-online.target
Wants=network-online.target

[Service]
Type=oneshot
EnvironmentFile=-${CONF_FILE}
Environment=ASUKA_APP_DIR=${APP_DIR}
Environment=ASUKA_SERVICE=${SERVICE_NAME}
Environment=ASUKA_USER=${SERVICE_USER}
Environment=ASUKA_DATA_DIR=${DATA_DIR}
Environment=ASUKA_BUN=${BUN_BIN}
ExecStart=${APP_DIR}/scripts/auto-update.sh
TimeoutStartSec=15min
Nice=10
PrivateTmp=true
EOF

info "Writing ${UNIT_DIR}/${UPDATE_SERVICE}.timer"
cat > "${UNIT_DIR}/${UPDATE_SERVICE}.timer" <<EOF
[Unit]
Description=Check GitHub for Asuka updates

[Timer]
OnBootSec=3min
OnUnitInactiveSec=${INTERVAL}
RandomizedDelaySec=60

[Install]
WantedBy=timers.target
EOF

sc daemon-reload
sc enable --now "${UPDATE_SERVICE}.timer"

echo
info "Auto-update is on: every ${INTERVAL}, following ${REMOTE}/${BRANCH}."
cat <<EOF
  Check now (no changes)   : sudo ${APP_DIR}/scripts/auto-update.sh --check
  Update now               : sudo systemctl start ${UPDATE_SERVICE}
  When does it run next    : systemctl list-timers ${UPDATE_SERVICE}.timer
  Logs                     : journalctl -u ${UPDATE_SERVICE} -e
  History                  : cat ${DATA_DIR}/auto-update/history.log
  Turn it off              : sudo ${APP_DIR}/scripts/install-auto-update.sh --remove
EOF
