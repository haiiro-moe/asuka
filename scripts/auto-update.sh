#!/usr/bin/env bash
#
# Asuka auto-update: fast-forward the install to the newest commit on GitHub, then restart the service.
#
# Normally run by the asuka-update.service systemd unit (see scripts/install-auto-update.sh and
# docs/auto-update.md), as root. It can also be run by hand:
#
#   sudo scripts/auto-update.sh           # update now if GitHub has something new
#   sudo scripts/auto-update.sh --check   # only report whether an update is waiting
#
# What it does, in order:
#   1. Takes a lock so two runs never overlap, and fetches the branch (read-only).
#   2. Exits quietly when the install is already on that commit, when the commit was marked bad by an
#      earlier failed update, or when GitHub cannot be reached (a network blip is not a failure).
#   3. Refuses (and fails the unit, so `systemctl --failed` shows it) when the install has local commits
#      or tracked changes, or when AUTO_UPDATE_SIGNERS is set and the new commit is not signed by one of
#      those keys.
#   4. Stops the service, backs up the SQLite database, fast-forwards, runs `bun install --frozen-lockfile`
#      and starts the service again.
#   5. Waits AUTO_UPDATE_HEALTH_WAIT seconds. If the service is not active the whole time or restarts,
#      it rolls back: previous commit, previous database, dependencies reinstalled, service started, and
#      the bad commit is remembered so it is not tried again until a newer commit lands.
#
# Configuration comes from the environment (the unit loads /etc/asuka/auto-update.conf):
#   AUTO_UPDATE_REMOTE=origin          remote to fetch from
#   AUTO_UPDATE_BRANCH=main            branch to follow
#   AUTO_UPDATE_HEALTH_WAIT=30         seconds the service must stay up after a restart
#   AUTO_UPDATE_KEEP_BACKUPS=5         database backups to keep
#   AUTO_UPDATE_SIGNERS=               path to an ssh allowed-signers file; when set, only commits signed
#                                      by one of those keys are deployed
#   ASUKA_APP_DIR, ASUKA_SERVICE, ASUKA_USER, ASUKA_DATA_DIR, ASUKA_STATE_DIR, ASUKA_BUN
#                                      paths and names (defaults match deploy.sh)
#   ASUKA_RUN_AS=runuser               command used to run git and bun as the service user (tests only)

set -euo pipefail

# The update rewrites this very file, and bash reads a script as it runs. Run from a private copy so the
# swap cannot corrupt the running script; the copy deletes itself once bash has it open.
if [[ -z "${ASUKA_UPDATE_COPY:-}" ]]; then
  SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
  export ASUKA_APP_DIR="${ASUKA_APP_DIR:-$(dirname "$SCRIPT_DIR")}"
  COPY="$(mktemp /tmp/asuka-auto-update.XXXXXX)"
  cp "${BASH_SOURCE[0]}" "$COPY"
  ASUKA_UPDATE_COPY="$COPY" exec bash "$COPY" "$@"
fi
rm -f "$ASUKA_UPDATE_COPY"

APP_DIR="${ASUKA_APP_DIR:?}"
SERVICE="${ASUKA_SERVICE:-asuka}"
SERVICE_USER="${ASUKA_USER:-asuka}"
DATA_DIR="${ASUKA_DATA_DIR:-/var/lib/asuka}"
STATE_DIR="${ASUKA_STATE_DIR:-${DATA_DIR}/auto-update}"
BUN_BIN="${ASUKA_BUN:-$(command -v bun || echo /usr/local/bin/bun)}"
RUN_AS="${ASUKA_RUN_AS:-runuser}"
REMOTE="${AUTO_UPDATE_REMOTE:-origin}"
BRANCH="${AUTO_UPDATE_BRANCH:-main}"
HEALTH_WAIT="${AUTO_UPDATE_HEALTH_WAIT:-30}"
KEEP_BACKUPS="${AUTO_UPDATE_KEEP_BACKUPS:-5}"
SIGNERS="${AUTO_UPDATE_SIGNERS:-}"
LOCK_FILE="${ASUKA_LOCK_FILE:-/run/lock/asuka-auto-update.lock}"
BACKUP_DIR="${STATE_DIR}/backups"

CHECK_ONLY=no
[[ "${1:-}" == "--check" ]] && CHECK_ONLY=yes

log()  { printf '[asuka-update] %s\n' "$*"; }
warn() { printf '[asuka-update] warning: %s\n' "$*" >&2; }
die()  { printf '[asuka-update] error: %s\n' "$*" >&2; exit 1; }

# Run a command as the service user so the files in the install keep their owner.
as_app() {
  if [[ "$RUN_AS" == "runuser" ]]; then
    runuser -u "$SERVICE_USER" -- env HOME="$DATA_DIR" GIT_TERMINAL_PROMPT=0 "$@"
  else
    # shellcheck disable=SC2086
    $RUN_AS env HOME="$DATA_DIR" GIT_TERMINAL_PROMPT=0 "$@"
  fi
}
git_app() { as_app git -C "$APP_DIR" "$@"; }

[[ "$(id -u)" -eq 0 || "$RUN_AS" != "runuser" ]] || die "run as root (the unit does)."
[[ -d "${APP_DIR}/.git" ]] || die "${APP_DIR} is not a git checkout. Auto-update needs the install to be a clone of the GitHub repository."

mkdir -p "$STATE_DIR" "$BACKUP_DIR" "$(dirname "$LOCK_FILE")"
exec 9>"$LOCK_FILE"
flock -n 9 || { log "another update is running, skipping."; exit 0; }

# --- what is waiting? -------------------------------------------------------------------------------

