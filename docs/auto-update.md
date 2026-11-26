# Auto-update from GitHub

A systemd timer checks the GitHub repository for new commits, fast-forwards the install, restarts the bot and rolls back
if the bot does not come up. It needs the install to be a **git clone** (not an unzipped bundle, which `redeploy.sh`
still handles).

## Turn it on

On a server that was set up with `deploy.sh` from a clone:

```sh
sudo scripts/install-auto-update.sh                      # every 15 minutes, follows origin/main
sudo scripts/install-auto-update.sh --branch main --interval 1h
```

`deploy.sh` also offers this at the end when the install is a git clone. To turn it off: `sudo scripts/install-auto-update.sh --remove`.

It writes three things:

| File | What |
|---|---|
| `/etc/systemd/system/asuka-update.service` | oneshot unit that runs `scripts/auto-update.sh` as root |
| `/etc/systemd/system/asuka-update.timer` | first run 3 minutes after boot, then every interval (plus up to 60 s of jitter) |
| `/etc/asuka/auto-update.conf` | settings (created once, never overwritten) |

## What a run does

1. Takes a lock (two runs never overlap) and fetches the branch. If GitHub cannot be reached it logs a warning and exits 0; the next run tries again.
2. Exits quietly when the install already is on that commit, or when that exact commit failed before (see below).
3. Refuses, and fails the unit so it shows in `systemctl --failed`, when the install has commits of its own, when tracked files are modified, or when signature checking is on and the commit is not signed by an allowed key.
4. Stops `asuka.service`, copies the SQLite database (and its `-wal`/`-shm` files) to `/var/lib/asuka/auto-update/backups/<time>-<old commit>/`, fast-forwards, runs `bun install --frozen-lockfile` and starts the service. Git and Bun run as the `asuka` user, so file ownership does not change. Migrations run when the bot boots, as always.
5. Waits `AUTO_UPDATE_HEALTH_WAIT` seconds (30 by default). The service must stay active the whole time and must not restart. If it does not, the run rolls back: previous commit, previous database, dependencies reinstalled, service started again. The bad commit is written to `bad-<sha>` in the state directory and skipped until a newer commit arrives. The unit fails so you notice.
6. On success it appends a line to `/var/lib/asuka/auto-update/history.log` and keeps the newest `AUTO_UPDATE_KEEP_BACKUPS` backups.

The script copies itself to a temporary file before it starts, because an update rewrites `scripts/auto-update.sh` and bash reads a script while it runs.

## Settings

`/etc/asuka/auto-update.conf` (read on every run, nothing to restart):

| Variable | Default | |
|---|---|---|
| `AUTO_UPDATE_REMOTE` | `origin` | remote to fetch |
| `AUTO_UPDATE_BRANCH` | `main` | branch to follow |
| `AUTO_UPDATE_HEALTH_WAIT` | `30` | seconds the bot must stay up after a restart |
| `AUTO_UPDATE_KEEP_BACKUPS` | `5` | database backups kept |
| `AUTO_UPDATE_SIGNERS` | empty | path to an ssh allowed-signers file; when set only commits signed by those keys are deployed |

## Everyday commands

```sh
sudo scripts/auto-update.sh --check        # is an update waiting? (changes nothing)
sudo systemctl start asuka-update          # update now
systemctl list-timers asuka-update.timer   # when does it run next
journalctl -u asuka-update -e              # what happened
cat /var/lib/asuka/auto-update/history.log # every update that landed
```

## Security

- **Whoever can push to the followed branch can run code on the server**, as the bot user, within a minute or so of the next check. Protect the branch on GitHub (required reviews, no force pushes).
- To only deploy commits you signed, set `AUTO_UPDATE_SIGNERS` to an allowed-signers file with your key, for example `cakes@haiiro.moe ssh-ed25519 AAAA...`. Commits made by GitHub's squash button carry GitHub's own signature and will be refused; push a locally signed commit instead.
- The update runs as root only to stop and start the service and to switch to the `asuka` user for git and bun. For a private repository give the `asuka` user a read-only deploy key (`~asuka/.ssh`, home is `/var/lib/asuka`) and use an ssh `origin` URL.

## Limits

- Rolling back restores the database backup taken just before the update, so anything the bot wrote during the failed health window is lost. Migrations only move forward; this is why the backup is restored rather than reversed.
- A change that breaks the bot without crashing it (a wrong message, a broken page) is not detected. The health check is "stays running".
- A transient failure (for example no network during `bun install`) also marks the commit bad and rolls back. Delete `/var/lib/asuka/auto-update/bad-<sha>` to retry it.
- It does not edit `.env`. If a release needs new environment variables, add them before it lands.
- Bundle installs (`scripts/bundle.sh` plus `redeploy.sh`) are not supported by this; use one or the other.

## Testing

`scripts/test-auto-update.sh` runs the updater in a sandbox (local bare repository as GitHub, fake `systemctl` and `bun`, no root, no network) and checks: up to date, `--check`, a good update, a start that crashes (rolled back and then skipped), a failing dependency install, local commits, tracked changes, an unsigned commit when signing is required and an unreachable remote.
