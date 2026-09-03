#!/usr/bin/env bash
# AgentPDP — switch /opt/agentpdp/current back to the previous release and restart.
#
#   scripts/rollback.sh                    # previous release (the newest one older than current)
#   scripts/rollback.sh 20260904T020000Z   # a specific release directory name
set -euo pipefail

DEPLOY_HOST="${DEPLOY_HOST:-188.166.163.33}"
DEPLOY_USER="${DEPLOY_USER:-root}"
DEPLOY_SSH_KEY="${DEPLOY_SSH_KEY:-$HOME/.ssh/anton_mini_deploy}"
APP_DIR=/opt/agentpdp
TARGET="${1:-}"

die() { echo "ERROR: $*" >&2; exit 1; }
trap 'echo "ROLLBACK FAILED (line $LINENO)" >&2' ERR
[[ -r "$DEPLOY_SSH_KEY" ]] || die "ssh key $DEPLOY_SSH_KEY not readable"
[[ -z "$TARGET" || "$TARGET" =~ ^[0-9]{8}T[0-9]{6}Z$ ]] || die "release name must look like 20260904T020000Z"
SSH=(ssh -i "$DEPLOY_SSH_KEY" -o BatchMode=yes -o ConnectTimeout=15 "$DEPLOY_USER@$DEPLOY_HOST")

# ssh flattens remote args, so an empty TARGET would vanish: pass "-" as the placeholder.
"${SSH[@]}" bash -s -- "$APP_DIR" "${TARGET:--}" <<'REMOTE'
set -euo pipefail
APP_DIR="$1"; TARGET="$2"; [[ "$TARGET" == "-" ]] && TARGET=""
trap 'echo "REMOTE STEP FAILED at line $LINENO" >&2' ERR

CUR="$(readlink -f "$APP_DIR/current" 2>/dev/null || true)"
[[ -n "$CUR" ]] || { echo "no current release to roll back from" >&2; exit 1; }

if [[ -n "$TARGET" ]]; then
  PREV="$APP_DIR/releases/$TARGET"
else
  PREV=""
  for r in $(ls -1d "$APP_DIR"/releases/*/ | sed 's#/$##' | sort); do
    [[ "$r" == "$CUR" ]] && break
    PREV="$r"
  done
fi
[[ -n "$PREV" ]] || { echo "no release older than current ($CUR). Releases:" >&2; ls -1 "$APP_DIR/releases" >&2; exit 1; }
[[ "$PREV" != "$CUR" ]] || { echo "$PREV is already current" >&2; exit 1; }
[[ -f "$PREV/dist/server/server/index.js" && -d "$PREV/node_modules" ]] || { echo "$PREV is not a complete release" >&2; exit 1; }

echo "rollback: $CUR  ->  $PREV"
ln -sfn "$PREV" "$APP_DIR/current.tmp"
mv -Tf "$APP_DIR/current.tmp" "$APP_DIR/current"
systemctl restart agentpdp

PORT="$(grep -E '^PORT=' "$APP_DIR/env" | tail -1 | cut -d= -f2- || true)"; PORT="${PORT:-8787}"
ok=0
for _ in $(seq 1 30); do
  if curl -fsS --max-time 2 "http://127.0.0.1:$PORT/healthz" >/dev/null 2>&1; then ok=1; break; fi
  sleep 1
done
if [[ $ok != 1 ]]; then
  echo "HEALTH CHECK FAILED after rollback" >&2
  journalctl -u agentpdp -n 50 --no-pager >&2 || true
  exit 1
fi
echo "healthz OK: $(curl -fsS "http://127.0.0.1:$PORT/healthz")"
echo "ROLLED BACK to $(basename "$PREV")"
REMOTE
