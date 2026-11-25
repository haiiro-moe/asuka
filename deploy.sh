#!/usr/bin/env bash
#
# Asuka production deploy script (Linux + systemd).
#
# Run as root from the repository root on the target server:
#
#   sudo ./deploy.sh
#
# What it does:
#   1. Installs Bun system-wide if missing.
#   2. Walks you through .env (Discord credentials, web/OAuth settings).
#   3. Walks you through the guild configuration (channel & role IDs) and
#      writes it into the SQLite database before the first launch.
#   4. Creates a dedicated system user, installs dependencies, and sets up
#      an "asuka" systemd unit running in production mode.
#
# Every guild-config prompt may be left blank — anything you skip can be
# configured later in the web dashboard.

set -euo pipefail

# ---------------------------------------------------------------------------
# Constants & helpers
# ---------------------------------------------------------------------------

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SERVICE_NAME="asuka"
SERVICE_USER="asuka"
DATA_DIR="/var/lib/asuka"
UNIT_FILE="/etc/systemd/system/${SERVICE_NAME}.service"
ENV_FILE="${APP_DIR}/.env"

bold()  { printf '\033[1m%s\033[0m\n' "$*"; }
info()  { printf '\033[36m==>\033[0m %s\n' "$*"; }
warn()  { printf '\033[33mWARN:\033[0m %s\n' "$*"; }
die()   { printf '\033[31mERROR:\033[0m %s\n' "$*" >&2; exit 1; }

# ask VAR "Prompt" "default"  — plain prompt with optional default.
ask() {
  local -n _out=$1
  local prompt=$2 default=${3-}
  local suffix=""
  [[ -n "$default" ]] && suffix=" [${default}]"
  read -rp "  ${prompt}${suffix}: " _out
  [[ -z "$_out" && -n "$default" ]] && _out=$default
}

# ask_required VAR "Prompt" — re-prompts until non-empty.
ask_required() {
  local -n _out=$1
  local prompt=$2
  while true; do
    read -rp "  ${prompt}: " _out
    [[ -n "$_out" ]] && return
    echo "    value is required."
  done
}

# ask_secret VAR "Prompt" — hidden input, re-prompts until non-empty.
ask_secret() {
  local -n _out=$1
  local prompt=$2
  while true; do
    read -rsp "  ${prompt}: " _out
    echo
    [[ -n "$_out" ]] && return
    echo "    value is required."
  done
}

# ask_snowflake VAR "Prompt" [required] — Discord ID (17-20 digits) or blank.
ask_snowflake() {
  local -n _out=$1
  local prompt=$2 required=${3:-no}
  while true; do
    read -rp "  ${prompt}: " _out
    if [[ -z "$_out" ]]; then
      [[ "$required" == "required" ]] && { echo "    value is required."; continue; }
      return
    fi
    [[ "$_out" =~ ^[0-9]{17,20}$ ]] && return
    echo "    not a valid Discord ID (expected 17-20 digits)."
  done
}

confirm() {
  local prompt=$1 reply
  read -rp "  ${prompt} [y/N]: " reply
  [[ "$reply" =~ ^[Yy] ]]
}

# ---------------------------------------------------------------------------
# Preflight
# ---------------------------------------------------------------------------

[[ "$(uname -s)" == "Linux" ]] || die "This script targets Linux servers."
[[ "$(id -u)" -eq 0 ]] || die "Run as root (sudo ./deploy.sh) — needed for the system user and systemd unit."
[[ -t 0 ]] || die "Interactive terminal required."
[[ -f "${APP_DIR}/package.json" && -d "${APP_DIR}/src/db/migrations" ]] \
  || die "Run this script from the asuka repository root (package.json / migrations not found)."

bold ""
bold "Asuka production deploy"
bold "======================="
echo "  App directory : ${APP_DIR}"
echo "  Data directory: ${DATA_DIR}"
echo "  Service       : ${SERVICE_NAME}.service (user: ${SERVICE_USER})"
echo

