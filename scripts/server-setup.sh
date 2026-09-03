#!/usr/bin/env bash
# AgentPDP — one-time, idempotent droplet setup. Safe to re-run.
#
# Run FROM THE MINI (default): rsyncs infra/ + this script to the droplet and re-executes
# itself there as root with --remote.
#   scripts/server-setup.sh
#
# What it does on the droplet:
#   * verifies node >= 22 at /usr/bin/node
#   * creates system user `agentpdp` + /opt/agentpdp/{releases,shared,pw-browsers}
#   * writes /opt/agentpdp/env from infra/env.template ONLY if missing (0600, agentpdp)
#   * installs infra/Caddyfile -> /etc/caddy/Caddyfile, validates, reloads Caddy
#   * installs infra/agentpdp.service, daemon-reload, enable (start happens on first deploy)
#   * installs the Playwright 1.52 Chromium fallback: system deps as root, browser as agentpdp
#     into /opt/agentpdp/pw-browsers
set -euo pipefail

DEPLOY_HOST="${DEPLOY_HOST:-188.166.163.33}"
DEPLOY_USER="${DEPLOY_USER:-root}"
DEPLOY_SSH_KEY="${DEPLOY_SSH_KEY:-$HOME/.ssh/anton_mini_deploy}"
APP_DIR=/opt/agentpdp
APP_USER=agentpdp
PW_VERSION="${PW_VERSION:-1.52}"
REMOTE_SRC=/root/agentpdp-infra

die() { echo "ERROR: $*" >&2; exit 1; }
log() { printf '\n==> %s\n' "$*"; }

# ----------------------------------------------------------------------------- local side
if [[ "${1:-}" != "--remote" ]]; then
  REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
  for f in infra/Caddyfile infra/agentpdp.service infra/env.template; do
    [[ -f "$REPO_ROOT/$f" ]] || die "$f missing"
  done
  [[ -r "$DEPLOY_SSH_KEY" ]] || die "ssh key $DEPLOY_SSH_KEY not readable"
  SSH=(ssh -i "$DEPLOY_SSH_KEY" -o BatchMode=yes -o ConnectTimeout=15 "$DEPLOY_USER@$DEPLOY_HOST")

  log "Syncing infra/ + server-setup.sh -> $DEPLOY_HOST:$REMOTE_SRC/"
  "${SSH[@]}" "mkdir -p '$REMOTE_SRC'"
  rsync -az --delete -e "ssh -i $DEPLOY_SSH_KEY -o BatchMode=yes" \
    "$REPO_ROOT/infra/" "$REPO_ROOT/scripts/server-setup.sh" \
    "$DEPLOY_USER@$DEPLOY_HOST:$REMOTE_SRC/"

  log "Running setup on $DEPLOY_HOST as $DEPLOY_USER"
  "${SSH[@]}" "PW_VERSION='$PW_VERSION' bash '$REMOTE_SRC/server-setup.sh' --remote"
  exit 0
fi

# ---------------------------------------------------------------------------- remote side
[[ $EUID -eq 0 ]] || die "--remote must run as root"
SRC="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
export DEBIAN_FRONTEND=noninteractive
trap 'echo "SERVER SETUP FAILED at line $LINENO" >&2' ERR

log "Node"
command -v node >/dev/null || die "node not found"
NODE_MAJOR="$(node -p 'Number(process.versions.node.split(".")[0])')"
(( NODE_MAJOR >= 22 )) || die "node >= 22 required, found $(node -v)"
[[ -x /usr/bin/node ]] || die "/usr/bin/node missing (unit ExecStart expects it); found $(command -v node)"
echo "node $(node -v) at /usr/bin/node, npm $(npm -v)"

log "User + directories"
if ! id -u "$APP_USER" >/dev/null 2>&1; then
  useradd --system --user-group --home-dir "$APP_DIR/shared" --no-create-home \
    --shell /usr/sbin/nologin "$APP_USER"
  echo "created user $APP_USER"
else
  echo "user $APP_USER exists"