if ! git_app fetch --quiet --prune "$REMOTE" "$BRANCH"; then
  warn "could not fetch ${REMOTE}/${BRANCH}; will try again on the next run."
  exit 0
fi

OLD="$(git_app rev-parse HEAD)"
NEW="$(git_app rev-parse "${REMOTE}/${BRANCH}")"

if [[ "$OLD" == "$NEW" ]]; then
  log "up to date at ${OLD:0:7}."
  exit 0
fi

if [[ -e "${STATE_DIR}/bad-${NEW}" ]]; then
  log "${NEW:0:7} failed to start earlier; waiting for a newer commit."
  exit 0
fi

if [[ "$CHECK_ONLY" == "yes" ]]; then
  log "update available: ${OLD:0:7} -> ${NEW:0:7} ($(git_app rev-list --count "${OLD}..${NEW}") commits)."
  exit 0
fi

# --- is it safe to move? ----------------------------------------------------------------------------

git_app merge-base --is-ancestor "$OLD" "$NEW" \
  || die "the install (${OLD:0:7}) is not an ancestor of ${REMOTE}/${BRANCH} (${NEW:0:7}); it has local commits or the branch was rewritten. Fix it by hand."

[[ -z "$(git_app status --porcelain --untracked-files=no)" ]] \
  || die "the install has uncommitted changes to tracked files; refusing to update over them."

if [[ -n "$SIGNERS" ]]; then
  [[ -r "$SIGNERS" ]] || die "AUTO_UPDATE_SIGNERS=${SIGNERS} is not readable."
  if ! git_app -c gpg.format=ssh -c "gpg.ssh.allowedSignersFile=${SIGNERS}" verify-commit "$NEW" >/dev/null 2>&1; then
    touch "${STATE_DIR}/bad-${NEW}"
    die "${NEW:0:7} is not signed by a key in ${SIGNERS}; not deploying it."
  fi
fi

# --- update -----------------------------------------------------------------------------------------

log "updating ${OLD:0:7} -> ${NEW:0:7}."

db_path() {
  local p=""
  [[ -f "${APP_DIR}/.env" ]] && p="$(grep -E '^DATABASE_PATH=' "${APP_DIR}/.env" | tail -n1 | cut -d= -f2- || true)"
  echo "${p:-${APP_DIR}/asuka.sqlite}"
}
DB="$(db_path)"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
THIS_BACKUP="${BACKUP_DIR}/${STAMP}-${OLD:0:7}"

backup_db() {
  mkdir -p "$THIS_BACKUP"
  local f
  for f in "$DB" "${DB}-wal" "${DB}-shm"; do
    if [[ -e "$f" ]]; then cp -p "$f" "$THIS_BACKUP/"; fi
  done
  log "database backed up to ${THIS_BACKUP}."
}

restore_db() {
  local f base
  [[ -d "$THIS_BACKUP" ]] || return 0
  for f in "$DB" "${DB}-wal" "${DB}-shm"; do rm -f "$f"; done
  for f in "$THIS_BACKUP"/*; do
    [[ -e "$f" ]] || continue
    base="$(basename "$f")"
    cp -p "$f" "$(dirname "$DB")/${base}"
  done
  log "database restored from ${THIS_BACKUP}."
}

prune_backups() {
  local n=0 d
  while IFS= read -r d; do
    n=$((n + 1))
    if [[ "$n" -gt "$KEEP_BACKUPS" ]]; then rm -rf "$d"; fi
  done < <(find "$BACKUP_DIR" -mindepth 1 -maxdepth 1 -type d | sort -r)
}

# Healthy means active for the whole wait with no restart in between.
healthy() {
  local restarts_before restarts i
  restarts_before="$(systemctl show -p NRestarts --value "$SERVICE" 2>/dev/null || echo 0)"
  for ((i = 0; i < HEALTH_WAIT; i += 2)); do
    sleep 2
    systemctl is-active --quiet "$SERVICE" || return 1
    restarts="$(systemctl show -p NRestarts --value "$SERVICE" 2>/dev/null || echo 0)"
    [[ "$restarts" == "$restarts_before" ]] || return 1
  done
  systemctl is-active --quiet "$SERVICE"
}

rollback() {
  warn "rolling back to ${OLD:0:7}."
  systemctl stop "$SERVICE" || true
  git_app reset --hard --quiet "$OLD"
  restore_db
  (cd "$APP_DIR" && as_app "$BUN_BIN" install --frozen-lockfile >/dev/null) || warn "bun install failed during rollback."
  touch "${STATE_DIR}/bad-${NEW}"
  systemctl start "$SERVICE" || true
  if systemctl is-active --quiet "$SERVICE"; then
    warn "rolled back; ${SERVICE} is running ${OLD:0:7} again. ${NEW:0:7} will not be retried."
  else
    warn "rolled back but ${SERVICE} is not active; check: journalctl -u ${SERVICE} -e"
  fi
  exit 1
}

systemctl stop "$SERVICE" || warn "could not stop ${SERVICE} (is it installed?)."
backup_db

if ! git_app merge --ff-only --quiet "$NEW"; then
  warn "fast-forward failed."
  rollback
fi
if ! (cd "$APP_DIR" && as_app "$BUN_BIN" install --frozen-lockfile >/dev/null); then
  warn "bun install failed."
  rollback
fi

systemctl start "$SERVICE" || { warn "could not start ${SERVICE}."; rollback; }
if ! healthy; then
  warn "${SERVICE} did not stay up for ${HEALTH_WAIT}s."
  rollback
fi

prune_backups
printf '%s %s %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$OLD" "$NEW" >> "${STATE_DIR}/history.log"
log "updated to ${NEW:0:7}; ${SERVICE} is running."