# ---------------------------------------------------------------------------
# 1. Bun
# ---------------------------------------------------------------------------

info "Checking Bun"
BUN_BIN="$(command -v bun || true)"
# The service user must be able to execute bun; anything under /root is not.
if [[ -z "$BUN_BIN" || "$BUN_BIN" == /root/* ]]; then
  info "Installing Bun system-wide to /usr/local"
  command -v curl >/dev/null || die "curl is required to install Bun."
  curl -fsSL https://bun.sh/install | BUN_INSTALL=/usr/local bash
  BUN_BIN="/usr/local/bin/bun"
fi
[[ -x "$BUN_BIN" ]] || die "Bun installation failed."
echo "  Using ${BUN_BIN} ($("$BUN_BIN" --version))"

# ---------------------------------------------------------------------------
# 2. .env configuration
# ---------------------------------------------------------------------------

echo
bold "Step 1/4 — Environment (.env)"
echo

WRITE_ENV=yes
if [[ -f "$ENV_FILE" ]]; then
  warn ".env already exists at ${ENV_FILE}"
  if ! confirm "Reconfigure it? (choosing no keeps the existing file)"; then
    WRITE_ENV=no
  fi
fi

if [[ "$WRITE_ENV" == "yes" ]]; then
  echo
  echo "  Discord credentials — https://discord.com/developers/applications"
  echo "  (Bot tab for the token; OAuth2 tab for client ID/secret.)"
  echo
  ask_secret DISCORD_TOKEN "Bot token (input hidden)"
  ask_required CLIENT_ID "Application (client) ID"
  ask_secret CLIENT_SECRET "OAuth2 client secret (input hidden)"
  ask_snowflake GUILD_ID "Guild ID the bot is locked to" required

  echo
  echo "  Web dashboard"
  echo
  ask WEB_PORT "Web UI port" "3000"
  ask PUBLIC_URL "Public base URL of the dashboard" "http://localhost:${WEB_PORT}"
  PUBLIC_URL="${PUBLIC_URL%/}"
  ask OAUTH_REDIRECT "OAuth2 redirect URI" "${PUBLIC_URL}/auth/callback"

  if command -v openssl >/dev/null; then
    SESSION_SECRET="$(openssl rand -hex 32)"
  else
    SESSION_SECRET="$(head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n')"
  fi
  echo "  Session secret: generated automatically."

  DATABASE_PATH="${DATA_DIR}/asuka.sqlite"
  echo "  Database path : ${DATABASE_PATH}"

  umask 077
  cat > "$ENV_FILE" <<EOF
# Generated by deploy.sh on $(date -u +%Y-%m-%dT%H:%M:%SZ)

# Discord bot credentials (https://discord.com/developers/applications)
DISCORD_TOKEN=${DISCORD_TOKEN}
CLIENT_ID=${CLIENT_ID}
CLIENT_SECRET=${CLIENT_SECRET}

# The single guild this bot is locked to; it leaves all others.
GUILD_ID=${GUILD_ID}

# Web UI / OAuth
OAUTH_REDIRECT=${OAUTH_REDIRECT}
SESSION_SECRET=${SESSION_SECRET}
WEB_PORT=${WEB_PORT}
PUBLIC_URL=${PUBLIC_URL}

# Storage
DATABASE_PATH=${DATABASE_PATH}

NODE_ENV=production
EOF
  umask 022
  echo
  info ".env written (mode 600)."
else
  # Keep the existing file but make sure production essentials are sane.
  grep -q '^NODE_ENV=production' "$ENV_FILE" \
    || warn "existing .env does not set NODE_ENV=production — the unit sets it anyway."
  DATABASE_PATH="$(grep -E '^DATABASE_PATH=' "$ENV_FILE" | tail -n1 | cut -d= -f2-)"
  DATABASE_PATH="${DATABASE_PATH:-${APP_DIR}/asuka.sqlite}"
  echo "  Keeping existing .env (database: ${DATABASE_PATH})."
fi

# ---------------------------------------------------------------------------
# 3. Guild configuration (channels & roles)
# ---------------------------------------------------------------------------

echo
bold "Step 2/4 — Guild configuration (channels & roles)"
echo
echo "  Paste Discord IDs (right-click → Copy ID with developer mode on)."
echo "  Leave any prompt blank to skip — everything here can also be set"
echo "  later in the web dashboard. Blanks never overwrite existing values."
echo

declare -A CFG=()

echo "  Channels:"
ask_snowflake CFG_starboardChannelId    "Starboard channel ID"
ask_snowflake CFG_modLogChannelId       "Mod log channel ID"
ask_snowflake CFG_levelUpChannelId      "Level-up announcements channel ID"
ask_snowflake CFG_announcementChannelId "General announcements channel ID"
ask_snowflake CFG_approvalChannelId     "Club approval (admin) channel ID"
ask_snowflake CFG_electionChannelId     "Election channel ID"
ask_snowflake CFG_clubListingChannelId  "Club listing/directory channel ID"
ask_snowflake CFG_clubCategoryId        "Club category ID (channels created under it)"

echo
echo "  Roles:"
ask_snowflake CFG_presidentRoleId        "President role ID"
ask_snowflake CFG_clubCreateMinRoleId    "Minimum role to create a club (ID)"
ask_snowflake CFG_presidentApplyMinRoleId "Minimum role to run for president (ID)"
ask_snowflake CFG_clubAdminRoleId        "Club admin/oversight role ID"

for key in starboardChannelId modLogChannelId levelUpChannelId announcementChannelId \
           approvalChannelId electionChannelId clubListingChannelId clubCategoryId \
           presidentRoleId clubCreateMinRoleId presidentApplyMinRoleId clubAdminRoleId; do
  var="CFG_${key}"
  [[ -n "${!var}" ]] && CFG[$key]="${!var}"
done

echo
echo "  Feature tunables (XP rates, starboard threshold, credits, election cron)"
echo "  keep their defaults; adjust them in the web dashboard after launch."

# ---------------------------------------------------------------------------
# 4. Service user, dependencies, database seed
# ---------------------------------------------------------------------------

echo
bold "Step 3/4 — Install & database"
echo

info "Creating service user '${SERVICE_USER}'"
if ! id -u "$SERVICE_USER" >/dev/null 2>&1; then
  useradd --system --home-dir "$DATA_DIR" --create-home --shell /usr/sbin/nologin "$SERVICE_USER"
else
  echo "  user already exists."
fi

info "Preparing data directory ${DATA_DIR}"
mkdir -p "$DATA_DIR"
chown -R "${SERVICE_USER}:${SERVICE_USER}" "$DATA_DIR"
chmod 750 "$DATA_DIR"

info "Installing dependencies"
(cd "$APP_DIR" && "$BUN_BIN" install --frozen-lockfile)

info "Fixing ownership of ${APP_DIR}"
chown -R "${SERVICE_USER}:${SERVICE_USER}" "$APP_DIR"
chmod 600 "$ENV_FILE"

info "Running migrations and seeding guild configuration"
# Temp script lives inside the app dir so bun resolves node_modules and the
# relative migrationsFolder used by initDb(). Runs as the service user so the
# database files are created with the right owner.
SEED_SCRIPT="${APP_DIR}/.deploy-seed.ts"
cat > "$SEED_SCRIPT" <<'EOF'
import { db, schema, initDb } from "./src/db/index.ts";
import { eq } from "drizzle-orm";

initDb();

const keys = [
  "starboardChannelId", "modLogChannelId", "levelUpChannelId",
  "announcementChannelId", "approvalChannelId", "electionChannelId",
  "clubListingChannelId", "clubCategoryId",
  "presidentRoleId", "clubCreateMinRoleId", "presidentApplyMinRoleId",
  "clubAdminRoleId",
] as const;

const patch: Record<string, string> = {};
for (const key of keys) {
  const value = process.env[`CFG_${key}`];
  if (value) patch[key] = value;
}

if (Object.keys(patch).length > 0) {
  db.update(schema.guildConfig).set(patch).where(eq(schema.guildConfig.id, 1)).run();
}
console.log(`  migrations applied; ${Object.keys(patch).length} guild-config field(s) set.`);
EOF
chown "${SERVICE_USER}:${SERVICE_USER}" "$SEED_SCRIPT"

SEED_ENV=(NODE_ENV=production HOME="$DATA_DIR")
for key in "${!CFG[@]}"; do
  SEED_ENV+=("CFG_${key}=${CFG[$key]}")
done
if command -v runuser >/dev/null; then
  (cd "$APP_DIR" && runuser -u "$SERVICE_USER" -- env "${SEED_ENV[@]}" "$BUN_BIN" "$SEED_SCRIPT")
else
  (cd "$APP_DIR" && sudo -u "$SERVICE_USER" env "${SEED_ENV[@]}" "$BUN_BIN" "$SEED_SCRIPT")
fi
rm -f "$SEED_SCRIPT"

# ---------------------------------------------------------------------------
# 5. systemd unit
# ---------------------------------------------------------------------------

echo
bold "Step 4/4 — systemd unit"
echo

info "Writing ${UNIT_FILE}"
cat > "$UNIT_FILE" <<EOF
[Unit]
Description=Asuka Discord bot + web dashboard
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=${SERVICE_USER}
Group=${SERVICE_USER}
WorkingDirectory=${APP_DIR}
# Bun auto-loads ${APP_DIR}/.env; NODE_ENV here guarantees production mode.
Environment=NODE_ENV=production
Environment=HOME=${DATA_DIR}
ExecStart=${BUN_BIN} src/index.ts
Restart=on-failure
RestartSec=5

# Hardening
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=full
ReadWritePaths=${DATA_DIR} ${APP_DIR}

[Install]
WantedBy=multi-user.target
EOF

info "Enabling and starting ${SERVICE_NAME}.service"
systemctl daemon-reload
systemctl enable --now "$SERVICE_NAME"

sleep 3
if systemctl is-active --quiet "$SERVICE_NAME"; then
  echo
  bold "Deployed. ${SERVICE_NAME}.service is running."
else
  echo
  warn "Service failed to start. Inspect logs with:"
  warn "  journalctl -u ${SERVICE_NAME} -e"
  exit 1
fi

# ---------------------------------------------------------------------------
# Post-deploy notes
# ---------------------------------------------------------------------------

echo
bold "Post-deploy checklist"
cat <<EOF
  * Discord developer portal (https://discord.com/developers/applications):
      - Bot → enable privileged intents: SERVER MEMBERS and MESSAGE CONTENT.
      - OAuth2 → add redirect URI: $(grep -E '^OAUTH_REDIRECT=' "$ENV_FILE" | cut -d= -f2-)
      - Invite the bot to guild $(grep -E '^GUILD_ID=' "$ENV_FILE" | cut -d= -f2-) if it is not a member yet
        (it deploys slash commands and leaves every other guild on startup).
  * Web dashboard listens on port $(grep -E '^WEB_PORT=' "$ENV_FILE" | cut -d= -f2-) — put a reverse proxy
    (nginx/caddy) with TLS in front if PUBLIC_URL is https.
  * Anything skipped above (channels, roles, XP/starboard/credit tunables) is
    configurable in the web dashboard by an admin.

  Manage the service:
    systemctl status ${SERVICE_NAME}
    journalctl -u ${SERVICE_NAME} -f
    systemctl restart ${SERVICE_NAME}
EOF