fi
mkdir -p "$APP_DIR"/{releases,shared,pw-browsers}
chown root:root "$APP_DIR" && chmod 0755 "$APP_DIR"
chown "$APP_USER:$APP_USER" "$APP_DIR"/{releases,shared,pw-browsers}
chmod 0755 "$APP_DIR"/{releases,shared,pw-browsers}
ls -la "$APP_DIR"

log "Env file"
if [[ ! -f "$APP_DIR/env" ]]; then
  install -m 0600 -o "$APP_USER" -g "$APP_USER" "$SRC/env.template" "$APP_DIR/env"
  echo "wrote $APP_DIR/env from template — GROQ_API_KEY is EMPTY, fill it by hand then: systemctl restart agentpdp"
else
  chown "$APP_USER:$APP_USER" "$APP_DIR/env" && chmod 0600 "$APP_DIR/env"
  echo "$APP_DIR/env already exists — left untouched"
fi

log "Caddy"
install -d -o caddy -g caddy -m 0755 /var/log/caddy
install -d -m 0755 /etc/caddy/sites.d
[[ -f /etc/caddy/Caddyfile.orig ]] || cp -a /etc/caddy/Caddyfile /etc/caddy/Caddyfile.orig || true
if cmp -s "$SRC/Caddyfile" /etc/caddy/Caddyfile; then
  echo "Caddyfile unchanged"
else
  install -m 0644 "$SRC/Caddyfile" /etc/caddy/Caddyfile
  echo "installed /etc/caddy/Caddyfile"
fi
# Validate AS THE CADDY USER: validate provisions modules and pre-creates log files; done as root
# they end up root-owned and the real reload then fails with "permission denied".
sudo -u caddy -H caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile 2>&1 | tail -1
chown -R caddy:caddy /var/log/caddy
systemctl enable --now caddy >/dev/null 2>&1
systemctl reload caddy
echo "caddy: $(systemctl is-active caddy)"

log "systemd unit"
install -m 0644 "$SRC/agentpdp.service" /etc/systemd/system/agentpdp.service
systemctl daemon-reload
systemctl enable agentpdp >/dev/null 2>&1
if [[ -L "$APP_DIR/current" ]]; then
  systemctl restart agentpdp
  echo "agentpdp: $(systemctl is-active agentpdp) (restarted with new unit)"
else
  echo "agentpdp: enabled, not started — no release yet (run scripts/deploy.sh)"
fi

log "Playwright $PW_VERSION — Chromium system deps (root)"
apt-get update -qq
npx --yes "playwright@$PW_VERSION" install-deps chromium 2>&1 | tail -3

log "Playwright $PW_VERSION — Chromium into $APP_DIR/pw-browsers (as $APP_USER)"
# cd first: sudo keeps the caller's cwd (/root), which agentpdp cannot enter -> npx dies with EACCES.
(cd "$APP_DIR/shared" && sudo -u "$APP_USER" -H env PLAYWRIGHT_BROWSERS_PATH="$APP_DIR/pw-browsers" \
  npx --yes "playwright@$PW_VERSION" install chromium 2>&1 | tail -3)
ls -1 "$APP_DIR/pw-browsers"

log "Playwright smoke test (headless Chromium as $APP_USER)"
if (cd "$APP_DIR/shared" && sudo -u "$APP_USER" -H env PLAYWRIGHT_BROWSERS_PATH="$APP_DIR/pw-browsers" \
     npx --yes "playwright@$PW_VERSION" screenshot --browser chromium \
     "data:text/html,<h1>agentpdp</h1>" "$APP_DIR/shared/pw-smoke.png" >/dev/null 2>&1); then
  echo "chromium launches OK ($(stat -c %s "$APP_DIR/shared/pw-smoke.png") bytes)"
  rm -f "$APP_DIR/shared/pw-smoke.png"
else
  echo "WARNING: headless Chromium smoke test failed — extractor fallback may not work. Check: cd $APP_DIR/shared && sudo -u $APP_USER -H env PLAYWRIGHT_BROWSERS_PATH=$APP_DIR/pw-browsers npx playwright@$PW_VERSION screenshot --browser chromium https://example.com /tmp/x.png" >&2
fi

log "Setup complete"
