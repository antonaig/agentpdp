#!/usr/bin/env bash
# AgentPDP — build on the mini, ship a release, switch atomically, restart, health-check.
#
#   scripts/deploy.sh                 # npm ci && npm run build, then deploy
#   SKIP_INSTALL=1 scripts/deploy.sh  # skip the local npm ci (still builds)
#   SKIP_BUILD=1 scripts/deploy.sh    # ship the existing dist/ as-is (escape hatch when the tree
#                                     #   has type errors you don't own; the emitted JS must still run)
#
# Release layout on the droplet:
#   /opt/agentpdp/releases/<UTC ts>/{dist,package.json,package-lock.json,node_modules}
#   /opt/agentpdp/current -> releases/<ts>      (atomic symlink switch)
# Keeps the last 3 releases. Rollback: scripts/rollback.sh
set -euo pipefail

DEPLOY_HOST="${DEPLOY_HOST:-188.166.163.33}"
DEPLOY_USER="${DEPLOY_USER:-root}"
DEPLOY_SSH_KEY="${DEPLOY_SSH_KEY:-$HOME/.ssh/anton_mini_deploy}"
APP_DIR=/opt/agentpdp
APP_USER=agentpdp
KEEP_RELEASES="${KEEP_RELEASES:-3}"

die() { echo "ERROR: $*" >&2; exit 1; }
log() { printf '\n==> %s\n' "$*"; }
trap 'echo; echo "DEPLOY FAILED (line $LINENO). Previous release is still on disk: scripts/rollback.sh" >&2' ERR

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
[[ -r "$DEPLOY_SSH_KEY" ]] || die "ssh key $DEPLOY_SSH_KEY not readable"
SSH=(ssh -i "$DEPLOY_SSH_KEY" -o BatchMode=yes -o ConnectTimeout=15 "$DEPLOY_USER@$DEPLOY_HOST")
TS="$(date -u +%Y%m%dT%H%M%SZ)"
RELEASE="$APP_DIR/releases/$TS"

cd "$REPO_ROOT"
log "Local build ($REPO_ROOT)"
if [[ "${SKIP_BUILD:-0}" == 1 ]]; then
  echo "WARNING: SKIP_BUILD=1 — shipping the EXISTING dist/ without npm ci / npm run build" >&2
else
  if [[ "${SKIP_INSTALL:-0}" != 1 ]]; then
    npm ci --no-audit --no-fund
  fi
  npm run build
fi
[[ -f dist/server/server/index.js ]] || die "dist/server/server/index.js missing after build"
[[ -f dist/web/index.html ]] || die "dist/web/index.html missing after build"

log "Preflight on $DEPLOY_HOST"
"${SSH[@]}" "test -f /etc/systemd/system/agentpdp.service && test -f $APP_DIR/env && id -u $APP_USER >/dev/null" \
  || die "droplet not set up — run scripts/server-setup.sh first"

log "Upload -> $DEPLOY_HOST:$RELEASE"
"${SSH[@]}" "mkdir -p '$RELEASE'"
rsync -az -e "ssh -i $DEPLOY_SSH_KEY -o BatchMode=yes" \
  dist package.json package-lock.json \
  "$DEPLOY_USER@$DEPLOY_HOST:$RELEASE/"

log "Remote: npm ci --omit=dev, switch current, restart, health-check, prune"
"${SSH[@]}" bash -s -- "$RELEASE" "$APP_DIR" "$APP_USER" "$KEEP_RELEASES" <<'REMOTE'
set -euo pipefail
RELEASE="$1"; APP_DIR="$2"; APP_USER="$3"; KEEP="$4"
trap 'echo "REMOTE STEP FAILED at line $LINENO" >&2' ERR

cd "$RELEASE"
npm ci --omit=dev --no-audit --no-fund --loglevel=error
chown -R "$APP_USER:$APP_USER" "$RELEASE"

PREV=""; [[ -L "$APP_DIR/current" ]] && PREV="$(readlink -f "$APP_DIR/current")"
ln -sfn "$RELEASE" "$APP_DIR/current.tmp"
mv -Tf "$APP_DIR/current.tmp" "$APP_DIR/current"
echo "current -> $RELEASE${PREV:+  (was $PREV)}"

systemctl restart agentpdp

PORT="$(grep -E '^PORT=' "$APP_DIR/env" | tail -1 | cut -d= -f2- || true)"; PORT="${PORT:-8787}"
ok=0
for _ in $(seq 1 30); do
  if curl -fsS --max-time 2 "http://127.0.0.1:$PORT/healthz" >/dev/null 2>&1; then ok=1; break; fi
  sleep 1
done
if [[ $ok != 1 ]]; then
  echo "HEALTH CHECK FAILED: http://127.0.0.1:$PORT/healthz not OK after 30s" >&2
  echo "--- systemctl status agentpdp ---" >&2; systemctl status agentpdp --no-pager -l >&2 || true
  echo "--- journalctl -u agentpdp -n 50 ---" >&2; journalctl -u agentpdp -n 50 --no-pager >&2 || true
  exit 1
fi
echo "healthz OK: $(curl -fsS "http://127.0.0.1:$PORT/healthz")"

CUR="$(readlink -f "$APP_DIR/current")"
ls -1d "$APP_DIR"/releases/*/ | sed 's#/$##' | sort | head -n -"$KEEP" | while read -r old; do
  [[ "$old" == "$CUR" ]] && continue
  echo "pruning $old"; rm -rf -- "$old"
done
echo "releases kept: $(ls -1 "$APP_DIR/releases" | tr '\n' ' ')"
REMOTE

PUBLIC_ORIGIN="$("${SSH[@]}" "grep -E '^PUBLIC_ORIGIN=' $APP_DIR/env | tail -1 | cut -d= -f2-" || true)"
PUBLIC_ORIGIN="${PUBLIC_ORIGIN:-https://188-166-163-33.sslip.io}"

log "Public check: $PUBLIC_ORIGIN/healthz"
pub_ok=0
for _ in $(seq 1 10); do
  if out="$(curl -fsS --max-time 10 "$PUBLIC_ORIGIN/healthz" 2>/dev/null)"; then pub_ok=1; echo "$out"; break; fi
  sleep 3
done
[[ $pub_ok == 1 ]] || echo "WARNING: $PUBLIC_ORIGIN/healthz not reachable yet (service is healthy locally; check Caddy/TLS: ssh ... journalctl -u caddy -n 50)" >&2

echo
echo "DEPLOYED $TS  ->  $PUBLIC_ORIGIN"
