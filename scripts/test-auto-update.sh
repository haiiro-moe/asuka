#!/usr/bin/env bash
#
# Sandbox test for scripts/auto-update.sh. No root, no real systemd, no network: a local bare repository
# plays GitHub, and fake `systemctl` and `bun` commands record what the updater does.
#
#   scripts/test-auto-update.sh
#
# Covers: up to date, --check, a good update (backup + history), a broken update that is rolled back
# (commit, database, dependencies) and then skipped, local commits, tracked changes, an unsigned commit
# when signers are required, and an unreachable remote.

set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
UPDATER="${HERE}/auto-update.sh"
SANDBOX="$(mktemp -d)"
trap 'rm -rf "$SANDBOX"' EXIT

ORIGIN="${SANDBOX}/origin.git"
WORK="${SANDBOX}/work"
APP="${SANDBOX}/app"
DATA="${SANDBOX}/data"
BIN="${SANDBOX}/bin"
STATE="${SANDBOX}/state"
mkdir -p "$BIN" "$DATA"

pass=0; fail=0
ok()  { pass=$((pass + 1)); printf '  ok   %s\n' "$1"; }
bad() { fail=$((fail + 1)); printf '  FAIL %s\n' "$1"; }
expect() { # description, command...
  local desc=$1; shift
  if "$@"; then ok "$desc"; else bad "$desc"; fi
}

# --- fakes -----------------------------------------------------------------------------------------

cat > "${BIN}/systemctl" <<EOF
#!/usr/bin/env bash
S="${SANDBOX}/svc"
mkdir -p "\$S"; [[ -f "\$S/state" ]] || echo active > "\$S/state"; [[ -f "\$S/restarts" ]] || echo 0 > "\$S/restarts"
case "\$1" in
  stop)  echo inactive > "\$S/state" ;;
  start)
    echo active > "\$S/state"
    if [[ -f "${SANDBOX}/crash-on-start" ]]; then rm -f "${SANDBOX}/crash-on-start"; echo "migrated" > "${DATA}/asuka.sqlite"; echo inactive > "\$S/state"; fi ;;
  is-active) [[ "\$(cat "\$S/state")" == active ]] ;;
  show) cat "\$S/restarts" ;;
esac
EOF
cat > "${BIN}/bun" <<EOF
#!/usr/bin/env bash
echo "\$@" >> "${SANDBOX}/bun.log"
[[ -f "${SANDBOX}/fail-install" && "\$1" == install ]] && exit 1
exit 0
EOF
chmod +x "${BIN}/systemctl" "${BIN}/bun"

run() { # extra env assignments... then runs the updater
  env PATH="${BIN}:${PATH}" ASUKA_APP_DIR="$APP" ASUKA_DATA_DIR="$DATA" ASUKA_STATE_DIR="$STATE" \
    ASUKA_BUN="${BIN}/bun" ASUKA_RUN_AS=command ASUKA_LOCK_FILE="${SANDBOX}/lock" \
    AUTO_UPDATE_HEALTH_WAIT=2 "$@" "$UPDATER" ${ARGS:+"$ARGS"} 2>&1
}
head_of() { git -C "$APP" rev-parse --short HEAD; }
commit_upstream() { # message
  (cd "$WORK" && echo "$1" >> file.txt && git add -A && git -c user.name=t -c user.email=t@example.com commit -qm "$1" && git push -q origin main)
}

# --- fixtures --------------------------------------------------------------------------------------

git init -q --bare -b main "$ORIGIN"
git clone -q "$ORIGIN" "$WORK" 2>/dev/null
(cd "$WORK" && echo one > file.txt && git add -A && git -c user.name=t -c user.email=t@example.com commit -qm one && git branch -M main && git push -q origin main)
git clone -q "$ORIGIN" "$APP"
echo "DATABASE_PATH=${DATA}/asuka.sqlite" > "${APP}/.env"
echo "v1" > "${DATA}/asuka.sqlite"
git -C "$APP" config user.name t; git -C "$APP" config user.email t@example.com
START="$(head_of)"

echo "up to date"
out="$(run)"; expect "exits 0 and says so" grep -q "up to date" <<<"$out"

echo "--check"
commit_upstream two
out="$(ARGS=--check run)"; expect "reports an update" grep -q "update available" <<<"$out"
expect "changes nothing" test "$(head_of)" = "$START"

echo "good update"
out="$(run)"; rc=$?
expect "succeeds" test "$rc" -eq 0
expect "fast-forwards" test "$(head_of)" != "$START"
expect "ran bun install" grep -q "install --frozen-lockfile" "${SANDBOX}/bun.log"
expect "backed up the database" bash -c "ls '${STATE}/backups'/*/asuka.sqlite >/dev/null 2>&1"
expect "wrote history" test -s "${STATE}/history.log"
GOOD="$(head_of)"

echo "broken update is rolled back"
commit_upstream three
touch "${SANDBOX}/crash-on-start"
out="$(run)"; rc=$?
rm -f "${SANDBOX}/crash-on-start"
expect "fails loudly" test "$rc" -ne 0
expect "returns to the previous commit" test "$(head_of)" = "$GOOD"
expect "restores the database" grep -q "v1" "${DATA}/asuka.sqlite"
expect "marks the commit bad" bash -c "ls '${STATE}'/bad-* >/dev/null 2>&1"
echo "active" > "${SANDBOX}/svc/state"
echo "skips it afterwards"
out="$(run)"; rc=$?
expect "exits 0" test "$rc" -eq 0
expect "says it will wait" grep -q "failed to start earlier" <<<"$out"

echo "failed dependency install is rolled back"
commit_upstream four
touch "${SANDBOX}/fail-install"
out="$(run)"; rc=$?
rm -f "${SANDBOX}/fail-install"
expect "fails" test "$rc" -ne 0
expect "returns to the previous commit" test "$(head_of)" = "$GOOD"

echo "local commit"
(cd "$APP" && echo local >> local.txt && git add -A && git commit -qm local)
commit_upstream five
out="$(run)"; rc=$?
expect "refuses" test "$rc" -ne 0
expect "explains" grep -q "not an ancestor" <<<"$out"
git -C "$APP" reset -q --hard "$GOOD"

echo "tracked change"
echo dirty >> "${APP}/file.txt"
out="$(run)"; rc=$?
expect "refuses" test "$rc" -ne 0
expect "explains" grep -q "uncommitted changes" <<<"$out"
git -C "$APP" checkout -q -- file.txt

echo "signature required"
echo "none ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIOMqqnkVzrm0SdG6UOoqKLsabgH5C9okWi0dh2l9GKJl" > "${SANDBOX}/signers"
commit_upstream six
out="$(run AUTO_UPDATE_SIGNERS="${SANDBOX}/signers")"; rc=$?
expect "refuses an unsigned commit" test "$rc" -ne 0
expect "stays on the good commit" test "$(head_of)" = "$GOOD"

echo "unreachable remote"
git -C "$APP" remote set-url origin "${SANDBOX}/nowhere.git"
out="$(run)"; rc=$?
expect "is not a failure" test "$rc" -eq 0
expect "warns" grep -q "could not fetch" <<<"$out"

echo
printf '%d passed, %d failed\n' "$pass" "$fail"
[[ "$fail" -eq 0 ]]
